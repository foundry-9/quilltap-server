/**
 * Migration: Compress the four large `chat_messages` text columns
 *
 * `chat_messages` was 515 MB of a 932 MB main database, and 355 MB of that was
 * `content` — real prose, no slack, nothing derived. It cannot be deleted,
 * cold-tiered or regenerated. It can only be stored smaller.
 *
 * | Column         | Bytes  |
 * |----------------|-------:|
 * | `content`      | 355 MB |
 * | `opaqueContent`|  31 MB |
 * | `context`      | 6.3 MB |
 * | `description`  | 3.3 MB |
 *
 * `content` is the one large text column in the schema that was SEARCHED in
 * SQL, which is why it went last: `create-chat-message-fts-v1` replaced the
 * `LIKE` scan with an FTS5 index that tokenizes through `qt_text()` and so is
 * indifferent to how the column is encoded. Only once that shipped is
 * compressing this column safe — hence the `dependsOn`.
 *
 * The `AFTER UPDATE OF content` trigger compares DECODED TEXT, so re-encoding
 * a row is invisible to the index. This migration therefore does NOT drop and
 * recreate the triggers; 142,697 rows change encoding and not one index entry
 * is retokenized.
 *
 * Storage format and the 512-byte floor live in
 * `lib/database/text-compression.ts`. Reads tolerate plaintext, so this is
 * byte reclamation, not a correctness prerequisite — an instance that never
 * runs it keeps working.
 *
 * REVERSIBLE: brotli is lossless and `blobToText` reconstructs the exact
 * original string. `chat_messages.content` may change ENCODING, never
 * MEANING.
 *
 * Rewriting rows only frees pages inside the file — run
 * `npx quilltap db optimize` afterwards to shrink it.
 *
 * Migration ID: compress-chat-message-text-v1
 */

import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';
import { reportProgress } from '../lib/progress';
import { isSQLiteBackend, getSQLiteDatabase, sqliteTableExists } from '../lib/database-utils';
import {
  textToBlob,
  isCompressedTextBlob,
  TEXT_COMPRESSION_MIN_BYTES,
} from '@/lib/database/text-compression';

const MIGRATION_ID = 'compress-chat-message-text-v1';

/**
 * Rows fetched and rewritten per transaction. Lower than the conversation-chunk
 * migration's 250 would suggest is necessary only because message rows carry
 * four columns apiece; 250 keeps a batch's working set comparable.
 */
const BATCH_SIZE = 250;

/** shouldRun() samples at most this many rows. */
const SAMPLE_LIMIT = 50;

/** The columns registered as compressed in `lib/database/manager.ts`. */
const COLUMNS = ['content', 'opaqueContent', 'description', 'context'] as const;

type MessageRow = { rowid: number } & Record<(typeof COLUMNS)[number], unknown>;

export const compressChatMessageTextMigration: Migration = {
  id: MIGRATION_ID,
  description: 'Store the large chat_messages text columns brotli-compressed',
  introducedInVersion: '4.10.0',
  dependsOn: ['sqlite-initial-schema-v1', 'create-chat-message-fts-v1'],

  async shouldRun(): Promise<boolean> {
    if (!isSQLiteBackend()) return false;
    if (!sqliteTableExists('chat_messages')) return false;
    const db = getSQLiteDatabase();
    const rows = db
      .prepare(
        `SELECT "content" FROM "chat_messages"
          WHERE "content" IS NOT NULL AND length("content") >= ${TEXT_COMPRESSION_MIN_BYTES}
          LIMIT ${SAMPLE_LIMIT}`,
      )
      .all() as { content: unknown }[];
    return rows.some((r) => !(Buffer.isBuffer(r.content) && isCompressedTextBlob(r.content)));
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();
    const db = getSQLiteDatabase();

    let rewritten = 0;
    let saved = 0;
    let scanned = 0;

    const total = (db.prepare('SELECT COUNT(*) AS n FROM "chat_messages"').get() as { n: number })
      .n;

    logger.info('Compressing chat message text', {
      context: 'migrations.compress-chat-message-text',
      rows: total,
    });

    const select = db.prepare(
      `SELECT rowid AS rowid, ${COLUMNS.map((c) => `"${c}"`).join(', ')}
         FROM "chat_messages"
        WHERE rowid > ? ORDER BY rowid LIMIT ${BATCH_SIZE}`,
    );
    // One prepared UPDATE per column: a row typically needs exactly one of
    // them rewritten, and a combined statement would rewrite the other three
    // for nothing.
    const updates = {
      content: db.prepare('UPDATE "chat_messages" SET "content" = ? WHERE rowid = ?'),
      opaqueContent: db.prepare('UPDATE "chat_messages" SET "opaqueContent" = ? WHERE rowid = ?'),
      description: db.prepare('UPDATE "chat_messages" SET "description" = ? WHERE rowid = ?'),
      context: db.prepare('UPDATE "chat_messages" SET "context" = ? WHERE rowid = ?'),
    };

    // Keyset-paginate by rowid so an in-flight rewrite cannot make the cursor
    // skip or repeat rows.
    let lastRowid = 0;
    for (;;) {
      const batch = select.all(lastRowid) as MessageRow[];
      if (batch.length === 0) break;
      lastRowid = batch[batch.length - 1].rowid;

      const apply = db.transaction((rows: MessageRow[]) => {
        for (const row of rows) {
          for (const column of COLUMNS) {
            const value = row[column];
            if (value === null || value === undefined) continue;
            // Already done on a previous (interrupted) pass.
            if (Buffer.isBuffer(value) && isCompressedTextBlob(value)) continue;

            const text = Buffer.isBuffer(value) ? value.toString('utf-8') : String(value);
            const encoded = textToBlob(text);
            // Below the floor or incompressible — leave the plaintext alone.
            if (!Buffer.isBuffer(encoded)) continue;

            updates[column].run(encoded, row.rowid);
            rewritten++;
            saved += Buffer.byteLength(text, 'utf-8') - encoded.length;
          }
        }
      });
      apply(batch);

      scanned += batch.length;
      reportProgress(scanned, total, 'messages');
      logger.debug('Chat message compression batch', {
        context: 'migrations.compress-chat-message-text',
        scanned,
        total,
        rewritten,
      });
    }

    const savedMb = (saved / 1048576).toFixed(1);
    logger.info('Chat message compression complete', {
      context: 'migrations.compress-chat-message-text',
      scanned,
      rewritten,
      saved,
    });

    return {
      id: MIGRATION_ID,
      success: true,
      itemsAffected: rewritten,
      message:
        rewritten > 0
          ? `Compressed ${rewritten} message field${rewritten === 1 ? '' : 's'}, reclaiming ${savedMb} MB. ` +
            `Run 'npx quilltap db optimize' to shrink the file.`
          : 'No message text needed compressing',
      durationMs: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    };
  },
};
