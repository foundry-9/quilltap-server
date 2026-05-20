/**
 * Blob Transcoding Helpers
 *
 * Centralised WebP transcoding logic for Scriptorium blob uploads. Users may
 * upload PNG, JPEG, HEIC, GIF, TIFF, AVIF, etc. and we transcode those to
 * WebP before storing — this is lossy, but Scriptorium's database-backed
 * store isn't meant as a full-fidelity image repository (use a filesystem
 * store if that matters). Already-WebP uploads are stored as-is without
 * re-encoding. Non-image MIME types are passed through untouched so arbitrary
 * binaries can live alongside images in the same store.
 */

import { createHash } from 'crypto';
import sharp from 'sharp';
import { createServiceLogger } from '@/lib/logging/create-logger';

const logger = createServiceLogger('MountIndex:BlobTranscode');

// MIME types that sharp can reliably decode and we want to transcode to WebP.
// image/webp is deliberately absent: already-WebP uploads are stored as-is.
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

  if (!TRANSCODABLE_MIME_TYPES.has(originalMimeType.toLowerCase())) {
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
    return {
      data: webp,
      storedMimeType: 'image/webp',
      sizeBytes: webp.length,
      sha256,
    };
  } catch (error) {
    logger.warn('Failed to transcode blob to WebP; storing original bytes', {
      originalMimeType,
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
