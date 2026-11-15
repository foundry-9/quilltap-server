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
 * reintroduce the problem by forgetting. There are two sanctioned ways out:
 *
 * - `normalizeImages: false`, for byte-fidelity restores only;
 * - a path under `Themes/` in Quilltap General (`isThemeDraftStorePath`,
 *   `lib/themes/drafts/location.ts`), whoever writes it: a theme draft keeps
 *   its author's original images, and only the copy packed at install is
 *   converted (Calliope Live, Spec D, decision 11). The rule is keyed on
 *   store and path here, never a flag a caller remembers to pass.
 *
 * Two writers transcode before they reach `linkBlobContent` (`storeMountFile`
 * and `doc_write_blob`, which need the final extension to pick a free path);
 * they call {@link transcodeBlobForStore}, which applies the same exemption.
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
import { transcodeToWebP, normaliseBlobRelativePath, type TranscodeResult } from './blob-transcode';
import { createHash } from 'crypto';
import { isThemeDraftStorePath } from '@/lib/themes/drafts/location';

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
  /** The store being written; with the path, decides the theme-draft exemption. */
  mountPointId?: string;
}

/** True when an image at this store path is kept byte for byte (a theme draft's). */
async function keepsOriginalImage(mountPointId: string | undefined, relativePath: string): Promise<boolean> {
  return isThemeDraftStorePath(mountPointId, relativePath);
}

/**
 * The pre-link transcode for the writers that need the final extension
 * before they call `linkBlobContent`: `transcodeToWebP`, except that a theme
 * draft's image comes back untouched.
 */
export async function transcodeBlobForStore(input: {
  mountPointId: string;
  relativePath: string;
  data: Buffer;
  mimeType: string;
}): Promise<TranscodeResult> {
  if (await keepsOriginalImage(input.mountPointId, input.relativePath)) {
    logger.debug('Keeping a theme draft image byte for byte', {
      mountPointId: input.mountPointId,
      relativePath: input.relativePath,
      mimeType: input.mimeType,
      bytes: input.data.length,
    });
    return {
      data: input.data,
      storedMimeType: input.mimeType,
      sizeBytes: input.data.length,
      sha256: createHash('sha256').update(input.data).digest('hex'),
    };
  }
  return transcodeToWebP(input.data, input.mimeType);
}

/**
 * Transcode an image blob input to WebP where worthwhile, returning an input
 * with `data`, `sha256`, `storedMimeType`, `relativePath` and `fileName`
 * updated to agree with each other.
 *
 * Returns the input unchanged when normalization is disabled, when the path
 * is a theme draft's (see the module doc), when the bytes
 * are not a transcodable image, or when `transcodeToWebP` declines (a lossy
 * WebP, a small lossless one, or a sharp failure — all of which it reports by
 * handing the original bytes back).
 */
export async function normalizeLinkBlobImage<T extends NormalizableBlobInput>(
  input: T,
): Promise<T> {
  if (input.normalizeImages === false) return input;
  if (await keepsOriginalImage(input.mountPointId, input.relativePath)) {
    logger.debug('Leaving a theme draft image as written', {
      mountPointId: input.mountPointId,
      relativePath: input.relativePath,
      storedMimeType: input.storedMimeType,
    });
    return input;
  }

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
