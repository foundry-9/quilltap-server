/**
 * Backup Restore Endpoint
 * POST /api/tools/backup/restore - Restore data from a backup
 *
 * Supports two modes:
 * 1. Upload mode: multipart/form-data with file and mode
 *    - file: ZIP file from user's computer
 *    - mode: 'replace' | 'new-account'
 *
 * 2. S3 mode: JSON body with s3Key and mode
 *    - s3Key: S3 object key of the backup
 *    - mode: 'replace' | 'new-account'
 *
 * Response:
 * {
 *   success: true,
 *   summary: RestoreSummary
 * }
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from '@/lib/auth/session'
import { restore, previewRestore } from '@/lib/backup/restore-service'
import { downloadBackupFromS3 } from '@/lib/backup/backup-service'
import { logger } from '@/lib/logger'
import { z } from 'zod'

const RestoreRequestSchema = z.object({
  s3Key: z.string().optional(),
  mode: z.enum(['replace', 'new-account']),
})

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession()

    if (!session?.user?.id) {
      logger.warn('Restore backup attempted without authentication', {
        context: 'POST /api/tools/backup/restore',
      })
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const contentType = req.headers.get('content-type')
    let zipBuffer: Buffer | null = null
    let mode: 'replace' | 'new-account' = 'replace'
    let isPreview = false

    logger.debug('Restore backup request received', {
      context: 'POST /api/tools/backup/restore',
      userId: session.user.id,
      contentType,
    })

    if (contentType?.includes('multipart/form-data')) {
      // Handle file upload
      const formData = await req.formData()
      const file = formData.get('file') as File
      const modeParam = formData.get('mode') as string
      const previewParam = formData.get('preview') as string

      if (!file) {
        logger.warn('Restore backup without file', {
          context: 'POST /api/tools/backup/restore',
          userId: session.user.id,
        })
        return NextResponse.json(
          { error: 'No file provided' },
          { status: 400 }
        )
      }

      if (!modeParam || !['replace', 'new-account'].includes(modeParam)) {
        logger.warn('Restore backup with invalid mode', {
          context: 'POST /api/tools/backup/restore',
          userId: session.user.id,
          mode: modeParam,
        })
        return NextResponse.json(
          { error: 'mode must be "replace" or "new-account"' },
          { status: 400 }
        )
      }

      mode = modeParam as 'replace' | 'new-account'
      isPreview = previewParam === 'true'

      zipBuffer = Buffer.from(await file.arrayBuffer())

      logger.debug('Backup file uploaded', {
        context: 'POST /api/tools/backup/restore',
        userId: session.user.id,
        fileSize: zipBuffer.length,
        mode,
        isPreview,
      })
    } else if (contentType?.includes('application/json')) {
      // Handle S3 download
      const body = await req.json()
      const { s3Key, mode: bodyMode } = RestoreRequestSchema.parse(body)

      if (!s3Key) {
        logger.warn('Restore backup from S3 without s3Key', {
          context: 'POST /api/tools/backup/restore',
          userId: session.user.id,
        })
        return NextResponse.json(
          { error: 's3Key is required for S3 restore' },
          { status: 400 }
        )
      }

      mode = bodyMode

      logger.debug('Downloading backup from S3', {
        context: 'POST /api/tools/backup/restore',
        userId: session.user.id,
        s3Key,
        mode,
      })

      // Download backup from S3
      zipBuffer = await downloadBackupFromS3(s3Key)

      logger.debug('Backup downloaded from S3', {
        context: 'POST /api/tools/backup/restore',
        userId: session.user.id,
        s3Key,
        fileSize: zipBuffer.length,
      })
    } else {
      logger.warn('Restore backup with unsupported content type', {
        context: 'POST /api/tools/backup/restore',
        userId: session.user.id,
        contentType,
      })
      return NextResponse.json(
        { error: 'Unsupported content type. Use multipart/form-data or application/json' },
        { status: 400 }
      )
    }

    if (!zipBuffer) {
      logger.error('No backup buffer available', {
        context: 'POST /api/tools/backup/restore',
        userId: session.user.id,
      })
      return NextResponse.json(
        { error: 'Failed to load backup data' },
        { status: 400 }
      )
    }

    // If preview mode, just show what will be restored
    if (isPreview) {
      logger.info('Preview restore requested', {
        context: 'POST /api/tools/backup/restore',
        userId: session.user.id,
        mode,
      })

      const summary = previewRestore(zipBuffer)
      return NextResponse.json({
        success: true,
        preview: true,
        summary,
      })
    }

    logger.info('Starting restore operation', {
      context: 'POST /api/tools/backup/restore',
      userId: session.user.id,
      mode,
    })

    // Perform the actual restore
    const summary = await restore(zipBuffer, {
      mode,
      targetUserId: session.user.id,
    })

    logger.info('Restore completed', {
      context: 'POST /api/tools/backup/restore',
      userId: session.user.id,
      mode,
      restoreCounts: {
        characters: summary.characters,
        personas: summary.personas,
        chats: summary.chats,
        messages: summary.messages,
        tags: summary.tags,
        files: summary.files,
        memories: summary.memories,
      },
      warnings: summary.warnings.length,
    })

    return NextResponse.json({
      success: true,
      summary,
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      logger.warn('Restore backup validation error', {
        context: 'POST /api/tools/backup/restore',
        userId: (await getServerSession())?.user?.id,
        errors: error.errors,
      })
      return NextResponse.json(
        { error: 'Validation error', details: error.errors },
        { status: 400 }
      )
    }

    logger.error(
      'Restore backup failed',
      {
        context: 'POST /api/tools/backup/restore',
        userId: (await getServerSession())?.user?.id,
      },
      error instanceof Error ? error : undefined
    )
    return NextResponse.json(
      { error: 'Failed to restore backup' },
      { status: 500 }
    )
  }
}
