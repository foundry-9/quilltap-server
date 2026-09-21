/**
 * Blob image normalization — the write-side chokepoint.
 *
 * Every byte that reaches `doc_mount_blobs` passes through
 * `linkBlobContent`, and `linkBlobContent` passes it through here first. That
 * is deliberate: transcoding used to be a courtesy each call site could
 * decline, and most of them did.
 *
 * On the Friday instance that left 68 untranscoded PNGs (96.5 MB, one avatar
 * at 6.77 MB where the shipped WebP is ~50 KB) and 71 oversized lossless WebP
 * (112 MB). Re-encoded at quality 85 those measure ~7% and ~15% of their
 * stored size respectively. The call sites that skipped transcoding were:
 * `mount-index/conversion.ts` (the filesystem→DB cutover, which produced the
 * whole 2026-04-23 batch), `mount-index/file-ops.ts` (copy/move),
 * `mount-index/sync/apply-store.ts`, and the three photo-gallery services.
 *
 * Normalizing here rather than at each caller means a NEW write path cannot
 * reintroduce the problem by forgetting. The one sanctioned way out is
 * `normalizeImages: false`, for byte-fidelity restores only.
 *
 * Rewriting the bytes also rewrites `storedMimeType`, `relativePath` and
 * `fileName`, so the row never claims to hold a PNG while holding WebP — the
 * mismatch that `normaliseBlobRelativePath` exists to prevent, now applied on
 * every path instead of two.
 *
 * @module lib/mount-index/normalize-blob-image
 */

import { basename } from 'path';
import { createServiceLogger } from '@/lib/logging/create-logger';
import { transcodeToWebP, normaliseBlobRelativePath } from './blob-transcode';

const logger = createServiceLogger('MountIndex:NormalizeBlobImage');

/** The subset of a blob-write input this module reads and may rewrite. */
export interface NormalizableBlobInput {
  relativePath: string;
  fileName: string;
  originalMimeType: string;
  storedMimeType: string;
  sha256: string;
  data: Buffer;
  normalizeImages?: boolean;
}

/**
 * Transcode an image blob input to WebP where worthwhile, returning an input
 * with `data`, `sha256`, `storedMimeType`, `relativePath` and `fileName`
 * updated to agree with each other.
 *
 * Returns the input unchanged when normalization is disabled, when the bytes
 * are not a transcodable image, or when `transcodeToWebP` declines (a lossy
 * WebP, a small lossless one, or a sharp failure — all of which it reports by
 * handing the original bytes back).
 */
export async function normalizeLinkBlobImage<T extends NormalizableBlobInput>(
  input: T,
): Promise<T> {
  if (input.normalizeImages === false) return input;

  // The stored type is what the serving routes trust, so it — not the
  // original upload's claim — is what decides whether there is work to do.
  const transcoded = await transcodeToWebP(input.data, input.storedMimeType);
  if (transcoded.data === input.data) return input;

  const relativePath = normaliseBlobRelativePath(
    input.relativePath,
    transcoded.storedMimeType,
  );
  // fileName must track the path, or the link row advertises the old
  // extension while the path carries the new one.
  const fileName =
    relativePath === input.relativePath ? input.fileName : basename(relativePath);

  logger.debug('Normalized blob image before storage', {
    relativePath: input.relativePath,
    finalRelativePath: relativePath,
    fromMimeType: input.storedMimeType,
    toMimeType: transcoded.storedMimeType,
    fromBytes: input.data.length,
    toBytes: transcoded.sizeBytes,
  });

  return {
    ...input,
    data: transcoded.data,
    sha256: transcoded.sha256,
    storedMimeType: transcoded.storedMimeType,
    relativePath,
    fileName,
  };
}
