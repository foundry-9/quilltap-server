/**
 * The `qt_text()` SQL function — the codec, visible from SQL.
 *
 * Compressed text columns (`lib/database/text-compression.ts`) hold a BLOB.
 * The repository layer decodes them transparently, but **raw SQL does not go
 * through the repository layer**, and SQLite has no idea how to read brotli.
 * Any statement that looks *inside* such a column — `json_extract`, `LIKE`,
 * `length` on the text, an FTS trigger — must wrap it:
 *
 * ```sql
 * SELECT json_extract(qt_text("response"), '$.error') FROM llm_logs;
 * ```
 *
 * `qt_text` is deliberately total: it accepts a compressed BLOB, a plain
 * string, an uncompressed BLOB or NULL and always returns text or NULL. That
 * means a statement can wrap a column that is only PARTIALLY migrated — which
 * is the normal state, since reads tolerate plaintext and the backfill may
 * run late or not at all.
 *
 * Every connection that may run such SQL must register it, with the same
 * "before anything else touches the file" discipline as
 * {@link applySqlcipherKey}. A connection that misses it fails loudly with
 * "no such function: qt_text" rather than silently returning wrong answers —
 * which is the behaviour we want.
 *
 * @module lib/database/backends/sqlite/text-codec-function
 */

import type { Database as DatabaseType } from 'better-sqlite3';
import { blobToText } from '@/lib/database/text-compression';

/** The SQL-visible name. Referenced in raw SQL across the repositories. */
export const TEXT_CODEC_FUNCTION_NAME = 'qt_text';

/**
 * Register `qt_text(value)` on a connection.
 *
 * Idempotent in practice: better-sqlite3 replaces an existing definition of
 * the same name and arity, so a second call is harmless.
 */
export function registerTextCodecFunction(db: DatabaseType): void {
  db.function(TEXT_CODEC_FUNCTION_NAME, { deterministic: true }, (value: unknown) =>
    blobToText(value),
  );
}
