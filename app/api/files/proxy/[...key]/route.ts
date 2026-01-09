/**
 * File Proxy Route - Local Filesystem Backend
 *
 * Serves files stored in the local filesystem backend through the API with proper authentication.
 * GET /api/files/proxy/:key - Download a file by storage key
 *
 * This route provides access to files managed by the centralized file storage system.
 * It verifies user authentication and ownership before serving the file.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/lib/auth/session';
import { getRepositories } from '@/lib/repositories/factory';
import { logger } from '@/lib/logger';
import { notFound, forbidden, serverError } from '@/lib/api/responses';
import { fileStorageManager } from '@/lib/file-storage/manager';

const context = 'GET /api/files/proxy/[...key]';

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
 * GET /api/files/proxy/[...key]
 * Serve a file from local filesystem backend by storage key
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ key: string[] }> }
) {
  try {
    // Get and verify authentication
    const session = await getServerSession();
    if (!session?.user?.id) {
      logger.debug('Unauthorized request - no valid session', { context });
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const repos = getRepositories();
    const user = await repos.users.findById(session.user.id);
    if (!user) {
      logger.warn('User not found for session', { context, userId: session.user.id });
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // Extract storage key from params
    const { key: keyArray } = await params;
    if (!keyArray || keyArray.length === 0) {
      logger.debug('No storage key provided', { context });
      return notFound('File');
    }

    const encodedKey = keyArray.join('/');
    const storageKey = decodeURIComponent(encodedKey);

    logger.debug('File proxy request', {
      context,
      userId: user.id,
      encodedKey,
      storageKey,
    });

    // Find the file in the database by storageKey
    const fileEntry = await repos.files.findByStorageKey(storageKey);
    if (!fileEntry) {
      logger.debug('File not found by storage key', {
        context,
        userId: user.id,
        storageKey,
      });
      return notFound('File');
    }

    // Verify the user has access to this file
    if (fileEntry.userId !== user.id) {
      logger.warn('Unauthorized file access attempt', {
        context,
        userId: user.id,
        fileUserId: fileEntry.userId,
        fileId: fileEntry.id,
        storageKey,
      });
      return forbidden();
    }

    logger.debug('User verified for file access', {
      context,
      userId: user.id,
      fileId: fileEntry.id,
      filename: fileEntry.originalFilename,
      mimeType: fileEntry.mimeType,
    });

    // Download the file content using the file storage manager
    let buffer: Buffer;
    try {
      buffer = await fileStorageManager.downloadFile(fileEntry);

      logger.debug('File downloaded successfully', {
        context,
        fileId: fileEntry.id,
        downloadedSize: buffer.length,
        expectedSize: fileEntry.size,
      });
    } catch (downloadError) {
      logger.error('Failed to download file from storage', {
        context,
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
    logger.error('Error serving file from proxy', { context }, error instanceof Error ? error : undefined);
    return serverError('Failed to serve file');
  }
}
