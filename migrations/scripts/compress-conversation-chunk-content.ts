/**
 * Migration: Compress `conversation_chunks.content`
 *
 * `conversation_chunks.content` is the rendered Scriptorium transcript — a
 * second copy of every message, re-emitted with `## Interchange N` headers by
 * `renderConversationMarkdown`. On the reference instance it held 142 MB
 * across 15,139 rows, against 355 MB of `chat_messages.content` it duplicates.
 *
 * It is wholly derived (compact backups drop the table outright as
 * "regenerable from the content above") and it is never SQL-searched: chunks
 * are fetched by id or chatId and ranked by embedding similarity. The literal
 * phrase boost in `lib/scriptorium/conversation-search.ts` runs in JavaScript
 * on already-hydrated rows, so it sees plaintext either way.
 *
 * The one raw-SQL reader that measures the text —
 * `lib/startup/reconcile-conversation-rendering.ts`, which compares
 * `LENGTH(content)` against `EMBEDDING_MAX_CHARS` and `CHUNK_CHAR_BUDGET` —
 * now wraps it in `qt_text()`, so it keeps counting CHARACTERS of the
 * rendered chunk rather than bytes of a brotli blob.
 *
 * Storage format and the size floor live in `lib/database/text-compression.ts`.
 * Reads tolerate plaintext, so this is byte reclamation, not a correctness
 * prerequisite.
 *
 * REVERSIBLE: brotli is lossless. And uniquely for this table, even total
 * loss is recoverable — a CONVERSATION_RENDER job rebuilds the rows from the
 * chat's messages.
 *
 * Rewriting rows only frees pages inside the file — run
 * `npx quilltap db optimize` afterwards to shrink it.
 *
 * Migration ID: compress-conversation-chunk-content-v1
 */

import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';
import { reportProgress } from '../lib/progress';
import { isSQLiteBackend, getSQLiteDatabase, sqliteTableExists } from '../lib/database-utils';
import { textToBlob, isCompressedTextBlob } from '@/lib/database/text-compression';

const MIGRATION_ID = 'compress-conversation-chunk-content-v1';

/** Rows fetched and rewritten per transaction. */
const BATCH_SIZE = 250;

/** shouldRun() samples at most this many rows. */
const SAMPLE_LIMIT = 50;

interface ChunkRow {
  rowid: number;
  content: unknown;
}

export const compressConversationChunkContentMigration: Migration = {
  id: MIGRATION_ID,
  description: 'Store conversation_chunks.content brotli-compressed',
  introducedInVersion: '4.10.0',
  dependsOn: ['sqlite-initial-schema-v1'],

  async shouldRun(): Promise<boolean> {
    if (!isSQLiteBackend()) return false;
    if (!sqliteTableExists('conversation_chunks')) return false;
    const db = getSQLiteDatabase();
    const rows = db
      .prepare(
        `SELECT "content" FROM "conversation_chunks"
          WHERE "content" IS NOT NULL AND length("content") >= 512
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

    const total = (
      db.prepare('SELECT COUNT(*) AS n FROM "conversation_chunks"').get() as { n: number }
    ).n;

    logger.info('Compressing conversation chunk content', {
      context: 'migrations.compress-conversation-chunk-content',
      rows: total,
    });

    const select = db.prepare(
      `SELECT rowid AS rowid, "content" FROM "conversation_chunks"
        WHERE rowid > ? ORDER BY rowid LIMIT ${BATCH_SIZE}`,
    );
    const update = db.prepare('UPDATE "conversation_chunks" SET "content" = ? WHERE rowid = ?');

    // Keyset-paginate by rowid so an in-flight rewrite cannot make the cursor
    // skip or repeat rows.
    let lastRowid = 0;
    for (;;) {
      const batch = select.all(lastRowid) as ChunkRow[];
      if (batch.length === 0) break;
      lastRowid = batch[batch.length - 1].rowid;

      const apply = db.transaction((rows: ChunkRow[]) => {
        for (const row of rows) {
          const value = row.content;
          if (value === null || value === undefined) continue;
          // Already done on a previous (interrupted) pass.
          if (Buffer.isBuffer(value) && isCompressedTextBlob(value)) continue;

          const text = Buffer.isBuffer(value) ? value.toString('utf-8') : String(value);
          const encoded = textToBlob(text);
          // Below the floor or incompressible — leave the plaintext alone.
          if (!Buffer.isBuffer(encoded)) continue;

          update.run(encoded, row.rowid);
          rewritten++;
          saved += Buffer.byteLength(text, 'utf-8') - encoded.length;
        }
      });
      apply(batch);

      scanned += batch.length;
      reportProgress(scanned, total, 'conversation chunks');
    }

    const savedMb = (saved / 1048576).toFixed(1);
    logger.info('Conversation chunk compression complete', {
      context: 'migrations.compress-conversation-chunk-content',
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
          ? `Compressed ${rewritten} conversation chunk${rewritten === 1 ? '' : 's'}, reclaiming ${savedMb} MB. ` +
            `Run 'npx quilltap db optimize' to shrink the file.`
          : 'No conversation chunk needed compressing',
      durationMs: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    };
  },
};
