/**
 * Migration: Compress `llm_logs.request` / `llm_logs.response`
 *
 * The LLM-logs database is almost entirely one column. On the reference
 * instance it held 318 MB, of which `request` was 295 MB across 5,736 rows —
 * a 51 KB average, because every call re-serializes the whole prompt payload:
 * the same system blocks, character sheets and conversation history, over and
 * over. It is the most compressible data in the instance, and it grows the
 * fastest: that 318 MB was **seven days** of logs, so the 30-day default
 * retention implies a ~1.3 GB table.
 *
 * Nothing text-searches these columns — they are fetched by id, or aggregated
 * on `usage` / `durationMs` — so compression costs no capability. The one
 * raw-SQL reader that reaches inside `response` (the `failures` count in
 * `USAGE_AGGREGATE_COLUMNS`) now wraps it in the `qt_text()` UDF.
 *
 * Storage format and the size floor live in `lib/database/text-compression.ts`.
 * Reads tolerate plaintext, so this migration is a byte-reclamation pass, not
 * a correctness prerequisite: new writes already compress, and a row this
 * migration never reaches keeps working.
 *
 * REVERSIBLE: brotli is lossless and `blobToText` reconstructs the original
 * string exactly. Unlike `quantize-embeddings-v1` there is nothing to
 * recompute if you roll back — though an older build without the codec would
 * read the BLOBs as mojibake, so roll the data back before the code.
 *
 * Rewriting rows only frees pages inside the file — run
 * `npx quilltap db optimize` afterwards to shrink it.
 *
 * Migration ID: compress-llm-log-payloads-v1
 */

import type { Database as DatabaseType } from 'better-sqlite3';
import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';
import { reportProgress } from '../lib/progress';
import { isSQLiteBackend, openLlmLogsDbIfPresent, tableExists } from '../lib/database-utils';
import { textToBlob, isCompressedTextBlob } from '@/lib/database/text-compression';

const MIGRATION_ID = 'compress-llm-log-payloads-v1';

/** Columns to re-pack. Must match LLM_LOG_COMPRESSED_COLUMNS in the repository. */
const COLUMNS = ['request', 'response'] as const;

/** Rows fetched and rewritten per transaction. */
const BATCH_SIZE = 250;

/** shouldRun() samples at most this many rows. */
const SAMPLE_LIMIT = 50;

interface LogRow {
  rowid: number;
  request: unknown;
  response: unknown;
}

/**
 * Re-pack one batch. Returns the number of rows actually rewritten and the
 * bytes saved. A value already compressed, below the size floor, or
 * incompressible is left exactly as it is — which is what makes the pass
 * idempotent and safe to resume after an interruption.
 */
function compressBatch(db: DatabaseType, rows: LogRow[]): { rewritten: number; saved: number } {
  let rewritten = 0;
  let saved = 0;

  const update = db.prepare(
    `UPDATE llm_logs SET "request" = ?, "response" = ? WHERE rowid = ?`,
  );

  const apply = db.transaction((batch: LogRow[]) => {
    for (const row of batch) {
      const next: Record<string, unknown> = {};
      let changed = false;
      let before = 0;
      let after = 0;

      for (const col of COLUMNS) {
        const value = row[col];
        if (value === null || value === undefined) {
          next[col] = null;
          continue;
        }
        if (Buffer.isBuffer(value) && isCompressedTextBlob(value)) {
          next[col] = value; // already done on a previous (interrupted) pass
          before += value.length;
          after += value.length;
          continue;
        }

        const text = Buffer.isBuffer(value) ? value.toString('utf-8') : String(value);
        const encoded = textToBlob(text);
        const originalBytes = Buffer.byteLength(text, 'utf-8');
        const encodedBytes = Buffer.isBuffer(encoded)
          ? encoded.length
          : Buffer.byteLength(encoded, 'utf-8');

        next[col] = encoded;
        before += originalBytes;
        after += encodedBytes;
        if (Buffer.isBuffer(encoded)) changed = true;
      }

      if (!changed) continue;
      update.run(next.request as never, next.response as never, row.rowid);
      rewritten++;
      saved += before - after;
    }
  });
  apply(rows);

  return { rewritten, saved };
}

export const compressLlmLogPayloadsMigration: Migration = {
  id: MIGRATION_ID,
  description: 'Store llm_logs.request / llm_logs.response brotli-compressed',
  introducedInVersion: '4.10.0',
  dependsOn: ['move-llm-logs-to-separate-db-v1'],

  async shouldRun(): Promise<boolean> {
    if (!isSQLiteBackend()) return false;
    const db = openLlmLogsDbIfPresent();
    if (!db) return false;
    try {
      if (!tableExists(db, 'llm_logs')) return false;
      const rows = db
        .prepare(
          `SELECT "request" FROM llm_logs
            WHERE "request" IS NOT NULL AND length("request") >= 512
            LIMIT ${SAMPLE_LIMIT}`,
        )
        .all() as { request: unknown }[];
      // Work remains if any sampled payload is still plaintext.
      return rows.some((r) => !(Buffer.isBuffer(r.request) && isCompressedTextBlob(r.request)));
    } finally {
      db.close();
    }
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();
    const db = openLlmLogsDbIfPresent();
    if (!db) {
      return {
        id: MIGRATION_ID,
        success: true,
        itemsAffected: 0,
        message: 'No LLM-logs database — nothing to compress',
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    }

    let rewritten = 0;
    let saved = 0;
    let scanned = 0;

    try {
      const total = (
        db.prepare('SELECT COUNT(*) AS n FROM llm_logs').get() as { n: number }
      ).n;

      logger.info('Compressing llm_logs payloads', {
        context: 'migrations.compress-llm-log-payloads',
        rows: total,
      });

      // Keyset-paginate by rowid so an in-flight rewrite cannot make the
      // cursor skip or repeat rows.
      let lastRowid = 0;
      const select = db.prepare(
        `SELECT rowid AS rowid, "request", "response" FROM llm_logs
          WHERE rowid > ? ORDER BY rowid LIMIT ${BATCH_SIZE}`,
      );

      for (;;) {
        const batch = select.all(lastRowid) as LogRow[];
        if (batch.length === 0) break;
        lastRowid = batch[batch.length - 1].rowid;

        const result = compressBatch(db, batch);
        rewritten += result.rewritten;
        saved += result.saved;
        scanned += batch.length;

        reportProgress(scanned, total, 'log entries');
      }
    } finally {
      db.close();
    }

    const savedMb = (saved / 1048576).toFixed(1);
    logger.info('LLM log payload compression complete', {
      context: 'migrations.compress-llm-log-payloads',
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
          ? `Compressed ${rewritten} log entr${rewritten === 1 ? 'y' : 'ies'}, reclaiming ${savedMb} MB. ` +
            `Run 'npx quilltap db optimize' to shrink the file.`
          : 'No log entry needed compressing',
      durationMs: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    };
  },
};
