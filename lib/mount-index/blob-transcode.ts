/**
 * Blob Transcoding Helpers
 *
 * Centralised WebP transcoding logic for Scriptorium blob uploads. Users may
 * upload PNG, JPEG, HEIC, GIF, TIFF, AVIF, etc. and we transcode those to
 * WebP before storing — this is lossy, but Scriptorium's database-backed
 * store isn't meant as a full-fidelity image repository (use a filesystem
 * store if that matters). Non-image MIME types are passed through untouched
 * so arbitrary binaries can live alongside images in the same store.
 *
 * ## Already-WebP uploads
 *
 * A *lossy* WebP is stored as-is: re-encoding lossy→lossy is generation loss
 * for a modest saving, so it is never worth it.
 *
 * A *lossless* WebP (a `VP8L` chunk) is a different animal and IS re-encoded
 * once it exceeds {@link LOSSLESS_WEBP_REENCODE_MIN_BYTES}. Lossless WebP of a
 * photographic image runs ~7× the size of the same picture at quality 85 —
 * measured at 1.9 MB vs 0.29 MB on real 1536×1024 story backgrounds. The size
 * floor spares small lossless assets (icons, diagrams, screenshots with hard
 * edges) where lossless is the right encoding and the saving is trivial.
 */

import { createHash } from 'crypto';
import sharp from 'sharp';
import { createServiceLogger } from '@/lib/logging/create-logger';

const logger = createServiceLogger('MountIndex:BlobTranscode');

// MIME types that sharp can reliably decode and we want to transcode to WebP.
// image/webp is deliberately absent — it is handled separately, because only
// the LOSSLESS variant is worth re-encoding (see the module doc).
const TRANSCODABLE_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/gif',
  'image/heic',
  'image/heif',
  'image/tiff',
  'image/avif',
]);

/**
 * Lossless WebP inputs at or above this many bytes are re-encoded to lossy
 * WebP. Below it, the saving does not justify discarding a deliberate
 * lossless encoding (icons, diagrams, hard-edged screenshots).
 */
export const LOSSLESS_WEBP_REENCODE_MIN_BYTES = 512 * 1024;

/**
 * Report whether a buffer is a lossless WebP.
 *
 * A WebP file is a RIFF container: `RIFF` + u32 size + `WEBP`, then a chunk
 * sequence. Lossless image data lives in a `VP8L` chunk; lossy lives in
 * `VP8 `. A `VP8X` (extended) file declares flags and then carries one of
 * those two, possibly behind `ICCP`/`ANIM`/`ALPH` chunks, so the whole chunk
 * list is walked rather than only the first fourcc being read.
 *
 * Returns false for anything that is not a well-formed WebP, so a malformed
 * or truncated buffer is left alone rather than re-encoded on a guess.
 */
export function isLosslessWebP(input: Buffer): boolean {
  if (input.length < 16) return false;
  if (input.toString('ascii', 0, 4) !== 'RIFF') return false;
  if (input.toString('ascii', 8, 12) !== 'WEBP') return false;

  // Walk the chunk list. Each chunk is: fourcc (4) + u32 payload size + payload,
  // padded to an even length.
  let offset = 12;
  while (offset + 8 <= input.length) {
    const fourcc = input.toString('ascii', offset, offset + 4);
    if (fourcc === 'VP8L') return true;
    if (fourcc === 'VP8 ') return false;
    const size = input.readUInt32LE(offset + 4);
    // A size that overflows the buffer means a malformed file — stop walking.
    if (size > input.length) return false;
    offset += 8 + size + (size % 2);
  }
  return false;
}

export interface TranscodeResult {
  data: Buffer;
  storedMimeType: string;
  sizeBytes: number;
  sha256: string;
}

/**
 * Normalise an uploaded image into WebP. For MIME types sharp cannot decode
 * (or non-image uploads when we eventually allow them) returns the original
 * bytes and MIME type unchanged.
 */
export async function transcodeToWebP(
  input: Buffer,
  originalMimeType: string,
  options: { quality?: number } = {}
): Promise<TranscodeResult> {
  const quality = options.quality ?? 85;
  const mime = originalMimeType.trim().toLowerCase().split(';')[0];

  // A large lossless WebP is re-encoded even though image/webp is not in the
  // transcodable set — see the module doc. A lossy WebP falls through to the
  // passthrough below and is never re-encoded.
  const reencodeLossless =
    mime === 'image/webp' &&
    input.length >= LOSSLESS_WEBP_REENCODE_MIN_BYTES &&
    isLosslessWebP(input);

  if (!reencodeLossless && !TRANSCODABLE_MIME_TYPES.has(mime)) {
    return {
      data: input,
      storedMimeType: originalMimeType,
      sizeBytes: input.length,
      sha256: createHash('sha256').update(input).digest('hex'),
    };
  }

  try {
    const webp = await sharp(input, { animated: true })
      .webp({ quality, effort: 4 })
      .toBuffer();
    const sha256 = createHash('sha256').update(webp).digest('hex');
    logger.debug('Transcoded blob to WebP', {
      originalMimeType: mime,
      inputBytes: input.length,
      outputBytes: webp.length,
      quality,
      reason: reencodeLossless ? 'lossless-webp-reencode' : 'bitmap-transcode',
    });
    return {
      data: webp,
      storedMimeType: 'image/webp',
      sizeBytes: webp.length,
      sha256,
    };
  } catch (error) {
    logger.warn('Failed to transcode blob to WebP; storing original bytes', {
      originalMimeType: mime,
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      data: input,
      storedMimeType: originalMimeType,
      sizeBytes: input.length,
      sha256: createHash('sha256').update(input).digest('hex'),
    };
  }
}

/**
 * Rewrite a blob's relativePath so the extension matches the storedMimeType.
 * Callers pass the user-chosen path (e.g. images/portrait.png); if we
 * transcode to WebP we rename the stored relativePath to images/portrait.webp
 * so Markdown references resolve predictably.
 */
export function normaliseBlobRelativePath(
  relativePath: string,
  storedMimeType: string
): string {
  if (storedMimeType !== 'image/webp') return relativePath;
  if (relativePath.toLowerCase().endsWith('.webp')) return relativePath;
  const lastDot = relativePath.lastIndexOf('.');
  if (lastDot === -1 || lastDot < relativePath.lastIndexOf('/')) {
    return `${relativePath}.webp`;
  }
  return `${relativePath.slice(0, lastDot)}.webp`;
}
