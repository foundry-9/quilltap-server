import { NextRequest, NextResponse } from 'next/server';
import type { RequestContext } from '@/lib/api/middleware';
import { fileStorageManager } from '@/lib/file-storage/manager';
import { FileContentMissingError } from '@/lib/file-storage/errors';
import { logger } from '@/lib/logger';
import { notFound, serverError } from '@/lib/api/responses';
import { dispositionFor } from '@/lib/api/content-disposition';
import { serveStoredBytes } from '@/lib/api/serve-stored-bytes';

/**
 * Serve a file's bytes.
 *
 * `?download=1` switches the Content-Disposition from `inline` to
 * `attachment`, so the browser saves rather than renders and the Electron
 * shell streams through its `will-download` handler instead of the renderer
 * buffering a 4K image into a Blob. Headers come from `serveStoredBytes`:
 * only passive types are ever inline.
 */
export async function handleDownloadFile(
  ctx: RequestContext,
  fileId: string,
  request?: NextRequest
): Promise<NextResponse> {
  const disposition = dispositionFor(request);
  try {
    const fileEntry = await ctx.repos.files.findById(fileId);
    if (!fileEntry) {
      return notFound('File');
    }

    if (!fileEntry.storageKey) {
      logger.error('[Files v1] File has no storage key', { fileId });
      return serverError('File not available - storage key missing');
    }

    const buffer = await fileStorageManager.downloadFile(fileEntry);

    logger.debug('[Files v1] Serving file bytes', { fileId, mimeType: fileEntry.mimeType, disposition });
    return serveStoredBytes(new Uint8Array(buffer), {
      mimeType: fileEntry.mimeType,
      filename: fileEntry.originalFilename,
      requested: disposition,
      cacheControl: 'public, max-age=31536000, immutable',
    });
  } catch (error) {
    // The row outlived its bytes (a dangling avatar, a deleted mount point).
    // That is permanent and the client's job to fall back from, so answer 404
    // rather than 500 — a server error invites a retry that can never work.
    if (error instanceof FileContentMissingError) {
      logger.warn('[Files v1] File row has no stored content', {
        fileId,
        storageKey: error.storageKey,
      });
      return notFound('File content');
    }
    logger.error('[Files v1] Error serving file', { fileId }, error instanceof Error ? error : undefined);
    return serverError('Failed to serve file');
  }
}
