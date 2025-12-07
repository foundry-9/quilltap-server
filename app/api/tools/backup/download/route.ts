/**
 * Backup Download Endpoint
 * GET /api/tools/backup/download?backupId=... - Download a previously created backup
 *
 * Query parameters:
 * - backupId: UUID of the backup to download
 *
 * Returns:
 * - Content-Type: application/zip
 * - Content-Disposition: attachment; filename="quilltap-backup-{timestamp}.zip"
 * - ZIP file buffer
 */

import { NextRequest, NextResponse } from 'next/server'
import { logger } from '@/lib/logger'
import { temporaryBackups } from '../create/route'

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const backupId = searchParams.get('backupId')

    if (!backupId) {
      logger.warn('Download backup without backupId', {
        context: 'GET /api/tools/backup/download',
      })
      return NextResponse.json(
        { error: 'backupId parameter is required' },
        { status: 400 }
      )
    }

    logger.debug('Attempting to download backup', {
      context: 'GET /api/tools/backup/download',
      backupId,
    })

    // Look up the backup
    const backupData = temporaryBackups.get(backupId)

    if (!backupData) {
      logger.warn('Backup not found or expired', {
        context: 'GET /api/tools/backup/download',
        backupId,
      })
      return NextResponse.json(
        { error: 'Backup not found or has expired' },
        { status: 404 }
      )
    }

    // Remove from temporary storage after retrieval
    temporaryBackups.delete(backupId)

    logger.info('Backup downloaded', {
      context: 'GET /api/tools/backup/download',
      backupId,
      size: backupData.buffer.length,
    })

    // Create response with proper headers
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const filename = `quilltap-backup-${timestamp}.zip`

    // Convert Buffer to Uint8Array for NextResponse compatibility
    const uint8Array = new Uint8Array(backupData.buffer)

    return new NextResponse(uint8Array, {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': backupData.buffer.length.toString(),
      },
    })
  } catch (error) {
    logger.error(
      'Backup download failed',
      { context: 'GET /api/tools/backup/download' },
      error instanceof Error ? error : undefined
    )
    return NextResponse.json(
      { error: 'Failed to download backup' },
      { status: 500 }
    )
  }
}
