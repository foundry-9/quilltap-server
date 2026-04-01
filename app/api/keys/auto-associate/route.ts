/**
 * API Key Auto-Association Route
 *
 * POST /api/keys/auto-associate - Trigger auto-association of API keys with profiles
 *
 * This endpoint is called when navigating to settings tabs to ensure
 * any profiles without valid API keys get associated with matching keys.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from '@/lib/auth/session'
import { autoAssociateAllKeys } from '@/lib/api-keys/auto-associate'
import { logger } from '@/lib/logger'

/**
 * POST /api/keys/auto-associate
 * Trigger auto-association of API keys with profiles that need them
 */
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession()
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    logger.debug('Auto-association triggered via API', {
      context: 'keys-auto-associate-POST',
      userId: session.user.id,
    })

    const result = await autoAssociateAllKeys(session.user.id)

    logger.info('Auto-association completed via API', {
      context: 'keys-auto-associate-POST',
      userId: session.user.id,
      associations: result.associations.length,
      errors: result.errors.length,
    })

    return NextResponse.json({
      success: true,
      associations: result.associations,
      errors: result.errors,
    })
  } catch (error) {
    logger.error('Failed to run auto-association', {
      context: 'keys-auto-associate-POST',
    }, error instanceof Error ? error : undefined)
    return NextResponse.json(
      { error: 'Failed to run auto-association' },
      { status: 500 }
    )
  }
}
