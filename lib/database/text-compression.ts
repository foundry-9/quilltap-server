/**
 * Text BLOB codec — brotli on disk, strings in memory.
 *
 * This module is the SINGLE SOURCE OF TRUTH for how large text columns are
 * (de)serialized to/from SQLite BLOBs. Every consumer (backend hydration,
 * repositories, migrations, the CLI) must decode through {@link blobToText}
 * and encode through {@link textToBlob} so the on-disk format can evolve
 * without touching the code that reads the text.
 *
 * It is a deliberate sibling of `lib/embedding/float32-conversion.ts` and
 * follows the same doctrine: a self-describing header, readers that accept
 * both the new format and the legacy plaintext, and a batched migration that
 * only reclaims bytes rather than being a correctness prerequisite.
 *
 * ## On-disk formats
 *
 * **Legacy (and still written for short values):** a plain TEXT string. No
 * header, byte-identical to what the column always held.
 *
 * **Compressed:** a BLOB with a 3-byte header.
 *
 * ```
 * Byte layout:
 *   [0]      magic   = 0x51   ('Q'; distinct from 0xEB, the embedding magic)
 *   [1]      version = 0x01
 *   [2]      codec   = 0x01   (brotli)
 *   [3..]    payload
 * ```
 *
 * A value is treated as compressed iff it is a Buffer whose magic, version
 * and codec byte are all recognised. Anything else — a string, or a Buffer
 * that fails the check — is returned as UTF-8 text. That tolerance is the
 * whole point: a column can hold a mix of compressed and plaintext rows
 * indefinitely, so a backfill can run late, run partially, or never run.
 *
 * ## Why there is a size floor
 *
 * Below {@link TEXT_COMPRESSION_MIN_BYTES} compression is a net LOSS: the
 * header plus brotli's own framing outweighs the gain, and short values stop
 * being greppable by tools that read the file directly. Measured on real
 * message rows, brotli quality 5 per row:
 *
 * ```
 *   <512 B    ~63% of original   ← a loss once framing is counted
 *   512B–1K    43%
 *   1K–4K      31%
 *   4K–16K     27%
 *   >16K       23%
 * ```
 *
 * Brotli q5 beat gzip -6 on the same corpus (28.8 MB vs 31.2 MB whole-file)
 * and is in the Node standard library, so this costs no dependency.
 *
 * @module lib/database/text-compression
 */

import { brotliCompressSync, brotliDecompressSync, constants } from 'zlib';

/** First byte of every compressed-text blob. */
export const TEXT_BLOB_MAGIC = 0x51;
/** Compressed-format version this codec reads and writes. */
export const TEXT_BLOB_VERSION = 0x01;
/** codec byte: brotli. */
export const TEXT_CODEC_BROTLI = 0x01;
/** Bytes of header before the payload. */
export const TEXT_BLOB_HEADER_BYTES = 3;

/**
 * Values shorter than this stay plaintext — see the module doc. Changing it
 * means re-running the measurement, not guessing.
 */
export const TEXT_COMPRESSION_MIN_BYTES = 512;

/**
 * Brotli quality for stored text. 5 is the knee of the curve: quality 11 buys
 * a few more percent for roughly an order of magnitude more CPU, which is a
 * bad trade on a write path that runs per message.
 */
export const TEXT_COMPRESSION_QUALITY = 5;

/**
 * Report whether a value is a compressed-text blob this codec can decode.
 *
 * Checks magic, version AND codec, so a future version byte is treated as
 * "not mine" rather than being mis-decoded by an older build.
 *
 * Deliberately NOT a `value is Buffer` type predicate: callers overwhelmingly
 * ask this about a value they have already established is a Buffer, and in
 * that position a predicate narrows the false branch to `never`.
 */
export function isCompressedTextBlob(value: unknown): boolean {
  if (!Buffer.isBuffer(value) || value.length < TEXT_BLOB_HEADER_BYTES) return false;
  return (
    value[0] === TEXT_BLOB_MAGIC &&
    value[1] === TEXT_BLOB_VERSION &&
    value[2] === TEXT_CODEC_BROTLI
  );
}

/**
 * Encode a string for storage.
 *
 * Returns the ORIGINAL STRING when the value is below the size floor or when
 * compression fails to make it smaller — so a caller can always store the
 * return value directly, and short rows keep their plain TEXT representation.
 */
export function textToBlob(value: string): Buffer | string {
  const raw = Buffer.from(value, 'utf-8');
  if (raw.length < TEXT_COMPRESSION_MIN_BYTES) return value;

  const compressed = brotliCompressSync(raw, {
    params: {
      [constants.BROTLI_PARAM_QUALITY]: TEXT_COMPRESSION_QUALITY,
      [constants.BROTLI_PARAM_SIZE_HINT]: raw.length,
    },
  });

  const total = compressed.length + TEXT_BLOB_HEADER_BYTES;
  // Incompressible input (already-compressed payloads, base64, random text)
  // can come out LARGER. Storing that would be strictly worse than the string.
  if (total >= raw.length) return value;

  const out = Buffer.allocUnsafe(total);
  out[0] = TEXT_BLOB_MAGIC;
  out[1] = TEXT_BLOB_VERSION;
  out[2] = TEXT_CODEC_BROTLI;
  compressed.copy(out, TEXT_BLOB_HEADER_BYTES);
  return out;
}

/**
 * Decode a stored value back to a string.
 *
 * Accepts compressed blobs, plain strings, plain (uncompressed) Buffers and
 * null/undefined. Never throws on an unrecognised shape — an undecodable
 * Buffer is read as UTF-8, which is exactly what a legacy plaintext row that
 * SQLite happened to hand back as a Buffer should become.
 */
export function blobToText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value;
  if (!Buffer.isBuffer(value)) return String(value);

  if (!isCompressedTextBlob(value)) return value.toString('utf-8');

  const payload = value.subarray(TEXT_BLOB_HEADER_BYTES);
  try {
    return brotliDecompressSync(payload).toString('utf-8');
  } catch {
    // A truncated or corrupt payload must not take down the read path; the
    // caller gets the best available reading of the bytes.
    return payload.toString('utf-8');
  }
}
