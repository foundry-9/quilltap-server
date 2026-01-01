/**
 * Backup Create Endpoint
 * POST /api/tools/backup/create - Create a backup and optionally save to S3
 *
 * Request body:
 * {
 *   destination: 'download' | 's3'
 *   filename?: string (optional custom filename for S3)
 * }
 *
 * Response (download):
 * { success: true, backupId: string }
 *
 * Response (s3):
 * { success: true, s3Key: string }
 */

import { NextRequest, NextResponse } from 'next/server'
import { createAuthenticatedHandler } from '@/lib/api/middleware'
import { createBackup, saveBackupToS3 } from '@/lib/backup/backup-service'
import { logger } from '@/lib/logger'
import { z } from 'zod'
import { randomUUID } from 'crypto'

// Extend timeout for backup operations - backups can take several minutes for large datasets
export const maxDuration = 300 // 5 minutes

const CreateBackupSchema = z.object({
  destination: z.enum(['download', 's3']),
  filename: z.string().optional(),
})

// Store for temporary backup buffers (backupId -> buffer)
// In production, this could be replaced with a distributed cache like Redis
const temporaryBackups = new Map<string, { buffer: Buffer; createdAt: Date }>()

// Clean up old backups every minute (older than 30 minutes)
const BACKUP_EXPIRY_MS = 30 * 60 * 1000
const CLEANUP_INTERVAL_MS = 60 * 1000

let cleanupInterval: NodeJS.Timeout | null = null

function startCleanup() {
  if (cleanupInterval) return

  cleanupInterval = setInterval(() => {
    const now = new Date()
    for (const [backupId, data] of temporaryBackups.entries()) {
      if (now.getTime() - data.createdAt.getTime() > BACKUP_EXPIRY_MS) {
        temporaryBackups.delete(backupId)
        logger.debug('Cleaned up expired backup', { backupId })
      }
    }
  }, CLEANUP_INTERVAL_MS)
}

export const POST = createAuthenticatedHandler(async (req, { user }) => {
  startCleanup()

  try {
    const body = await req.json()
    const { destination, filename } = CreateBackupSchema.parse(body)

    logger.info('Creating backup', {
      context: 'POST /api/tools/backup/create',
      userId: user.id,
      destination,
    })

    // Create the backup
    const { zipBuffer, manifest } = await createBackup(user.id)

    logger.debug('Backup created', {
      context: 'POST /api/tools/backup/create',
      userId: user.id,
      zipSize: zipBuffer.length,
      entityCounts: manifest.counts,
    })

    if (destination === 's3') {
      // Save to S3
      const s3Key = await saveBackupToS3(user.id, zipBuffer, filename)

      logger.info('Backup saved to S3', {
        context: 'POST /api/tools/backup/create',
        userId: user.id,
        s3Key,
      })

      return NextResponse.json({
        success: true,
        s3Key,
      })
    } else {
      // Store temporarily for download
      const backupId = randomUUID()
      temporaryBackups.set(backupId, {
        buffer: zipBuffer,
        createdAt: new Date(),
      })

      logger.info('Backup stored for download', {
        context: 'POST /api/tools/backup/create',
        userId: user.id,
        backupId,
        expiresInMinutes: BACKUP_EXPIRY_MS / 60 / 1000,
      })

      return NextResponse.json({
        success: true,
        backupId,
      })
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      logger.warn('Backup create validation error', {
        context: 'POST /api/tools/backup/create',
        errors: error.errors,
      })
      return NextResponse.json(
        { error: 'Validation error', details: error.errors },
        { status: 400 }
      )
    }

    logger.error(
      'Backup create failed',
      { context: 'POST /api/tools/backup/create' },
      error instanceof Error ? error : undefined
    )
    return NextResponse.json(
      { error: 'Failed to create backup' },
      { status: 500 }
    )
  }
})

// Export for testing purposes
export { temporaryBackups }
