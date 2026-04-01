/**
 * Sync Files API v1 - Download files during sync
 *
 * GET /api/v1/sync/files/[id] - Download file content for sync
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  createAuthenticatedParamsHandler,
  checkOwnership,
} from '@/lib/api/middleware';
import { fileStorageManager } from '@/lib/file-storage/manager';
import { logger } from '@/lib/logger';
import { notFound, serverError } from '@/lib/api/responses';

// ============================================================================
// GET Handler
// ============================================================================

export const GET = createAuthenticatedParamsHandler<{ id: string }>(
  async (req, { user, repos }, { id }) => {
    try {
      logger.debug('[Sync Files v1] GET', { fileId: id, userId: user.id });

      const file = await repos.files?.findById(id);

      if (!checkOwnership(file, user.id)) {
        return notFound('File');
      }

      // Download file from storage
      const buffer = await fileStorageManager.downloadFile(file!);

      logger.info('[Sync Files v1] File downloaded', {
        fileId: id,
        size: buffer.length,
      });

      // Return file with appropriate headers
      const response = new NextResponse(buffer as any, {
        headers: {
          'Content-Type': file?.mimeType || 'application/octet-stream',
          'Content-Disposition': `attachment; filename="${file?.originalFilename}"`,
          'Content-Length': buffer.length.toString(),
        },
      });

      return response;
    } catch (error) {
      logger.error(
        '[Sync Files v1] Error downloading file',
        { fileId: id },
        error instanceof Error ? error : undefined
      );
      return serverError('Failed to download file');
    }
  }
);
