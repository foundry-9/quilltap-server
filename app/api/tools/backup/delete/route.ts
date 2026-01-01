/**
 * Backup Delete Endpoint
 * DELETE /api/tools/backup/delete - Delete a backup from S3
 *
 * Request body:
 * {
 *   s3Key: string
 * }
 *
 * Response:
 * {
 *   success: true
 * }
 */

import { NextResponse } from 'next/server'
import { createAuthenticatedHandler } from '@/lib/api/middleware'
import { deleteBackupFromS3 } from '@/lib/backup/backup-service'
import { logger } from '@/lib/logger'

export const DELETE = createAuthenticatedHandler(async (req, { user }) => {
  try {
    const body = await req.json()
    const { s3Key } = body

    if (!s3Key || typeof s3Key !== 'string') {
      return NextResponse.json({ error: 'Missing s3Key parameter' }, { status: 400 })
    }

    // Security check: ensure the backup key belongs to this user
    const expectedPrefix = `users/${user.id}/backups/`
    if (!s3Key.startsWith(expectedPrefix)) {
      logger.warn('Attempted to delete backup from another user', {
        context: 'DELETE /api/tools/backup/delete',
        userId: user.id,
        s3Key,
      })
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    logger.debug('Deleting backup from S3', {
      context: 'DELETE /api/tools/backup/delete',
      userId: user.id,
      s3Key,
    })

    await deleteBackupFromS3(s3Key)

    logger.info('Backup deleted', {
      context: 'DELETE /api/tools/backup/delete',
      userId: user.id,
      s3Key,
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    logger.error(
      'Failed to delete backup',
      { context: 'DELETE /api/tools/backup/delete' },
      error instanceof Error ? error : undefined
    )
    return NextResponse.json(
      { error: 'Failed to delete backup' },
      { status: 500 }
    )
  }
})
