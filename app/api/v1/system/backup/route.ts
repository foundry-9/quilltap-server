/**
 * System Backup API v1 - Collection Endpoint
 *
 * GET /api/v1/system/backup - List all backups for the current user
 * POST /api/v1/system/backup - Create a new backup (destination: download | s3)
 */

import { NextRequest, NextResponse } from 'next/server';
import { createAuthenticatedHandler } from '@/lib/api/middleware';
import { listS3Backups, createBackup, saveBackupToS3 } from '@/lib/backup/backup-service';
import { logger } from '@/lib/logger';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { serverError, validationError } from '@/lib/api/responses';

// Extend timeout for backup operations
export const maxDuration = 300; // 5 minutes

const CreateBackupSchema = z.object({
  destination: z.enum(['download', 's3']),
  filename: z.string().optional(),
});

// Store for temporary backup buffers (backupId -> buffer)
// In production, this could be replaced with a distributed cache like Redis
const temporaryBackups = new Map<string, { buffer: Buffer; createdAt: Date }>();

// Clean up old backups every minute (older than 30 minutes)
const BACKUP_EXPIRY_MS = 30 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 60 * 1000;

let cleanupInterval: ReturnType<typeof setInterval> | null = null;

function startCleanup() {
  if (cleanupInterval) return;

  cleanupInterval = setInterval(() => {
    const now = new Date();
    for (const [backupId, data] of temporaryBackups.entries()) {
      if (now.getTime() - data.createdAt.getTime() > BACKUP_EXPIRY_MS) {
        temporaryBackups.delete(backupId);
        logger.debug('[System Backup v1] Cleaned up expired backup', { backupId });
      }
    }
  }, CLEANUP_INTERVAL_MS);
}

/**
 * GET /api/v1/system/backup - List all backups
 */
export const GET = createAuthenticatedHandler(async (req, { user }) => {
  try {
    logger.debug('[System Backup v1] Listing backups', { userId: user.id });

    const backups = await listS3Backups(user.id);

    logger.info('[System Backup v1] Backups listed', {
      userId: user.id,
      count: backups.length,
    });

    // Convert Date objects to ISO strings for JSON serialization
    const backupsJson = backups.map((backup) => ({
      key: backup.key,
      filename: backup.filename,
      createdAt: backup.createdAt.toISOString(),
      size: backup.size,
    }));

    return NextResponse.json({
      backups: backupsJson,
      count: backupsJson.length,
    });
  } catch (error) {
    logger.error('[System Backup v1] Error listing backups', {}, error instanceof Error ? error : undefined);
    return serverError('Failed to list backups');
  }
});

/**
 * POST /api/v1/system/backup - Create a new backup
 */
export const POST = createAuthenticatedHandler(async (req, { user }) => {
  startCleanup();

  try {
    const body = await req.json();
    const { destination, filename } = CreateBackupSchema.parse(body);

    logger.info('[System Backup v1] Creating backup', {
      userId: user.id,
      destination,
    });

    // Create the backup
    const { zipBuffer, manifest } = await createBackup(user.id);

    logger.debug('[System Backup v1] Backup created', {
      userId: user.id,
      zipSize: zipBuffer.length,
      entityCounts: manifest.counts,
    });

    if (destination === 's3') {
      // Save to S3
      const s3Key = await saveBackupToS3(user.id, zipBuffer, filename);

      logger.info('[System Backup v1] Backup saved to S3', {
        userId: user.id,
        s3Key,
      });

      return NextResponse.json(
        {
          success: true,
          s3Key,
        },
        { status: 201 }
      );
    } else {
      // Store temporarily for download
      const backupId = randomUUID();
      temporaryBackups.set(backupId, {
        buffer: zipBuffer,
        createdAt: new Date(),
      });

      logger.info('[System Backup v1] Backup stored for download', {
        userId: user.id,
        backupId,
        expiresInMinutes: BACKUP_EXPIRY_MS / 60 / 1000,
      });

      return NextResponse.json(
        {
          success: true,
          backupId,
        },
        { status: 201 }
      );
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      return validationError(error);
    }

    logger.error('[System Backup v1] Error creating backup', {}, error instanceof Error ? error : undefined);
    return serverError('Failed to create backup');
  }
});

// Export for use in download route
export { temporaryBackups };
