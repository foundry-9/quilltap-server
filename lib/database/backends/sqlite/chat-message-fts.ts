/**
 * The `chat_messages` full-text index — DDL, triggers and rebuild.
 *
 * This module is the SINGLE SOURCE OF TRUTH for the FTS5 schema behind global
 * message search. The migration that creates it, the startup guard that heals
 * it, and any future CLI verb all share these statements; nothing else may
 * spell this DDL, and nothing outside this module may write to
 * `chat_messages_fts` or `chat_messages_fts_map` — the triggers own them, and
 * {@link rebuildChatMessageFtsIndex} is the only bulk writer.
 *
 * ## Why an index at all
 *
 * Global message search used to be `content LIKE '%…%'` with no index that
 * could serve it: every search read the whole column (355 MB on the reference
 * instance, 55 ms). That full scan was also the one thing blocking
 * `chat_messages.content` from being stored brotli-compressed, because a
 * compressed BLOB cannot be `LIKE`-matched. Replacing the scan with an index
 * makes search ~250× faster AND unblocks the compression.
 *
 * ## Why contentless (`content=''`)
 *
 * An EXTERNAL-content FTS5 table reads the source column to tokenize it. Once
 * `content` holds a brotli BLOB, that would index the compressed bytes. A
 * CONTENTLESS table stores only the inverted index and never looks at the base
 * table, so it is correct regardless of how `content` is encoded. It also
 * halves the cost: 18.6 MB per 20,000 rows.
 *
 * Two consequences fall out of that choice:
 *
 * - `snippet()` / `highlight()` are unavailable — snippets are built in JS by
 *   the search route.
 * - `INSERT INTO chat_messages_fts(chat_messages_fts) VALUES('rebuild')` is
 *   REFUSED on a contentless table, which is why {@link rebuildChatMessageFtsIndex}
 *   deletes and re-inserts by hand.
 *
 * ## Why the id-mapping table
 *
 * `chat_messages` is declared `"id" TEXT PRIMARY KEY`, so its rowid is
 * IMPLICIT. FTS5 keys every index entry on an integer rowid, and a contentless
 * table can hand back nothing else. SQLite reserves the right to renumber the
 * implicit rowids of such a table during `VACUUM` (which
 * `npx quilltap db optimize` runs), and any table rebuild —
 * `CREATE new … INSERT … SELECT … DROP … RENAME` — reassigns every rowid AND
 * silently drops the triggers with the old table.
 *
 * `chat_messages_fts_map` gives the index a stable integer identity that
 * `VACUUM` never renumbers (an explicit `INTEGER PRIMARY KEY`), and its
 * `UNIQUE` message id makes the per-row trigger lookups O(log n).
 * `reconcileChatMessageFts()` catches the dropped-trigger case.
 *
 * ## Why triggers rather than repository hooks
 *
 * `chat_messages` is written from the parent process, from restore, from
 * migrations and from several repository methods. A trigger cannot be bypassed
 * by a new write path; an application-layer hook can, and silently.
 *
 * The triggers call `qt_text()` (see `./text-codec-function`), so a connection
 * that opens without it fails any write to `chat_messages` with
 * "no such function: qt_text". That is deliberate: a loud, immediate failure
 * beats silent index drift. Every connection this app opens registers it.
 *
 * @module lib/database/backends/sqlite/chat-message-fts
 */

import type { Database as DatabaseType } from 'better-sqlite3';
import { logger } from '@/lib/logger';

/** The contentless FTS5 index. */
export const CHAT_MESSAGE_FTS_TABLE = 'chat_messages_fts';

/** Stable integer identity for index entries; see the module doc. */
export const CHAT_MESSAGE_FTS_MAP_TABLE = 'chat_messages_fts_map';

/** The three sync triggers, in `sqlite_master` order-independent form. */
export const CHAT_MESSAGE_FTS_TRIGGERS = [
  'chat_messages_fts_ai',
  'chat_messages_fts_ad',
  'chat_messages_fts_au',
] as const;

/** Rows re-indexed per transaction during a rebuild. */
const REBUILD_BATCH_SIZE = 500;

/**
 * The eligibility filter, as a SQL fragment.
 *
 * Only `type='message'` rows with `role IN ('USER','ASSISTANT')` and non-null
 * `content` are indexed — exactly the filter global search has always applied,
 * so the index is as small as it can be while answering every question the
 * search bar asks. System events, informs and Staff messages stay
 * unsearchable, as they always have been.
 *
 * Lives here so the triggers, the counts and the rebuild cannot drift apart.
 *
 * @param alias table alias to qualify the columns with (`'m'` → `m."type"`),
 *   or `''` for an unqualified reference.
 */
export function chatMessageFtsEligibilitySql(alias = ''): string {
  const p = alias ? `${alias}.` : '';
  return `${p}"type" = 'message' AND ${p}"role" IN ('USER','ASSISTANT') AND ${p}"content" IS NOT NULL`;
}

/**
 * Every DDL statement, in dependency order. All `IF NOT EXISTS`, so replaying
 * them on a healthy instance is a no-op.
 */
export const CHAT_MESSAGE_FTS_SCHEMA_STATEMENTS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS "chat_messages_fts_map" (
  "ftsId"     INTEGER PRIMARY KEY,
  "messageId" TEXT NOT NULL UNIQUE
)`,

  `CREATE VIRTUAL TABLE IF NOT EXISTS "chat_messages_fts" USING fts5(
  content,
  content='',
  contentless_delete=1,
  tokenize='unicode61 remove_diacritics 2'
)`,

  // Eligibility is decided at INSERT time only. Nothing changes a row's `type`
  // or `role` after it is written, and the map's EXISTS guard keeps the other
  // two triggers correct either way.
  `CREATE TRIGGER IF NOT EXISTS "chat_messages_fts_ai" AFTER INSERT ON "chat_messages"
  WHEN new."type" = 'message' AND new."role" IN ('USER','ASSISTANT') AND new."content" IS NOT NULL
BEGIN
  INSERT INTO "chat_messages_fts_map"("messageId") VALUES (new."id");
  INSERT INTO "chat_messages_fts"(rowid, content)
    VALUES ((SELECT "ftsId" FROM "chat_messages_fts_map" WHERE "messageId" = new."id"),
            qt_text(new."content"));
END`,

  `CREATE TRIGGER IF NOT EXISTS "chat_messages_fts_ad" AFTER DELETE ON "chat_messages"
  WHEN EXISTS (SELECT 1 FROM "chat_messages_fts_map" WHERE "messageId" = old."id")
BEGIN
  DELETE FROM "chat_messages_fts"
    WHERE rowid = (SELECT "ftsId" FROM "chat_messages_fts_map" WHERE "messageId" = old."id");
  DELETE FROM "chat_messages_fts_map" WHERE "messageId" = old."id";
END`,

  // The guard compares DECODED TEXT, not bytes. An UPDATE that changes only
  // the encoding — which is exactly what `compress-chat-message-text-v1` does
  // to every row — leaves the index untouched. Without it that backfill would
  // delete and re-tokenize the whole table for nothing, and so would any
  // future codec version. It also means no migration ever has to drop and
  // recreate these triggers, which is one less thing to forget.
  `CREATE TRIGGER IF NOT EXISTS "chat_messages_fts_au" AFTER UPDATE OF "content" ON "chat_messages"
  WHEN qt_text(new."content") IS NOT qt_text(old."content")
   AND EXISTS (SELECT 1 FROM "chat_messages_fts_map" WHERE "messageId" = old."id")
BEGIN
  DELETE FROM "chat_messages_fts"
    WHERE rowid = (SELECT "ftsId" FROM "chat_messages_fts_map" WHERE "messageId" = old."id");
  INSERT INTO "chat_messages_fts"(rowid, content)
    VALUES ((SELECT "ftsId" FROM "chat_messages_fts_map" WHERE "messageId" = old."id"),
            qt_text(new."content"));
END`,
];

/**
 * Create the index, the map and the triggers if they are missing.
 *
 * Every statement is `IF NOT EXISTS`, so this is a cheap no-op on a healthy
 * instance and is safe to call from the migration and from every boot.
 */
export function ensureChatMessageFtsSchema(db: DatabaseType): void {
  for (const sql of CHAT_MESSAGE_FTS_SCHEMA_STATEMENTS) {
    db.exec(sql);
  }
}

/** Names of every schema object this module owns, for `sqlite_master` checks. */
export function chatMessageFtsObjectNames(): string[] {
  return [CHAT_MESSAGE_FTS_MAP_TABLE, CHAT_MESSAGE_FTS_TABLE, ...CHAT_MESSAGE_FTS_TRIGGERS];
}

/**
 * Report which of this module's schema objects are absent from `sqlite_master`.
 *
 * A table rebuild of `chat_messages` drops the triggers with the old table and
 * says nothing about it, so "which are missing" is the question the migration's
 * `shouldRun` and the startup guard both need answered.
 */
export function missingChatMessageFtsObjects(db: DatabaseType): string[] {
  const rows = db
    .prepare(
      `SELECT name FROM sqlite_master
        WHERE type IN ('table','trigger') AND name IN (${chatMessageFtsObjectNames()
          .map(() => '?')
          .join(',')})`,
    )
    .all(...chatMessageFtsObjectNames()) as { name: string }[];
  const present = new Set(rows.map((r) => r.name));
  return chatMessageFtsObjectNames().filter((n) => !present.has(n));
}

/** How many `chat_messages` rows the index is supposed to hold. */
export function countEligibleChatMessages(db: DatabaseType): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS n FROM "chat_messages" WHERE ${chatMessageFtsEligibilitySql()}`,
    )
    .get() as { n: number };
  return Number(row.n);
}

/** How many it actually holds. Counted on the map, which is a plain table. */
export function countIndexedChatMessages(db: DatabaseType): number {
  const row = db
    .prepare(`SELECT COUNT(*) AS n FROM "${CHAT_MESSAGE_FTS_MAP_TABLE}"`)
    .get() as { n: number };
  return Number(row.n);
}

export interface ChatMessageFtsRebuildResult {
  /** Rows read from `chat_messages`. */
  scanned: number;
  /** Rows written into the index. */
  indexed: number;
  /** Eligible rows counted up front (what `scanned` should reach). */
  total: number;
  durationMs: number;
}

/**
 * Drop and re-populate the index from `chat_messages`.
 *
 * FTS5 refuses `'rebuild'` on a contentless table, so this empties both tables
 * and walks the base table itself, keyset-paginated by `rowid`. A cursor on
 * the implicit rowid is fine WITHIN one run — the identity problem the mapping
 * table solves is about rowids changing across time, not during a walk.
 *
 * The text is read through `qt_text()`, so this is correct whether or not the
 * compression backfill has run.
 *
 * @param onProgress called once per batch with (scanned, total), for the
 *   migration's `reportProgress`.
 */
export function rebuildChatMessageFtsIndex(
  db: DatabaseType,
  onProgress?: (scanned: number, total: number) => void,
): ChatMessageFtsRebuildResult {
  const startedAt = Date.now();
  const total = countEligibleChatMessages(db);

  logger.debug('Rebuilding chat message FTS index', { total });

  db.exec(`DELETE FROM "${CHAT_MESSAGE_FTS_TABLE}"`);
  db.exec(`DELETE FROM "${CHAT_MESSAGE_FTS_MAP_TABLE}"`);

  const select = db.prepare(
    `SELECT rowid AS rid, "id" AS id, qt_text("content") AS text
       FROM "chat_messages"
      WHERE rowid > ? AND ${chatMessageFtsEligibilitySql()}
      ORDER BY rowid
      LIMIT ${REBUILD_BATCH_SIZE}`,
  );
  const insertMap = db.prepare(
    `INSERT INTO "${CHAT_MESSAGE_FTS_MAP_TABLE}"("messageId") VALUES (?)`,
  );
  const insertFts = db.prepare(
    `INSERT INTO "${CHAT_MESSAGE_FTS_TABLE}"(rowid, content) VALUES (?, ?)`,
  );

  interface Row {
    rid: number;
    id: string;
    text: string | null;
  }

  const apply = db.transaction((rows: Row[]) => {
    let written = 0;
    for (const row of rows) {
      const ftsId = insertMap.run(row.id).lastInsertRowid;
      insertFts.run(ftsId, row.text ?? '');
      written++;
    }
    return written;
  });

  let scanned = 0;
  let indexed = 0;
  let lastRowid = 0;
  for (;;) {
    const batch = select.all(lastRowid) as Row[];
    if (batch.length === 0) break;
    lastRowid = batch[batch.length - 1].rid;
    indexed += apply(batch) as number;
    scanned += batch.length;
    onProgress?.(scanned, total);
    logger.debug('Chat message FTS rebuild batch', { scanned, total });
  }

  const durationMs = Date.now() - startedAt;
  logger.debug('Chat message FTS index rebuilt', { scanned, indexed, total, durationMs });
  return { scanned, indexed, total, durationMs };
}
