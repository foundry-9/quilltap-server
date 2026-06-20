/**
 * Migration: Character vault cutover — Phase 3
 *
 * Finishes the multi-phase move of character content into the per-character
 * document vault. After this migration, the `characters` table holds only
 * identity (id, userId, name), the vault pointer, default references, and
 * behavior flags; every content field (identity / description / manifesto /
 * personality / exampleDialogues / firstMessage / scenarios / systemPrompts /
 * physicalDescriptions / title / talkativeness / aliases / pronouns +
 * the legacy clothingRecords / avatarUrl) is dropped from the row.
 *
 * Per-character procedure (branches on `readPropertiesFromDocumentStore`):
 *
 *   - flag == 1 (vault authoritative): verify the expected files exist; do
 *     NOT push DB → vault, because the DB row has been frozen since the
 *     overlay was enabled and the vault holds the current values. If any
 *     expected file is missing, merge the existing vault snapshot back on
 *     top of the DB row and re-populate — this preserves present files and
 *     fills only the gaps from the (stale) DB row.
 *   - flag == 0 / NULL (DB authoritative): call writeCharacterVaultManagedFields
 *     to push the DB row into the vault wholesale.
 *
 * After the per-character loop, drop the 16 content columns in a single
 * transaction. `systemTransparency` is intentionally NOT dropped — it stays
 * as application-state access control on the DB row. This migration also
 * stops mirroring it into properties.json (Sub-task C strips the mirroring
 * in code; here we scrub the residual key from every existing
 * properties.json so the cutover is clean at rest, not just clean on write).
 *
 * Safety: before any per-character work, the migration takes a page-level
 * encrypted snapshot of the three SQLCipher databases unless one younger
 * than 24h is already under `<dataDir>/backups/`. The refusal gate at the
 * end means a single character with a partial vault that the per-field
 * fallback couldn't salvage will block the column drops; the operator
 * fixes the underlying issue and re-runs.
 *
 * Migration ID: cutover-characters-to-vault-v1
 */

import fs from 'fs';
import Database, { Database as DatabaseType } from 'better-sqlite3';
import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';
import { reportProgress } from '../lib/progress';
import {
  isSQLiteBackend,
  getSQLiteDatabase,
  sqliteTableExists,
  getSQLiteTableColumns,
} from '../lib/database-utils';
import {
  getMountIndexDatabasePath,
  getLLMLogsDatabasePath,
  getBackupsDir,
} from '../../lib/paths';
import {
  createPhysicalBackup,
  createLLMLogsPhysicalBackup,
  createMountIndexPhysicalBackup,
  parseBackupFilename,
  parseLLMLogsBackupFilename,
  parseMountIndexBackupFilename,
} from '../../lib/database/backends/sqlite/physical-backup';
import { ensureCharacterVault } from '../../lib/mount-index/character-vault';
import {
  writeCharacterVaultManagedFields,
  projectVaultWardrobe,
} from '../../lib/database/repositories/character-properties-overlay';
import { getMountIndexSQLiteClient } from '../../lib/database/backends/sqlite/mount-index-client';
import { loadMountIndexConfig } from '../../lib/database/config';
import { getRepositories } from '../../lib/repositories/factory';
import { writeDatabaseDocument } from '../../lib/mount-index/database-store';
import type { Character } from '../../lib/schemas/character.types';

const BACKUP_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * Open an encrypted SQLCipher DB at the given path with the instance's
 * pepper. Returns null if the file doesn't exist (fresh instance that
 * never provisioned the secondary DB). Used by the backup safeguard to
 * obtain handles for the mount-index and llm-logs databases — the
 * migration's own `getSQLiteDatabase()` only covers the main DB.
 */
function openEncryptedSQLite(dbPath: string): DatabaseType | null {
  if (!fs.existsSync(dbPath)) return null;
  const db = new Database(dbPath);
  try {
    const pepper = process.env.ENCRYPTION_MASTER_PEPPER;
    if (pepper) {
      const keyHex = Buffer.from(pepper, 'base64').toString('hex');
      db.pragma(`key = "x'${keyHex}'"`);
    }
    db.pragma('busy_timeout = 5000');
    return db;
  } catch (err) {
    try { db.close(); } catch { /* ignore */ }
    throw err;
  }
}

/**
 * Returns true if any file under `<dataDir>/backups/` matching the given
 * parse function has a timestamp newer than the cutoff. Mirrors the
 * `shouldCreateBackup` check inside `physical-backup.ts` — we re-do it
 * here so the migration can verify "a recent backup actually exists" in
 * the case where `createPhysicalBackup` returned null (which could mean
 * either "skipped because recent" or "tried and failed silently").
 */
function recentBackupExists(
  parseFn: (filename: string) => Date | null,
  maxAgeMs: number,
): boolean {
  const backupsDir = getBackupsDir();
  if (!fs.existsSync(backupsDir)) return false;
  const cutoff = Date.now() - maxAgeMs;
  for (const filename of fs.readdirSync(backupsDir)) {
    const date = parseFn(filename);
    if (date && date.getTime() >= cutoff) return true;
  }
  return false;
}

/**
 * Ensure a fresh physical backup exists for each SQLCipher database before
 * destructive work. Reuses the same `create*PhysicalBackup()` functions
 * the server invokes at startup — those already skip if a backup younger
 * than 24h exists, so this is a no-op on the typical "started this
 * morning" path.
 *
 * Throws if any of the three databases ends up without a recent backup
 * on disk (either because creation failed silently or because the
 * `create*` call swallowed an error). The main DB is the only one that's
 * truly load-bearing for this migration — the cutover only touches the
 * `characters` table — but we still belt-and-suspenders the secondary
 * databases so a roll-back is straightforward.
 */
async function ensureBackupsExist(ctx: { context: string }): Promise<void> {
  const mainDb = getSQLiteDatabase();
  const mainResult = await createPhysicalBackup(mainDb);
  logger.info('Main DB backup', { ...ctx, created: mainResult });
  if (!recentBackupExists(parseBackupFilename, BACKUP_MAX_AGE_MS)) {
    throw new Error('Main DB physical backup is missing and creation failed; aborting before destructive work');
  }

  const mountDb = openEncryptedSQLite(getMountIndexDatabasePath());
  if (mountDb) {
    try {
      const mountResult = await createMountIndexPhysicalBackup(mountDb);
      logger.info('Mount-index DB backup', { ...ctx, created: mountResult });
      if (!recentBackupExists(parseMountIndexBackupFilename, BACKUP_MAX_AGE_MS)) {
        throw new Error('Mount-index DB physical backup is missing and creation failed; aborting before destructive work');
      }
    } finally {
      try { mountDb.close(); } catch { /* ignore */ }
    }
  } else {
    logger.info('Mount-index DB not present on this instance; skipping its backup', ctx);
  }

  const llmDb = openEncryptedSQLite(getLLMLogsDatabasePath());
  if (llmDb) {
    try {
      const llmResult = await createLLMLogsPhysicalBackup(llmDb);
      logger.info('LLM-logs DB backup', { ...ctx, created: llmResult });
      // LLM logs are non-essential; warn but don't abort if its backup is missing.
      if (!recentBackupExists(parseLLMLogsBackupFilename, BACKUP_MAX_AGE_MS)) {
        logger.warn('LLM-logs DB physical backup missing — proceeding (logs are recoverable)', ctx);
      }
    } finally {
      try { llmDb.close(); } catch { /* ignore */ }
    }
  } else {
    logger.info('LLM-logs DB not present on this instance; skipping its backup', ctx);
  }
}

const MIGRATION_ID = 'cutover-characters-to-vault-v1';

// Files `writeCharacterVaultManagedFields` writes unconditionally (empty string
// when the field is blank), so a successfully-populated vault always has all of
// them. The physical-* pair is intentionally NOT here: the writer skips both
// when the character has no physicalDescription, so requiring them would wrongly
// block every character who simply has no physical description.
const REQUIRED_VAULT_SINGLE_FILES = [
  'properties.json',
  'identity.md',
  'description.md',
  'manifesto.md',
  'personality.md',
  'example-dialogues.md',
] as const;

/**
 * Columns dropped at the end of the migration. `systemTransparency` is
 * deliberately absent — it stays as application state in the DB.
 */
const COLUMNS_TO_DROP = [
  'identity',
  'description',
  'manifesto',
  'personality',
  'exampleDialogues',
  'firstMessage',
  'scenarios',
  'systemPrompts',
  'physicalDescriptions',
  'title',
  'talkativeness',
  'aliases',
  'pronouns',
  'clothingRecords',
  'avatarUrl',
  'readPropertiesFromDocumentStore',
] as const;

interface VaultFileSet {
  byPathLower: Map<string, string>;
  missing: string[];
}

async function listVaultPaths(mountPointId: string): Promise<VaultFileSet> {
  if (!fs.existsSync(getMountIndexDatabasePath())) {
    return { byPathLower: new Map(), missing: Array.from(REQUIRED_VAULT_SINGLE_FILES) };
  }
  const repos = getRepositories();
  const links = await repos.docMountFileLinks.findByMountPointId(mountPointId);
  const byPathLower = new Map<string, string>();
  for (const link of links) {
    byPathLower.set(link.relativePath.toLowerCase(), link.fileId);
  }
  const missing = REQUIRED_VAULT_SINGLE_FILES.filter(p => !byPathLower.has(p));
  return { byPathLower, missing: [...missing] };
}

/**
 * Read properties.json from a vault and drop the systemTransparency key if
 * present. Writes the file back when something changed. No-op when the
 * file is missing, malformed, or already systemTransparency-free.
 */
async function scrubSystemTransparency(
  mountPointId: string,
  characterName: string,
): Promise<boolean> {
  const repos = getRepositories();
  const links = await repos.docMountFileLinks.findByMountPointId(mountPointId);
  const propsLink = links.find(l => l.relativePath.toLowerCase() === 'properties.json');
  if (!propsLink) return false;
  const doc = await repos.docMountDocuments.findByFileId(propsLink.fileId);
  if (!doc) return false;
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(doc.content) as Record<string, unknown>;
  } catch (err) {
    logger.warn('properties.json unparseable; leaving alone', {
      context: `migration.${MIGRATION_ID}`,
      mountPointId,
      characterName,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
  if (!('systemTransparency' in parsed)) return false;
  delete parsed.systemTransparency;
  await writeDatabaseDocument(mountPointId, 'properties.json', JSON.stringify(parsed, null, 2));
  return true;
}

interface CharacterOutcome {
  id: string;
  name: string;
  action: 'verified' | 'populated' | 'filled-gaps' | 'vault-created' | 'blocked';
  flag: number | null;
  vaultMountPointId: string | null;
  missingAtStart: string[];
  filledFromDb: string[];
  scrubbedSystemTransparency: boolean;
  physicalArrayTruncatedFrom: number;
  blockedReason?: string;
}

/** A pre-cutover character row mapped into Character shape, plus the original
 *  physicalDescriptions array length so the caller can record truncation. */
interface LegacyCharacter {
  character: Character;
  originalPhysicalCount: number;
}

function safeJsonParse<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== 'string' || raw === '') return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/**
 * Map one raw pre-cutover `characters` row into Character shape for the vault
 * writer.
 *
 * This MUST read straight off the row rather than going through
 * `repos.characters.findAllRaw()`: that path validates every row against the
 * *post-cutover* Character schema and silently drops the ones that don't match
 * (which, by definition, every legacy row does), so it returns `[]` on a
 * populated table — the exact bug that let an earlier build drop the legacy
 * columns while believing there were no characters.
 *
 * Reshapes the legacy `physicalDescriptions` array into the singular
 * `physicalDescription` (index 0 wins) and warns — one line per character — when
 * extra entries are discarded.
 */
export function mapLegacyCharacterRow(
  row: Record<string, unknown>,
  ctx: { context: string },
): LegacyCharacter {
  const physArr = safeJsonParse<unknown[]>(row.physicalDescriptions, []);
  const originalPhysicalCount = Array.isArray(physArr) ? physArr.length : 0;
  if (originalPhysicalCount > 1) {
    logger.warn(
      'Character has multiple physicalDescriptions; preserving index 0 only (extra entries discarded by the cutover)',
      {
        ...ctx,
        characterId: row.id,
        characterName: row.name,
        originalCount: originalPhysicalCount,
      },
    );
  }

  const pronounsRaw = row.pronouns;
  const character = {
    ...row,
    aliases: safeJsonParse(row.aliases, [] as unknown[]),
    scenarios: safeJsonParse(row.scenarios, [] as unknown[]),
    systemPrompts: safeJsonParse(row.systemPrompts, [] as unknown[]),
    pronouns:
      typeof pronounsRaw === 'string' && pronounsRaw.trim().startsWith('{')
        ? safeJsonParse(pronounsRaw, pronounsRaw)
        : pronounsRaw,
    physicalDescription: originalPhysicalCount > 0 ? physArr[0] : null,
  } as unknown as Character;

  return { character, originalPhysicalCount };
}

/**
 * Read every character via direct SQL (no schema validation) and map each row.
 * Mapping is total — every row in the table produces a LegacyCharacter — so the
 * caller can compare `length` against `SELECT COUNT(*)` and abort if they ever
 * disagree.
 */
function loadLegacyCharacterRows(
  db: DatabaseType,
  ctx: { context: string },
): LegacyCharacter[] {
  const rows = db.prepare('SELECT * FROM characters').all() as Record<string, unknown>[];
  return rows.map((row) => mapLegacyCharacterRow(row, ctx));
}

export const cutoverCharactersToVaultMigration: Migration = {
  id: MIGRATION_ID,
  description:
    'Move every character\'s content fields fully into the vault and drop the legacy DB columns.',
  introducedInVersion: '4.6.0',
  dependsOn: [
    'add-character-document-mount-point-field-v1',
    'add-read-properties-from-document-store-field-v1',
    'migrate-clothing-records-to-wardrobe-v1',
    // The cutover writes each character's vault files, which insert
    // `doc_mount_file_links` rows referencing the allowEmbed /
    // allowCharacterRead / allowCharacterWrite columns. Those columns are
    // added by the policy-flags migration, so it MUST run first — otherwise
    // every vault write throws "table doc_mount_file_links has no column
    // named allowEmbed". (Same dependency the projects cutover declares.)
    'add-doc-mount-file-policy-flags-v1',
  ],

  async shouldRun(): Promise<boolean> {
    if (!isSQLiteBackend()) return false;
    if (!sqliteTableExists('characters')) return false;
    const cols = getSQLiteTableColumns('characters').map(c => c.name);
    // Any one of the dropped columns still present means the cutover hasn't
    // happened yet on this instance.
    return COLUMNS_TO_DROP.some(c => cols.includes(c));
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();
    let outcomes: CharacterOutcome[] = [];
    const ctx = { context: `migration.${MIGRATION_ID}` };

    try {
      logger.info('Ensuring physical backups exist before per-character work', ctx);
      await ensureBackupsExist(ctx);

      // Open the mount-index DB connection explicitly. `ensureCharacterVault`'s
      // first DB touch is `docMountPoints.create` — a mount-index repository
      // that reads its connection from a process-global singleton and never
      // triggers the lazy main-DB `connect()` that would populate it. That
      // singleton is normally established either by the app backend's
      // `connect()` (which runs *after* migrations) or, in a warm dev process,
      // by a prior boot left over in `globalThis`. On a genuinely cold boot —
      // e.g. an instance restarted after a long dormancy, where the projects
      // cutover (which opens this itself) already applied in an earlier run —
      // nothing has opened it yet, so every vault write throws "Mount index
      // database not initialized". Open it here first; the app's later
      // `connect()` reuses this same connection.
      const mountIndexDb = getMountIndexSQLiteClient(loadMountIndexConfig());
      if (!mountIndexDb) {
        const message =
          'Refusing to migrate — the mount-index database could not be opened, so character ' +
          'vaults are unreachable. Aborting before any destructive work.';
        logger.error(message, ctx);
        return {
          id: MIGRATION_ID,
          success: false,
          itemsAffected: 0,
          message,
          error: 'mount index unavailable',
          durationMs: Date.now() - startTime,
          timestamp: new Date().toISOString(),
        };
      }

      const db = getSQLiteDatabase();
      const rawCount = (db.prepare('SELECT COUNT(*) AS n FROM characters').get() as { n: number }).n;
      const legacy = loadLegacyCharacterRows(db, ctx);
      logger.info('Loaded raw character rows for cutover', {
        ...ctx,
        count: legacy.length,
        rawCount,
      });

      // Hard guard against the silent-no-op bug: never drop the legacy columns
      // unless we actually read every character row. A read that returns fewer
      // rows than the table holds (the old `findAllRaw` schema-validation
      // filtering returned `[]` on a populated table) would otherwise let the
      // cutover drop columns on characters it never migrated — unrecoverable on
      // instances whose content still lives only in those columns.
      if (legacy.length !== rawCount) {
        const message =
          `Refusing to drop columns — read ${legacy.length} of ${rawCount} character row(s). ` +
          `Aborting before destructive work to avoid dropping un-migrated character data.`;
        logger.error(message, ctx);
        return {
          id: MIGRATION_ID,
          success: false,
          itemsAffected: 0,
          message,
          error: 'character read count mismatch',
          durationMs: Date.now() - startTime,
          timestamp: new Date().toISOString(),
        };
      }

      for (let i = 0; i < legacy.length; i++) {
        const { character, originalPhysicalCount } = legacy[i];
        reportProgress(i + 1, legacy.length, 'characters');
        const outcome = await processOneCharacter(character);
        if (originalPhysicalCount > 1) outcome.physicalArrayTruncatedFrom = originalPhysicalCount;
        outcomes.push(outcome);
      }

      const blocked = outcomes.filter(o => o.action === 'blocked');
      if (blocked.length > 0) {
        const blockedList = blocked
          .map(o => `${o.name} (${o.id.slice(0, 8)}): ${o.blockedReason}`)
          .join('; ');
        const message = `Refusing to drop columns — ${blocked.length} character(s) blocked: ${blockedList}`;
        logger.error(message, ctx);
        return {
          id: MIGRATION_ID,
          success: false,
          itemsAffected: outcomes.filter(o => o.action !== 'blocked').length,
          message,
          error: 'characters blocked from cutover',
          durationMs: Date.now() - startTime,
          timestamp: new Date().toISOString(),
        };
      }

      // Final guard before destructive work: every character MUST now carry a
      // persisted vault link. `ensureCharacterVault` verifies its own link
      // write, but re-confirm against the DB here so a link that was lost for
      // any reason (e.g. a row write that vanished mid cloud-materialization)
      // blocks the column drop rather than hollowing the character — the legacy
      // content columns are about to disappear, and a null link would leave
      // nothing pointing at the vault that holds the content.
      const linkRows = db
        .prepare('SELECT id, name, characterDocumentMountPointId AS mp FROM characters')
        .all() as Array<{ id: string; name: string; mp: string | null }>;
      const unlinked = linkRows.filter(r => !r.mp);
      if (unlinked.length > 0) {
        const list = unlinked.map(r => `${r.name} (${r.id.slice(0, 8)})`).join('; ');
        const message =
          `Refusing to drop columns — ${unlinked.length} character(s) have no persisted ` +
          `vault link after cutover: ${list}. Aborting before destructive work.`;
        logger.error(message, ctx);
        return {
          id: MIGRATION_ID,
          success: false,
          itemsAffected: 0,
          message,
          error: 'characters missing vault link',
          durationMs: Date.now() - startTime,
          timestamp: new Date().toISOString(),
        };
      }

      // Schema mutations: one transaction, drop in order. (Reuses `db` opened
      // above for the raw character read.)
      const existingCols = new Set(getSQLiteTableColumns('characters').map(c => c.name));
      const dropping = COLUMNS_TO_DROP.filter(c => existingCols.has(c));
      logger.info('Dropping legacy content columns from characters', {
        ...ctx,
        columns: dropping,
      });
      const tx = db.transaction(() => {
        for (const col of dropping) {
          db.exec(`ALTER TABLE characters DROP COLUMN ${col}`);
        }
      });
      tx();

      const summary = summarizeOutcomes(outcomes, dropping.length);
      logger.info(summary, ctx);

      return {
        id: MIGRATION_ID,
        success: true,
        itemsAffected: legacy.length,
        message: summary,
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('cutover-characters-to-vault aborted', { ...ctx, error: errorMessage });
      return {
        id: MIGRATION_ID,
        success: false,
        itemsAffected: outcomes.filter(o => o.action !== 'blocked').length,
        message: 'cutover-characters-to-vault aborted',
        error: errorMessage,
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    }
  },
};

async function processOneCharacter(character: Character): Promise<CharacterOutcome> {
  const outcome: CharacterOutcome = {
    id: character.id,
    name: character.name,
    action: 'verified',
    flag: null,
    vaultMountPointId: character.characterDocumentMountPointId ?? null,
    missingAtStart: [],
    filledFromDb: [],
    scrubbedSystemTransparency: false,
    physicalArrayTruncatedFrom: 0,
  };

  // Step 1: ensure the vault exists.
  if (!character.characterDocumentMountPointId) {
    try {
      const provisioned = await ensureCharacterVault(character);
      outcome.vaultMountPointId = provisioned.mountPointId;
      if (provisioned.created) {
        outcome.action = 'vault-created';
        // ensureCharacterVault calls populate on create, so the vault is
        // now whole. Skip the missing-files branch.
        return outcome;
      }
    } catch (err) {
      outcome.action = 'blocked';
      outcome.blockedReason = `ensureCharacterVault failed: ${err instanceof Error ? err.message : String(err)}`;
      return outcome;
    }
  }

  const mountPointId = outcome.vaultMountPointId!;

  // Step 2: inspect vault state.
  const initial = await listVaultPaths(mountPointId);
  outcome.missingAtStart = initial.missing.slice();

  // Step 3: Post-cutover the schema no longer carries the
  // `readPropertiesFromDocumentStore` flag, so the only remaining path is
  // "DB row is authoritative; push it into the vault wholesale".
  try {
    const wardrobeItems = await getRepositories().wardrobe.findByCharacterIdRaw(character.id);
    await writeCharacterVaultManagedFields(mountPointId, { character });
    // Wardrobe is projected separately now that the full-character writer no
    // longer handles it. The raw DB rows are still the source here (the table
    // exists when this cutover runs) and project into the vault's Wardrobe/ folder.
    await projectVaultWardrobe(mountPointId, character.id, wardrobeItems);
    outcome.action = 'populated';
  } catch (err) {
    outcome.action = 'blocked';
    outcome.blockedReason = `populate failed: ${err instanceof Error ? err.message : String(err)}`;
    return outcome;
  }

  // Step 5: scrub the stopped-mirroring systemTransparency residue.
  try {
    outcome.scrubbedSystemTransparency = await scrubSystemTransparency(mountPointId, character.name);
  } catch (err) {
    logger.warn('Failed to scrub systemTransparency from properties.json', {
      context: `migration.${MIGRATION_ID}`,
      characterId: character.id,
      characterName: character.name,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // Step 6: re-verify. Anything still missing is a blocker.
  const final = await listVaultPaths(mountPointId);
  if (final.missing.length > 0) {
    outcome.action = 'blocked';
    outcome.blockedReason = `vault still missing files after cutover: ${final.missing.join(', ')}`;
  }

  return outcome;
}

function summarizeOutcomes(outcomes: CharacterOutcome[], droppedCount: number): string {
  const counts = {
    verified: 0,
    populated: 0,
    filledGaps: 0,
    vaultCreated: 0,
    scrubbed: 0,
    physicalTruncated: 0,
  };
  for (const o of outcomes) {
    if (o.action === 'verified') counts.verified++;
    else if (o.action === 'populated') counts.populated++;
    else if (o.action === 'filled-gaps') counts.filledGaps++;
    else if (o.action === 'vault-created') counts.vaultCreated++;
    if (o.scrubbedSystemTransparency) counts.scrubbed++;
    if (o.physicalArrayTruncatedFrom > 0) counts.physicalTruncated++;
  }
  return `Cutover complete — ${outcomes.length} character(s): ` +
    `${counts.verified} verified, ${counts.populated} populated, ` +
    `${counts.filledGaps} filled gaps, ${counts.vaultCreated} provisioned. ` +
    `${counts.scrubbed} properties.json scrubbed, ` +
    `${counts.physicalTruncated} physicalDescriptions truncated. ` +
    `${droppedCount} columns dropped.`;
}
