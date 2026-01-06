/**
 * File Serving API Route
 *
 * Serves files from the centralized file storage (local filesystem or S3).
 * GET /api/files/:id - Retrieve a file by ID
 * DELETE /api/files/:id - Delete a file by ID
 */

import { NextResponse } from 'next/server';
import { createAuthenticatedParamsHandler } from '@/lib/api/middleware';
import { logger } from '@/lib/logger';
import { notFound, badRequest, serverError, forbidden } from '@/lib/api/responses';
import { downloadFile as downloadS3File, getPresignedUrl, deleteFile as deleteS3File } from '@/lib/s3/operations';

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
 * GET /api/files/:id
 * Retrieve a file by its ID from S3 storage
 */
export const GET = createAuthenticatedParamsHandler<{ id: string }>(
  async (_request, { repos }, { id: fileId }) => {
    try {
      // Get file metadata from repository
      const fileEntry = await repos.files.findById(fileId);
      if (!fileEntry) {
        logger.debug('File not found', { context: 'GET /api/files/[id]', fileId });
        return notFound('File');
      }

      if (!fileEntry.s3Key) {
        logger.error('File has no S3 key - may need migration', { context: 'GET /api/files/[id]', fileId });
        return serverError('File not available - migration required');
      }

      logger.debug('Serving file from S3', { context: 'GET /api/files/[id]', fileId, s3Key: fileEntry.s3Key });

      // Check if we should use presigned URL redirect or proxy through API
      // For HTTP endpoints (e.g., local MinIO), we must proxy to avoid mixed content issues
      const s3Endpoint = process.env.S3_ENDPOINT || '';
      const isHttpEndpoint = s3Endpoint.startsWith('http://');
      const LARGE_FILE_THRESHOLD = 5 * 1024 * 1024; // 5MB

      // Use presigned URL redirect for large files ONLY if endpoint is HTTPS or AWS S3 (no custom endpoint)
      if (fileEntry.size > LARGE_FILE_THRESHOLD && !isHttpEndpoint) {
        logger.debug('File size exceeds threshold, generating presigned URL redirect', {
          context: 'GET /api/files/[id]',
          fileId,
          fileSize: fileEntry.size,
          threshold: LARGE_FILE_THRESHOLD,
        });

        const presignedUrl = await getPresignedUrl(fileEntry.s3Key);
        logger.debug('Presigned URL generated successfully', {
          context: 'GET /api/files/[id]',
          fileId,
          hasUrl: !!presignedUrl,
        });

        return NextResponse.redirect(presignedUrl);
      }

      // Download file and serve through API
      logger.debug('Downloading file from S3', {
        context: 'GET /api/files/[id]',
        fileId,
        fileSize: fileEntry.size,
      });

      const buffer = await downloadS3File(fileEntry.s3Key);

      logger.debug('File downloaded from S3', {
        context: 'GET /api/files/[id]',
        fileId,
        downloadedSize: buffer.length,
      });

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
      logger.error('Error serving file', { context: 'GET /api/files/[id]' }, error instanceof Error ? error : undefined);
      return serverError('Failed to serve file');
    }
  }
);

/**
 * DELETE /api/files/:id
 * Delete a file by its ID from S3 storage
 * Use ?force=true to delete even if file is linked to entities
 */
export const DELETE = createAuthenticatedParamsHandler<{ id: string }>(
  async (request, { repos }, { id: fileId }) => {
    try {
      // Check for force parameter
      const { searchParams } = new URL(request.url);
      const force = searchParams.get('force') === 'true';

      // Get file metadata from repository
      const fileEntry = await repos.files.findById(fileId);
      if (!fileEntry) {
        logger.debug('File not found', { context: 'DELETE /api/files/[id]', fileId });
        return notFound('File');
      }

      logger.debug('Deleting file', { context: 'DELETE /api/files/[id]', fileId, hasS3Key: !!fileEntry.s3Key, force });

      // Check if file is still linked to any entities (unless force=true)
      if (!force && fileEntry.linkedTo.length > 0) {
        logger.debug('Cannot delete file linked to entities', {
          context: 'DELETE /api/files/[id]',
          fileId,
          linkedToCount: fileEntry.linkedTo.length,
        });

        return badRequest(
          'Cannot delete file linked to chats, characters, or projects.',
          { linkedTo: fileEntry.linkedTo }
        );
      }

      // Delete from S3 if file has s3Key
      if (fileEntry.s3Key) {
        logger.debug('Deleting file from S3', {
          context: 'DELETE /api/files/[id]',
          fileId,
          s3Key: fileEntry.s3Key,
        });

        try {
          await deleteS3File(fileEntry.s3Key);
          logger.debug('File deleted from S3', {
            context: 'DELETE /api/files/[id]',
            fileId,
            s3Key: fileEntry.s3Key,
          });
        } catch (s3Error) {
          logger.warn('Failed to delete file from S3', {
            context: 'DELETE /api/files/[id]',
            fileId,
            s3Key: fileEntry.s3Key,
            error: s3Error instanceof Error ? s3Error.message : 'Unknown error',
          });
          // Continue with metadata deletion even if S3 deletion fails
        }
      }

      // Delete the file metadata from repository
      logger.debug('Deleting file metadata from repository', {
        context: 'DELETE /api/files/[id]',
        fileId,
      });

      const deleted = await repos.files.delete(fileId);

      if (!deleted) {
        logger.warn('File metadata not found when attempting deletion', {
          context: 'DELETE /api/files/[id]',
          fileId,
        });

        return notFound('File');
      }

      logger.info('File deleted successfully', {
        context: 'DELETE /api/files/[id]',
        fileId,
        hadS3Key: !!fileEntry.s3Key,
      });

      return NextResponse.json({ success: true });
    } catch (error) {
      logger.error('Error deleting file', { context: 'DELETE /api/files/[id]' }, error instanceof Error ? error : undefined);
      return serverError('Failed to delete file');
    }
  }
);

/**
 * PATCH /api/files/:id/unlink
 * Remove a link from a file
 */
export const PATCH = createAuthenticatedParamsHandler<{ id: string }>(
  async (request, { user, repos }, { id: fileId }) => {
    try {
      const { entityId } = await request.json();

      if (!entityId) {
        return badRequest('entityId is required');
      }

      // Get file metadata from repository (supports MongoDB and JSON backends)
      const fileEntry = await repos.files.findById(fileId);
      if (!fileEntry) {
        return notFound('File');
      }

      // Security: verify file belongs to user
      if (fileEntry.userId !== user.id) {
        return forbidden();
      }

      // Remove the link using repository
      const updated = await repos.files.removeLink(fileId, entityId);
      if (!updated) {
        return serverError('Failed to update file');
      }

      // If no more links, consider auto-deleting the file
      if (updated.linkedTo.length === 0) {
        // Optionally delete the file automatically
        // await deleteFile(fileId);
        // return NextResponse.json({ success: true, deleted: true });
      }

      return NextResponse.json({ success: true, file: updated });
    } catch (error) {
      logger.error('Error unlinking file', { context: 'PATCH /api/files/[id]' }, error instanceof Error ? error : undefined);
      return serverError('Failed to unlink file');
    }
  }
);
