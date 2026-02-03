/**
 * System Backup API v1 - Collection Endpoint
 *
 * POST /api/v1/system/backup - Create a new backup for download
 */

import { NextResponse } from 'next/server';
import { createAuthenticatedHandler } from '@/lib/api/middleware';
import { createBackup } from '@/lib/backup/backup-service';
import { storeTemporaryBackup } from '@/lib/backup/temporary-storage';
import { logger } from '@/lib/logger';
import { randomUUID } from 'crypto';
import { serverError } from '@/lib/api/responses';

// Extend timeout for backup operations
export const maxDuration = 300; // 5 minutes

/**
 * POST /api/v1/system/backup - Create a new backup
 */
export const POST = createAuthenticatedHandler(async (req, { user }) => {
  try {
    logger.info('[System Backup v1] Creating backup', {
      userId: user.id,
    });

    // Create the backup
    const { zipBuffer, manifest } = await createBackup(user.id);

    // Store temporarily for download
    const backupId = randomUUID();
    storeTemporaryBackup(backupId, zipBuffer, user.id);

    logger.info('[System Backup v1] Backup stored for download', {
      userId: user.id,
      backupId,
      expiresInMinutes: 30,
      manifest,
    });

    return NextResponse.json(
      {
        success: true,
        backupId,
        manifest,
      },
      { status: 201 }
    );
  } catch (error) {
    logger.error('[System Backup v1] Error creating backup', {}, error instanceof Error ? error : undefined);
    return serverError('Failed to create backup');
  }
});
