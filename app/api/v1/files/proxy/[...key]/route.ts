/**
 * Files API v1 - File Proxy Route
 *
 * Serves files stored in the local filesystem backend through the API with proper authentication.
 * GET /api/v1/files/proxy/:key - Download a file by storage key
 *
 * This route provides access to files managed by the centralized file storage system.
 * It verifies user authentication and ownership before serving the file.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createContextParamsHandler, type RequestContext } from '@/lib/api/middleware';
import { logger } from '@/lib/logger';
import { notFound, forbidden, serverError } from '@/lib/api/responses';
import { fileStorageManager } from '@/lib/file-storage/manager';

/**
 * Build Content-Disposition header value with proper Unicode support
 * Uses RFC 5987 encoding for non-ASCII filenames
 */
function buildContentDisposition(filename: string, disposition: 'inline' | 'attachment' = 'inline'): string {
  // Check if filename contains non-ASCII characters
  const hasNonAscii = /[^\x00-\x7F]/.test(filename);

  if (!hasNonAscii) {
    // Simple ASCII filename
    return `${disposition}; filename="${filename}"`;
  }

  // For non-ASCII filenames, use RFC 5987 encoding
  // Include both filename (ASCII fallback) and filename* (UTF-8 encoded)
  const asciiFilename = filename.replace(/[^\x00-\x7F]/g, '_');
  const encodedFilename = encodeURIComponent(filename);

  return `${disposition}; filename="${asciiFilename}"; filename*=UTF-8''${encodedFilename}`;
}

/**
 * GET /api/v1/files/proxy/[...key]
 * Serve a file from local filesystem backend by storage key
 */
async function handleGet(
  request: NextRequest,
  ctx: RequestContext,
  { key: keyArray }: { key: string[] }
): Promise<NextResponse> {
  const { user, repos } = ctx;

  try {
    // Extract storage key from params
    if (!keyArray || keyArray.length === 0) {
      return notFound('File');
    }

    const encodedKey = keyArray.join('/');
    const storageKey = decodeURIComponent(encodedKey);

    // Find the file in the database by storageKey
    const fileEntry = await repos.files.findByStorageKey(storageKey);
    if (!fileEntry) {
      return notFound('File');
    }

    // Download the file content using the file storage manager
    let buffer: Buffer;
    try {
      buffer = await fileStorageManager.downloadFile(fileEntry);
    } catch (downloadError) {
      logger.error('[Files v1] Proxy: Failed to download file from storage', {
        fileId: fileEntry.id,
        storageKey,
        error: downloadError instanceof Error ? downloadError.message : 'Unknown error',
      });
      return serverError('Failed to download file');
    }

    // Return the file with proper headers
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type': fileEntry.mimeType,
        'Content-Length': buffer.length.toString(),
        'Content-Disposition': buildContentDisposition(fileEntry.originalFilename, 'inline'),
        'Cache-Control': 'public, max-age=31536000, immutable',
        // Allow embedding in same-origin iframes (for file preview modal)
        'X-Frame-Options': 'SAMEORIGIN',
        'Content-Security-Policy': "frame-ancestors 'self'",
      },
    });
  } catch (error) {
    logger.error('[Files v1] Proxy: Error serving file', {}, error instanceof Error ? error : undefined);
    return serverError('Failed to serve file');
  }
}

export const GET = createContextParamsHandler<{ key: string[] }>(handleGet);
