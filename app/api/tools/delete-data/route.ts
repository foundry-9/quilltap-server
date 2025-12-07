/**
 * Delete All Data Endpoint
 *
 * GET /api/tools/delete-data - Preview what will be deleted
 * POST /api/tools/delete-data - Delete all user data
 *
 * Response:
 * {
 *   success: true,
 *   summary: DeleteSummary
 * }
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from '@/lib/auth/session'
import { deleteAllUserData, previewDeleteAllUserData } from '@/lib/backup/restore-service'
import { logger } from '@/lib/logger'

/**
 * GET - Preview what data will be deleted
 */
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession()

    if (!session?.user?.id) {
      logger.warn('Preview delete attempted without authentication', {
        context: 'GET /api/tools/delete-data',
      })
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    logger.debug('Preview delete request received', {
      context: 'GET /api/tools/delete-data',
      userId: session.user.id,
    })

    const summary = await previewDeleteAllUserData(session.user.id)

    logger.info('Delete preview generated', {
      context: 'GET /api/tools/delete-data',
      userId: session.user.id,
      summary,
    })

    return NextResponse.json({
      success: true,
      summary,
    })
  } catch (error) {
    logger.error(
      'Preview delete failed',
      {
        context: 'GET /api/tools/delete-data',
        userId: (await getServerSession())?.user?.id,
        errorMessage: error instanceof Error ? error.message : String(error),
      },
      error instanceof Error ? error : undefined
    )
    return NextResponse.json(
      { error: 'Failed to preview data deletion' },
      { status: 500 }
    )
  }
}

/**
 * POST - Delete all user data
 */
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession()

    if (!session?.user?.id) {
      logger.warn('Delete all data attempted without authentication', {
        context: 'POST /api/tools/delete-data',
      })
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Require confirmation in request body
    const body = await req.json()
    if (body.confirm !== 'DELETE_ALL_MY_DATA') {
      logger.warn('Delete all data attempted without confirmation', {
        context: 'POST /api/tools/delete-data',
        userId: session.user.id,
      })
      return NextResponse.json(
        { error: 'Confirmation required. Send { "confirm": "DELETE_ALL_MY_DATA" }' },
        { status: 400 }
      )
    }

    logger.info('Starting complete data deletion', {
      context: 'POST /api/tools/delete-data',
      userId: session.user.id,
    })

    const summary = await deleteAllUserData(session.user.id)

    logger.info('Complete data deletion finished', {
      context: 'POST /api/tools/delete-data',
      userId: session.user.id,
      summary,
    })

    return NextResponse.json({
      success: true,
      summary,
    })
  } catch (error) {
    logger.error(
      'Delete all data failed',
      {
        context: 'POST /api/tools/delete-data',
        userId: (await getServerSession())?.user?.id,
        errorMessage: error instanceof Error ? error.message : String(error),
      },
      error instanceof Error ? error : undefined
    )
    return NextResponse.json(
      { error: 'Failed to delete data' },
      { status: 500 }
    )
  }
}
