/**
 * Backup List Endpoint
 * GET /api/tools/backup/list - List all backups stored in S3 for the current user
 *
 * Response:
 * {
 *   success: true,
 *   backups: Array<{
 *     key: string
 *     filename: string
 *     createdAt: string (ISO 8601)
 *     size: number
 *   }>
 * }
 */

import { NextResponse } from 'next/server'
import { createAuthenticatedHandler } from '@/lib/api/middleware'
import { listS3Backups } from '@/lib/backup/backup-service'
import { logger } from '@/lib/logger'

export const GET = createAuthenticatedHandler(async (req, { user }) => {
  try {
    logger.debug('Listing S3 backups', {
      context: 'GET /api/tools/backup/list',
      userId: user.id,
    })

    // List all backups for this user
    const backups = await listS3Backups(user.id)

    logger.info('Backups listed', {
      context: 'GET /api/tools/backup/list',
      userId: user.id,
      count: backups.length,
    })

    // Convert Date objects to ISO strings for JSON serialization
    const backupsJson = backups.map((backup) => ({
      key: backup.key,
      filename: backup.filename,
      createdAt: backup.createdAt.toISOString(),
      size: backup.size,
    }))

    return NextResponse.json({
      success: true,
      backups: backupsJson,
    })
  } catch (error) {
    logger.error(
      'Failed to list backups',
      { context: 'GET /api/tools/backup/list' },
      error instanceof Error ? error : undefined
    )
    return NextResponse.json(
      { error: 'Failed to list backups' },
      { status: 500 }
    )
  }
})
