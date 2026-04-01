/**
 * Backup Preview Endpoint
 * POST /api/tools/backup/preview - Preview what a backup contains before restoring
 *
 * Supports:
 * - multipart/form-data with file (ZIP file from user's computer)
 * - multipart/form-data with s3Key (S3 object key of the backup)
 *
 * Response:
 * {
 *   success: true,
 *   preview: RestorePreview
 * }
 */

import { NextResponse } from 'next/server'
import { createAuthenticatedHandler } from '@/lib/api/middleware'
import { previewRestore } from '@/lib/backup/restore-service'
import { downloadBackupFromS3 } from '@/lib/backup/backup-service'
import { logger } from '@/lib/logger'

// Route Segment Config for large file uploads
export const maxDuration = 300 // 5 minutes
export const dynamic = 'force-dynamic'

export const POST = createAuthenticatedHandler(async (req, { user }) => {
  try {
    logger.debug('Preview backup request received', {
      context: 'POST /api/tools/backup/preview',
      userId: user.id,
    })

    const formData = await req.formData()
    const file = formData.get('file') as File | null
    const s3Key = formData.get('s3Key') as string | null

    let zipBuffer: Buffer | null = null

    if (file) {
      logger.debug('Preview from uploaded file', {
        context: 'POST /api/tools/backup/preview',
        userId: user.id,
        fileName: file.name,
        fileSize: file.size,
      })
      zipBuffer = Buffer.from(await file.arrayBuffer())
    } else if (s3Key) {
      logger.debug('Preview from S3 backup', {
        context: 'POST /api/tools/backup/preview',
        userId: user.id,
        s3Key,
      })
      zipBuffer = await downloadBackupFromS3(s3Key)
    }

    if (!zipBuffer) {
      logger.warn('No backup source provided', {
        context: 'POST /api/tools/backup/preview',
        userId: user.id,
      })
      return NextResponse.json(
        { error: 'No file or s3Key provided' },
        { status: 400 }
      )
    }

    logger.debug('Generating preview', {
      context: 'POST /api/tools/backup/preview',
      userId: user.id,
      bufferSize: zipBuffer.length,
    })

    const preview = previewRestore(zipBuffer)

    logger.info('Preview generated successfully', {
      context: 'POST /api/tools/backup/preview',
      userId: user.id,
      preview,
    })

    return NextResponse.json({
      success: true,
      preview,
    })
  } catch (error) {
    logger.error(
      'Preview backup failed',
      {
        context: 'POST /api/tools/backup/preview',
        errorMessage: error instanceof Error ? error.message : String(error),
      },
      error instanceof Error ? error : undefined
    )
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to preview backup' },
      { status: 500 }
    )
  }
})
