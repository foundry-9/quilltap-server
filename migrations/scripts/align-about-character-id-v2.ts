/**
 * Migration: Align Memory aboutCharacterId — v2 (holder-dominance tiebreaker)
 *
 * Follow-up to `align-about-character-id-v1`. v1 applied the rule:
 *   - About-character's name set must appear in summary + content; otherwise
 *     flip to holder.
 *
 * That left a tail of memories where the about-character was named once but
 * the holder was named more often — interior/self memories that mention the
 * about-character only in passing (e.g. "Friday calls Charlie a hinge…"). The
 * runtime check kept those attributed to the about-character because the v1
 * rule was a presence check, not a dominance check.
 *
 * v2 adds the dominance tiebreaker: when both names appear, count occurrences
 * for each. If the holder is mentioned **strictly more often** than the
 * about-character, the memory flips to a self-reference. Ties go to the about-
 * character (the original Q3 policy).
 *
 * v2 only touches rows that v1 *kept* attributed to a non-holder. Anything
 * v1 already flipped to self stays as-is.
 *
 * Migration ID: align-about-character-id-v2
 */

import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';
import { reportProgress } from '../lib/progress';
import {
  isSQLiteBackend,
  getSQLiteDatabase,
  sqliteTableExists,
} from '../lib/database-utils';

const MIGRATION_ID = 'align-about-character-id-v2';
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
  aboutCharacterId: string;
  content: string;
  summary: string;
}

interface CharacterRecord {
  id: string;
  name: string;
  aliases: string[];
  controlledBy: string;
  /** Names + aliases (+ generic-user aliases for `controlledBy: 'user'`). */
  aboutNames: string[];
  /** Names + aliases only — used when the character is the *holder*. */
  holderNames: string[];
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

function buildNameRegex(name: string, flags: string): RegExp {
  return new RegExp(`(^|[^\\p{L}\\p{N}_])${escapeRegex(name)}(?=$|[^\\p{L}\\p{N}_])`, flags);
}

function countNameOccurrences(names: readonly string[], haystack: string): number {
  if (!haystack) return 0;
  let total = 0;
  for (const raw of names) {
    const name = raw?.trim();
    if (!name) continue;
    const matches = haystack.match(buildNameRegex(name, 'giu'));
    if (matches) total += matches.length;
  }
  return total;
}

function buildCharacterRecord(row: CharacterRow): CharacterRecord {
  const aliases = parseAliases(row.aliases);
  const baseNames = [row.name, ...aliases].filter(n => typeof n === 'string' && n.trim().length > 0);
  const aboutNames =
    row.controlledBy === 'user' ? [...baseNames, ...USER_GENERIC_ALIASES] : baseNames;
  return {
    id: row.id,
    name: row.name,
    aliases,
    controlledBy: row.controlledBy,
    aboutNames,
    holderNames: baseNames,
  };
}

interface PerCharacterStats {
  flippedToSelf: number;
  untouched: number;
}

function ensureStats(map: Map<string, PerCharacterStats>, key: string): PerCharacterStats {
  let stats = map.get(key);
  if (!stats) {
    stats = { flippedToSelf: 0, untouched: 0 };
    map.set(key, stats);
  }
  return stats;
}

function needsWork(): boolean {
  if (!isSQLiteBackend()) return false;
  if (!sqliteTableExists('memories')) return false;
  if (!sqliteTableExists('characters')) return false;
  const db = getSQLiteDatabase();
  // Only candidates: rows where aboutCharacterId is set and differs from the
  // holder. v1 already cleared the obvious mis-attributions; v2's tiebreaker
  // works on the residual tail.
  const row = db
    .prepare(
      `SELECT 1 AS x FROM memories
        WHERE aboutCharacterId IS NOT NULL
          AND aboutCharacterId != ''
          AND aboutCharacterId != characterId
        LIMIT 1`,
    )
    .get() as { x: number } | undefined;
  return Boolean(row);
}

function runMigration(): MigrationResult {
  const startTime = Date.now();
  let itemsAffected = 0;

  try {
    const db = getSQLiteDatabase();

    const charRows = db
      .prepare('SELECT id, name, aliases, controlledBy FROM characters')
      .all() as CharacterRow[];
    const charMap = new Map<string, CharacterRecord>();
    for (const row of charRows) {
      charMap.set(row.id, buildCharacterRecord(row));
    }

    logger.info('Loaded character index for v2 alignment', {
      context: LOG_CONTEXT,
      totalCharacters: charMap.size,
    });

    const updateStmt = db.prepare(
      'UPDATE memories SET aboutCharacterId = ?, updatedAt = updatedAt WHERE id = ?',
    );

    const stats = new Map<string, PerCharacterStats>();
    let totalScanned = 0;
    let totalFlippedToSelf = 0;
    let lastId = '';

    // Count the candidate set upfront so reportProgress can show real x/total.
    const totalCandidatesRow = db
      .prepare(
        `SELECT COUNT(*) AS n FROM memories
         WHERE aboutCharacterId IS NOT NULL
           AND aboutCharacterId != ''
           AND aboutCharacterId != characterId`,
      )
      .get() as { n: number } | undefined;
    const totalCandidates = totalCandidatesRow?.n ?? 0;

    while (true) {
      const batch = db
        .prepare(
          `SELECT id, characterId, aboutCharacterId, content, summary
             FROM memories
             WHERE aboutCharacterId IS NOT NULL
               AND aboutCharacterId != ''
               AND aboutCharacterId != characterId
               AND id > ?
             ORDER BY id
             LIMIT ?`,
        )
        .all(lastId, BATCH_SIZE) as MemoryRow[];
      if (batch.length === 0) break;

      const tx = db.transaction((rows: MemoryRow[]) => {
        for (const row of rows) {
          totalScanned++;
          const holder = charMap.get(row.characterId);
          const aboutChar = charMap.get(row.aboutCharacterId);
          const holderStats = ensureStats(stats, row.characterId);

          // If we lost track of either side, leave the row alone.
          if (!holder || !aboutChar) {
            holderStats.untouched++;
            continue;
          }

          const text = `${row.summary || ''}\n${row.content || ''}`;
          const aboutCount = countNameOccurrences(aboutChar.aboutNames, text);
          // If the about-character isn't named at all, v1 already would have
          // flipped this — we don't expect to hit this branch, but if we do,
          // leave it (v1 is the canonical owner of that case).
          if (aboutCount === 0) {
            holderStats.untouched++;
            continue;
          }

          const holderCount = countNameOccurrences(holder.holderNames, text);
          if (holderCount > aboutCount) {
            updateStmt.run(holder.id, row.id);
            itemsAffected++;
            holderStats.flippedToSelf++;
            totalFlippedToSelf++;
          } else {
            holderStats.untouched++;
          }
        }
      });
      tx(batch);

      reportProgress(totalScanned, totalCandidates, 'memories');
      lastId = batch[batch.length - 1].id;
    }

    for (const [characterId, s] of stats) {
      if (s.flippedToSelf === 0) continue;
      const holder = charMap.get(characterId);
      logger.info('Memory aboutCharacterId v2 alignment summary', {
        context: LOG_CONTEXT,
        characterId,
        characterName: holder?.name ?? '(unknown)',
        flippedToSelf: s.flippedToSelf,
        untouched: s.untouched,
      });
    }

    const durationMs = Date.now() - startTime;
    return {
      id: MIGRATION_ID,
      success: true,
      itemsAffected,
      message: `v2 dominance pass: flipped ${totalFlippedToSelf} of ${totalScanned} candidate memories`,
      durationMs,
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('Align aboutCharacterId v2 migration failed', {
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

export const alignAboutCharacterIdV2Migration: Migration = {
  id: MIGRATION_ID,
  description:
    'Re-run aboutCharacterId alignment with the holder-dominance tiebreaker: when both holder and about-character are named in a memory, the holder wins on strict majority and the row flips to a self-reference.',
  introducedInVersion: '4.4.0',
  dependsOn: ['align-about-character-id-v1'],

  async shouldRun(): Promise<boolean> {
    return needsWork();
  },

  async run(): Promise<MigrationResult> {
    logger.info('Starting align aboutCharacterId v2 migration', { context: LOG_CONTEXT });
    return runMigration();
  },
};
