/**
 * System Backup API v1 - Individual Backup Endpoint
 *
 * GET /api/v1/system/backup/[id] - Download a temporary backup
 */

import { NextResponse } from 'next/server';
import { createAuthenticatedParamsHandler } from '@/lib/api/middleware';
import { retrieveTemporaryBackup } from '@/lib/backup/temporary-storage';
import { logger } from '@/lib/logger';
import { notFound, serverError } from '@/lib/api/responses';

/**
 * GET /api/v1/system/backup/[id] - Download a backup
 */
export const GET = createAuthenticatedParamsHandler<{ id: string }>(
  async (req, { user }, { id }) => {
    try {
      // Look up temporary backup (also removes it from storage)
      const backupData = retrieveTemporaryBackup(id);

      if (!backupData) {
        logger.warn('[System Backup v1] Temporary backup not found', {
          backupId: id,
        });
        return notFound('Backup not found or has expired');
      }

      const zipBuffer = backupData.buffer;
      const filename = `quilltap-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.zip`;

      logger.info('[System Backup v1] Downloaded temporary backup', {
        backupId: id,
        userId: user.id,
        size: zipBuffer.length,
      });

      // Convert Buffer to Uint8Array for NextResponse compatibility
      const uint8Array = new Uint8Array(zipBuffer);

      return new NextResponse(uint8Array, {
        status: 200,
        headers: {
          'Content-Type': 'application/zip',
          'Content-Disposition': `attachment; filename="${filename}"`,
          'Content-Length': zipBuffer.length.toString(),
        },
      });
    } catch (error) {
      logger.error('[System Backup v1] Error downloading backup', {}, error instanceof Error ? error : undefined);
      return serverError('Failed to download backup');
    }
  }
);
