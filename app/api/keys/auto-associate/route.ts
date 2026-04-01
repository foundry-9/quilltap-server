/**
 * API Key Auto-Association Route
 *
 * POST /api/keys/auto-associate - Trigger auto-association of API keys with profiles
 *
 * This endpoint is called when navigating to settings tabs to ensure
 * any profiles without valid API keys get associated with matching keys.
 */

import { NextResponse } from 'next/server'
import { createAuthenticatedHandler } from '@/lib/api/middleware'
import { autoAssociateAllKeys } from '@/lib/api-keys/auto-associate'
import { logger } from '@/lib/logger'

/**
 * POST /api/keys/auto-associate
 * Trigger auto-association of API keys with profiles that need them
 */
export const POST = createAuthenticatedHandler(async (req, { user }) => {
  try {
    logger.debug('Auto-association triggered via API', {
      context: 'keys-auto-associate-POST',
      userId: user.id,
    })

    const result = await autoAssociateAllKeys(user.id)

    logger.info('Auto-association completed via API', {
      context: 'keys-auto-associate-POST',
      userId: user.id,
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
})
