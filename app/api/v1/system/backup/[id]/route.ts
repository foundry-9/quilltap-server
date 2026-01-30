/**
 * System Backup API v1 - Individual Backup Endpoint
 *
 * GET /api/v1/system/backup/[id] - Download a backup
 * DELETE /api/v1/system/backup/[id] - Delete a backup
 *
 * Note: [id] can be either:
 * - A backupId (UUID) for temporary downloads
 * - An s3Key (path) for S3 downloads/deletion
 */

import { NextRequest, NextResponse } from 'next/server';
import { createAuthenticatedParamsHandler } from '@/lib/api/middleware';
import { deleteBackupFromS3, downloadBackupFromS3 } from '@/lib/backup/backup-service';
import { logger } from '@/lib/logger';
import { badRequest, forbidden, notFound, serverError } from '@/lib/api/responses';
import { temporaryBackups } from '../route';

/**
 * GET /api/v1/system/backup/[id] - Download a backup
 *
 * Query params:
 * - s3Key: If provided, downloads from S3. Otherwise uses [id] as temporary backupId.
 */
export const GET = createAuthenticatedParamsHandler<{ id: string }>(
  async (req, { user }, { id }) => {
    try {
      const { searchParams } = new URL(req.url);
      const s3Key = searchParams.get('s3Key');let zipBuffer: Buffer;
      let filename: string;

      if (s3Key) {
        // Download from S3
        // Security check: ensure the backup key belongs to this user
        const expectedPrefix = `users/${user.id}/backups/`;
        if (!s3Key.startsWith(expectedPrefix)) {
          logger.warn('[System Backup v1] Attempted to access backup from another user', {
            userId: user.id,
            s3Key,
          });
          return forbidden();
        }

        zipBuffer = await downloadBackupFromS3(user.id, s3Key);
        filename = s3Key.split('/').pop() || 'quilltap-backup.zip';

        logger.info('[System Backup v1] Downloaded backup from S3', {
          userId: user.id,
          s3Key,
          size: zipBuffer.length,
        });
      } else {
        // Look up temporary backup
        const backupData = temporaryBackups.get(id);

        if (!backupData) {
          logger.warn('[System Backup v1] Temporary backup not found', {
            backupId: id,
          });
          return notFound('Backup not found or has expired');
        }

        // Remove from temporary storage after retrieval
        temporaryBackups.delete(id);
        zipBuffer = backupData.buffer;
        filename = `quilltap-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.zip`;

        logger.info('[System Backup v1] Downloaded temporary backup', {
          backupId: id,
          size: zipBuffer.length,
        });
      }

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

/**
 * DELETE /api/v1/system/backup/[id] - Delete a backup from S3
 *
 * Body: { s3Key: string }
 */
export const DELETE = createAuthenticatedParamsHandler<{ id: string }>(
  async (req, { user }, { id }) => {
    try {
      const body = await req.json();
      const { s3Key } = body;

      if (!s3Key || typeof s3Key !== 'string') {
        return badRequest('Missing s3Key parameter');
      }

      // Security check: ensure the backup key belongs to this user
      const expectedPrefix = `users/${user.id}/backups/`;
      if (!s3Key.startsWith(expectedPrefix)) {
        logger.warn('[System Backup v1] Attempted to delete backup from another user', {
          userId: user.id,
          s3Key,
        });
        return forbidden();
      }await deleteBackupFromS3(user.id, s3Key);

      logger.info('[System Backup v1] Backup deleted', {
        userId: user.id,
        s3Key,
      });

      return NextResponse.json({ success: true });
    } catch (error) {
      logger.error('[System Backup v1] Error deleting backup', {}, error instanceof Error ? error : undefined);
      return serverError('Failed to delete backup');
    }
  }
);
