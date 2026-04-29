/**
 * Migration: Align Memory aboutCharacterId
 *
 * Backfill for the long-standing memory-extraction bug where every self-
 * referential memory (memories the character formed about themselves, via the
 * `extractCharacterMemoryFromMessage` pass) was written with
 * `aboutCharacterId = userCharacterId || null` — i.e. labelled as a memory
 * about the user rather than about the character.
 *
 * For every memory:
 *   - Build the name+alias set the about-character would plausibly be called
 *     by in the memory text. For user-controlled characters, augment that set
 *     with the generic "user" / "the user" labels that extraction prompts use.
 *   - If the about-character's name set does not appear in the memory text,
 *     flip `aboutCharacterId` to the holder's `characterId` (self-reference).
 *
 * For memories whose `aboutCharacterId IS NULL`:
 *   - If exactly one user-controlled character's name or aliases appears in
 *     the text, attribute the memory to that user persona.
 *   - Else if the generic "user"/"the user" appears AND there is exactly one
 *     user-controlled character system-wide, attribute to that persona.
 *   - Otherwise, flip to the holder (self-reference).
 *
 * Memories whose `aboutCharacterId` already equals the holder (true self-
 * reference) are left untouched, as are memories whose about-character's
 * name does appear in the text.
 *
 * Migration ID: align-about-character-id-v1
 */

import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';
import {
  isSQLiteBackend,
  getSQLiteDatabase,
  sqliteTableExists,
} from '../lib/database-utils';

const MIGRATION_ID = 'align-about-character-id-v1';
const LOG_CONTEXT = `migration.${MIGRATION_ID}`;
const BATCH_SIZE = 500;

const USER_GENERIC_ALIASES: readonly string[] = ['user', 'the user'];

interface CharacterRow {
  id: string;
  name: string;
  aliases: string;
  controlledBy: string;
}

interface MemoryRow {
  id: string;
  characterId: string;
  aboutCharacterId: string | null;
  content: string;
  summary: string;
}

function parseAliases(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((a): a is string => typeof a === 'string' && a.trim().length > 0);
  } catch {
    return [];
  }
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Word-boundary, case-insensitive presence check.
 *
 * Mirrors the runtime check in `lib/memory/about-character-resolution.ts`,
 * inlined here so the migration has no runtime dependency on app code that
 * may evolve independently.
 */
function nameAppears(names: readonly string[], haystack: string): boolean {
  if (!haystack) return false;
  for (const raw of names) {
    const name = raw?.trim();
    if (!name) continue;
    const re = new RegExp(`(^|[^\\p{L}\\p{N}_])${escapeRegex(name)}(?=$|[^\\p{L}\\p{N}_])`, 'iu');
    if (re.test(haystack)) return true;
  }
  return false;
}

interface CharacterRecord {
  id: string;
  name: string;
  aliases: string[];
  controlledBy: string;
  /** Names the about-character would plausibly appear by in memory text. */
  effectiveNames: string[];
}

function buildCharacterRecord(row: CharacterRow): CharacterRecord {
  const aliases = parseAliases(row.aliases);
  const effective: string[] = [row.name, ...aliases];
  if (row.controlledBy === 'user') {
    effective.push(...USER_GENERIC_ALIASES);
  }
  return {
    id: row.id,
    name: row.name,
    aliases,
    controlledBy: row.controlledBy,
    effectiveNames: effective.filter(n => typeof n === 'string' && n.trim().length > 0),
  };
}

interface PerCharacterStats {
  flippedToSelf: number;
  attributedToUserPersona: number;
  untouched: number;
}

function ensureStats(map: Map<string, PerCharacterStats>, key: string): PerCharacterStats {
  let stats = map.get(key);
  if (!stats) {
    stats = { flippedToSelf: 0, attributedToUserPersona: 0, untouched: 0 };
    map.set(key, stats);
  }
  return stats;
}

/**
 * Decide what aboutCharacterId a memory should carry after backfill.
 * Returns `null` to mean "leave unchanged" (callers compare against the
 * existing value to detect a flip), or a non-null id to set.
 *
 * Boolean second tuple element distinguishes the kind of write so we can
 * track per-character stats:
 *   - 'self'         → flipped to holder (new self-reference)
 *   - 'user-persona' → null row attributed to a specific user-controlled char
 *   - 'none'         → no change required
 */
function decideTarget(
  memory: MemoryRow,
  holder: CharacterRecord | undefined,
  aboutChar: CharacterRecord | undefined,
  userControlledChars: CharacterRecord[],
): { newTarget: string | null; kind: 'self' | 'user-persona' | 'none' } {
  if (!holder) {
    // Holder character has been deleted — nothing useful to do.
    return { newTarget: memory.aboutCharacterId, kind: 'none' };
  }
  const text = `${memory.summary || ''}\n${memory.content || ''}`;

  // Case 1: aboutCharacterId already points at the holder (true self-reference)
  if (memory.aboutCharacterId && memory.aboutCharacterId === memory.characterId) {
    return { newTarget: memory.aboutCharacterId, kind: 'none' };
  }

  // Case 2: aboutCharacterId is set, points at someone other than the holder
  if (memory.aboutCharacterId && aboutChar) {
    if (nameAppears(aboutChar.effectiveNames, text)) {
      return { newTarget: memory.aboutCharacterId, kind: 'none' };
    }
    return { newTarget: holder.id, kind: 'self' };
  }

  // Case 3: aboutCharacterId is set but the about-character no longer exists.
  // Apply the same heuristic but without name data — flip to self.
  if (memory.aboutCharacterId && !aboutChar) {
    return { newTarget: holder.id, kind: 'self' };
  }

  // Case 4: aboutCharacterId IS NULL — try to attribute to a user persona, then
  // fall back to self-reference per the migration rules.
  const specificMatches = userControlledChars.filter(c =>
    nameAppears([c.name, ...c.aliases].filter(n => n.trim().length > 0), text),
  );
  if (specificMatches.length === 1) {
    return { newTarget: specificMatches[0].id, kind: 'user-persona' };
  }
  if (specificMatches.length > 1) {
    // Ambiguous — text mentions multiple user personas by name; leave null.
    return { newTarget: null, kind: 'none' };
  }

  // No specific user-persona name matches — check for generic "user"/"the user".
  const hasGenericUser = nameAppears(USER_GENERIC_ALIASES, text);
  if (hasGenericUser && userControlledChars.length === 1) {
    return { newTarget: userControlledChars[0].id, kind: 'user-persona' };
  }
  if (hasGenericUser) {
    // Generic-user reference but multiple personas exist — ambiguous, leave null.
    return { newTarget: null, kind: 'none' };
  }

  // No user references at all — flip to holder per user directive.
  return { newTarget: holder.id, kind: 'self' };
}

function needsWork(): boolean {
  if (!isSQLiteBackend()) return false;
  if (!sqliteTableExists('memories')) return false;
  if (!sqliteTableExists('characters')) return false;
  const db = getSQLiteDatabase();
  const row = db.prepare('SELECT COUNT(*) AS c FROM memories LIMIT 1').get() as { c: number } | undefined;
  return Boolean(row && row.c > 0);
}

function runMigration(): MigrationResult {
  const startTime = Date.now();
  let itemsAffected = 0;

  try {
    const db = getSQLiteDatabase();

    // Load all characters into memory once. Even instances with thousands of
    // characters fit comfortably; the per-row alias parse is what we want to
    // amortise.
    const charRows = db
      .prepare('SELECT id, name, aliases, controlledBy FROM characters')
      .all() as CharacterRow[];

    const charMap = new Map<string, CharacterRecord>();
    const userControlled: CharacterRecord[] = [];
    for (const row of charRows) {
      const rec = buildCharacterRecord(row);
      charMap.set(rec.id, rec);
      if (rec.controlledBy === 'user') {
        userControlled.push(rec);
      }
    }

    logger.info('Loaded character index for memory alignment', {
      context: LOG_CONTEXT,
      totalCharacters: charMap.size,
      userControlledCharacters: userControlled.length,
    });

    const updateStmt = db.prepare(
      'UPDATE memories SET aboutCharacterId = ?, updatedAt = updatedAt WHERE id = ?',
    );

    const stats = new Map<string, PerCharacterStats>();
    let totalScanned = 0;
    let totalFlippedToSelf = 0;
    let totalAttributedToUser = 0;
    let lastId = '';

    // Stream rows in id-ordered batches so we never load 19k+ memories at once.
    while (true) {
      const batch = db
        .prepare(
          `SELECT id, characterId, aboutCharacterId, content, summary
             FROM memories
             WHERE id > ?
             ORDER BY id
             LIMIT ?`,
        )
        .all(lastId, BATCH_SIZE) as MemoryRow[];
      if (batch.length === 0) break;

      const tx = db.transaction((rows: MemoryRow[]) => {
        for (const row of rows) {
          totalScanned++;
          const holder = charMap.get(row.characterId);
          const aboutChar = row.aboutCharacterId ? charMap.get(row.aboutCharacterId) : undefined;
          const decision = decideTarget(row, holder, aboutChar, userControlled);

          const holderStats = ensureStats(stats, row.characterId);
          if (decision.kind === 'none' || decision.newTarget === row.aboutCharacterId) {
            holderStats.untouched++;
            continue;
          }

          updateStmt.run(decision.newTarget, row.id);
          itemsAffected++;
          if (decision.kind === 'self') {
            holderStats.flippedToSelf++;
            totalFlippedToSelf++;
          } else if (decision.kind === 'user-persona') {
            holderStats.attributedToUserPersona++;
            totalAttributedToUser++;
          }
        }
      });
      tx(batch);

      lastId = batch[batch.length - 1].id;
    }

    // Per-character summary in the migration log so we can spot-check after
    // the migration runs without needing to query the data manually.
    for (const [characterId, s] of stats) {
      if (s.flippedToSelf === 0 && s.attributedToUserPersona === 0) continue;
      const holder = charMap.get(characterId);
      logger.info('Memory aboutCharacterId alignment summary', {
        context: LOG_CONTEXT,
        characterId,
        characterName: holder?.name ?? '(unknown)',
        flippedToSelf: s.flippedToSelf,
        attributedToUserPersona: s.attributedToUserPersona,
        untouched: s.untouched,
      });
    }

    const durationMs = Date.now() - startTime;
    return {
      id: MIGRATION_ID,
      success: true,
      itemsAffected,
      message: `Aligned aboutCharacterId on ${itemsAffected} memories (${totalFlippedToSelf} → self, ${totalAttributedToUser} → user persona) across ${totalScanned} scanned`,
      durationMs,
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('Align aboutCharacterId migration failed', {
      context: LOG_CONTEXT,
      error: errorMessage,
    });
    return {
      id: MIGRATION_ID,
      success: false,
      itemsAffected,
      message: `Migration failed: ${errorMessage}`,
      error: errorMessage,
      durationMs: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    };
  }
}

export const alignAboutCharacterIdMigration: Migration = {
  id: MIGRATION_ID,
  description:
    'Backfill memories.aboutCharacterId so self-referential memories (and null rows) are correctly attributed: flip to holder when about-character name is absent; attribute null rows to a user persona when unambiguously named.',
  introducedInVersion: '4.4.0',
  dependsOn: ['sqlite-initial-schema-v1', 'rename-persona-columns-v1'],

  async shouldRun(): Promise<boolean> {
    return needsWork();
  },

  async run(): Promise<MigrationResult> {
    logger.info('Starting align aboutCharacterId migration', { context: LOG_CONTEXT });
    return runMigration();
  },
};
