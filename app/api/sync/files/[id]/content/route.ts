/**
 * Sync File Content API
 *
 * GET /api/sync/files/[id]/content
 *
 * Streams file content for large files that couldn't be included inline
 * in sync deltas. Used by remote instances during sync to fetch file
 * binary content separately from metadata.
 */

import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { getServerSession } from '@/lib/auth/session';
import { getAuthenticatedUserForSync } from '@/lib/sync/api-key-auth';
import { getRepositories } from '@/lib/mongodb/repositories';
import { fileStorageManager } from '@/lib/file-storage/manager';
import { createSyncLogCollector } from '@/lib/sync/sync-log-collector';

/**
 * GET /api/sync/files/[id]/content
 *
 * Stream file content to requesting instance.
 * Requires either session auth or sync API key.
 *
 * Returns:
 * - 200: File content as binary stream with appropriate Content-Type
 * - 401: Unauthorized
 * - 403: Forbidden (file belongs to different user)
 * - 404: File not found
 * - 500: Internal error
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const startTime = Date.now();
  const { id: fileId } = await params;
  const syncLogs = createSyncLogCollector();

  try {
    // Check authentication (via session or API key)
    const session = await getServerSession();
    const authResult = await getAuthenticatedUserForSync(req, session?.user?.id || null);

    if (!authResult.userId) {
      syncLogs.warn('Authentication failed', { fileId });
      logger.warn('Sync file content requested without authentication', {
        context: 'api:sync:files:content',
        fileId,
      });
      return NextResponse.json(
        { error: 'Unauthorized', serverLogs: syncLogs.getLogs() },
        { status: 401 }
      );
    }

    const userId = authResult.userId;

    logger.debug('Processing sync file content request', {
      context: 'api:sync:files:content',
      userId,
      fileId,
      authMethod: authResult.authMethod,
    });

    // Get file metadata
    const repos = getRepositories();
    const file = await repos.files.findById(fileId);

    if (!file) {
      syncLogs.warn('File not found in database', { fileId });
      logger.warn('Sync file content requested for non-existent file', {
        context: 'api:sync:files:content',
        userId,
        fileId,
      });
      return NextResponse.json(
        { error: 'File not found', serverLogs: syncLogs.getLogs() },
        { status: 404 }
      );
    }

    // Check ownership
    if (file.userId !== userId) {
      syncLogs.warn('File ownership mismatch', { fileId, fileOwnerId: file.userId, requestUserId: userId });
      logger.warn('Sync file content requested for file owned by another user', {
        context: 'api:sync:files:content',
        userId,
        fileId,
        fileOwnerId: file.userId,
      });
      return NextResponse.json(
        { error: 'Forbidden', serverLogs: syncLogs.getLogs() },
        { status: 403 }
      );
    }

    // Check if file has storage reference
    if (!file.storageKey) {
      syncLogs.error('File has no storage key (content not stored)', {
        fileId,
        filename: file.originalFilename,
        category: file.category,
      });
      logger.warn('Sync file content requested for file without storage key', {
        context: 'api:sync:files:content',
        userId,
        fileId,
      });
      return NextResponse.json(
        { error: 'File has no content (no storage key)', serverLogs: syncLogs.getLogs() },
        { status: 404 }
      );
    }

    // Download file content using the file storage manager
    let content: Buffer;
    try {
      content = await fileStorageManager.downloadFile(file);
    } catch (downloadError) {
      const duration = Date.now() - startTime;
      const errorMessage = downloadError instanceof Error ? downloadError.message : String(downloadError);
      const errorName = downloadError instanceof Error ? downloadError.name : 'UnknownError';

      syncLogs.error('File download failed', {
        fileId,
        filename: file.originalFilename,
        storageKey: file.storageKey,
        errorName,
        errorMessage,
      });

      logger.error('Failed to download file for sync', {
        context: 'api:sync:files:content',
        userId,
        fileId,
        storageKey: file.storageKey,
        error: errorMessage,
        durationMs: duration,
      });

      return NextResponse.json(
        {
          error: `Failed to download file: ${errorMessage}`,
          serverLogs: syncLogs.getLogs(),
        },
        { status: 500 }
      );
    }

    const duration = Date.now() - startTime;

    logger.info('Sync file content served', {
      context: 'api:sync:files:content',
      userId,
      fileId,
      size: content.length,
      mimeType: file.mimeType,
      durationMs: duration,
    });

    // Return content with appropriate headers (convert Buffer to Uint8Array for NextResponse)
    return new NextResponse(new Uint8Array(content), {
      status: 200,
      headers: {
        'Content-Type': file.mimeType || 'application/octet-stream',
        'Content-Length': String(content.length),
        'Content-Disposition': `attachment; filename="${encodeURIComponent(file.originalFilename)}"`,
        'X-File-Id': file.id,
        'X-File-SHA256': file.sha256 || '',
      },
    });
  } catch (error) {
    const duration = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);

    syncLogs.error('Unexpected error', { error: errorMessage });

    logger.error('Error serving sync file content', {
      context: 'api:sync:files:content',
      fileId,
      error: errorMessage,
      stack: error instanceof Error ? error.stack : undefined,
      durationMs: duration,
    });

    return NextResponse.json(
      { error: `Internal server error: ${errorMessage}`, serverLogs: syncLogs.getLogs() },
      { status: 500 }
    );
  }
}
