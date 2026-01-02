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

import { NextResponse } from 'next/server'
import { createAuthenticatedHandler } from '@/lib/api/middleware'
import { deleteAllUserData, previewDeleteAllUserData } from '@/lib/backup/restore-service'
import { logger } from '@/lib/logger'

/**
 * GET - Preview what data will be deleted
 */
export const GET = createAuthenticatedHandler(async (req, { user }) => {
  try {
    logger.debug('Preview delete request received', {
      context: 'GET /api/tools/delete-data',
      userId: user.id,
    })

    const summary = await previewDeleteAllUserData(user.id)

    logger.info('Delete preview generated', {
      context: 'GET /api/tools/delete-data',
      userId: user.id,
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
        errorMessage: error instanceof Error ? error.message : String(error),
      },
      error instanceof Error ? error : undefined
    )
    return NextResponse.json(
      { error: 'Failed to preview data deletion' },
      { status: 500 }
    )
  }
})

/**
 * POST - Delete all user data
 */
export const POST = createAuthenticatedHandler(async (req, { user }) => {
  try {
    // Require confirmation in request body
    const body = await req.json()
    if (body.confirm !== 'DELETE_ALL_MY_DATA') {
      logger.warn('Delete all data attempted without confirmation', {
        context: 'POST /api/tools/delete-data',
        userId: user.id,
      })
      return NextResponse.json(
        { error: 'Confirmation required. Send { "confirm": "DELETE_ALL_MY_DATA" }' },
        { status: 400 }
      )
    }

    logger.info('Starting complete data deletion', {
      context: 'POST /api/tools/delete-data',
      userId: user.id,
    })

    const summary = await deleteAllUserData(user.id)

    logger.info('Complete data deletion finished', {
      context: 'POST /api/tools/delete-data',
      userId: user.id,
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
        errorMessage: error instanceof Error ? error.message : String(error),
      },
      error instanceof Error ? error : undefined
    )
    return NextResponse.json(
      { error: 'Failed to delete data' },
      { status: 500 }
    )
  }
})
