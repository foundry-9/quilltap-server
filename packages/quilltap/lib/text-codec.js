'use strict';

/**
 * Text BLOB codec — the CLI's reader for compressed text columns.
 *
 * MIRROR OF `lib/database/text-compression.ts` in the server repo. The CLI is
 * published independently and cannot import from the app, so the format is
 * duplicated here deliberately. **If the header or codec changes there, change
 * it here in the same commit** — a stale copy shows the user mojibake.
 *
 * Format (see the server module for the reasoning):
 *   [0] magic 0x51 ('Q')  [1] version 0x01  [2] codec 0x01 (brotli)  [3..] payload
 *
 * Values under 512 bytes are stored as plain TEXT, so a column holds a mix of
 * compressed BLOBs and plain strings. `decodeText` accepts both, plus NULL and
 * uncompressed buffers, and never throws.
 */

const zlib = require('zlib');

const TEXT_BLOB_MAGIC = 0x51;
const TEXT_BLOB_VERSION = 0x01;
const TEXT_CODEC_BROTLI = 0x01;
const TEXT_BLOB_HEADER_BYTES = 3;

/** Does this value carry the compressed-text header? */
function isCompressedTextBlob(value) {
  if (!Buffer.isBuffer(value) || value.length < TEXT_BLOB_HEADER_BYTES) return false;
  return (
    value[0] === TEXT_BLOB_MAGIC &&
    value[1] === TEXT_BLOB_VERSION &&
    value[2] === TEXT_CODEC_BROTLI
  );
}

/** Decode a stored value to text. Total: never throws, never returns undefined. */
function decodeText(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value;
  if (!Buffer.isBuffer(value)) return String(value);
  if (!isCompressedTextBlob(value)) return value.toString('utf-8');

  const payload = value.subarray(TEXT_BLOB_HEADER_BYTES);
  try {
    return zlib.brotliDecompressSync(payload).toString('utf-8');
  } catch {
    return payload.toString('utf-8');
  }
}

/**
 * Register `qt_text()` on a connection, so raw SQL (`quilltap db "SELECT …"`,
 * `--repl`) can read inside a compressed column:
 *
 *   SELECT json_extract(qt_text(response), '$.error') FROM llm_logs;
 */
function registerTextCodecFunction(db) {
  db.function('qt_text', { deterministic: true }, (value) => decodeText(value));
}

module.exports = { decodeText, isCompressedTextBlob, registerTextCodecFunction };
