/**
 * Backup Delete Endpoint
 * DELETE /api/tools/backup/delete - Delete a backup from storage
 *
 * Request body:
 * {
 *   s3Key: string (storage key)
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
import { badRequest, forbidden, serverError } from '@/lib/api/responses'

export const DELETE = createAuthenticatedHandler(async (req, { user }) => {
  try {
    const body = await req.json()
    const { s3Key } = body

    if (!s3Key || typeof s3Key !== 'string') {
      return badRequest('Missing s3Key parameter')
    }

    // Security check: ensure the backup key belongs to this user
    const expectedPrefix = `users/${user.id}/backups/`
    if (!s3Key.startsWith(expectedPrefix)) {
      logger.warn('Attempted to delete backup from another user', {
        context: 'DELETE /api/tools/backup/delete',
        userId: user.id,
        s3Key,
      })
      return forbidden()
    }

    logger.debug('Deleting backup from storage', {
      context: 'DELETE /api/tools/backup/delete',
      userId: user.id,
      storageKey: s3Key,
    })

    await deleteBackupFromS3(user.id, s3Key)

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
    return serverError('Failed to delete backup')
  }
})
