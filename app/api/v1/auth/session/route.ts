/**
 * Auth API v1 - Session Endpoint
 *
 * GET /api/v1/auth/session - Get current session info
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/lib/auth/session';
import { logger } from '@/lib/logger';
import { successResponse, unauthorized } from '@/lib/api/responses';

// ============================================================================
// GET Handler
// ============================================================================

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession();

    if (!session) {
      logger.debug('[Auth v1] Session check - no active session');
      return unauthorized('No active session');
    }

    logger.debug('[Auth v1] Session retrieved', { userId: session.user.id });

    return successResponse({
      session: {
        user: session.user,
        expires: session.expires,
      },
    });
  } catch (error) {
    logger.error(
      '[Auth v1] Error checking session',
      {},
      error instanceof Error ? error : undefined
    );

    // Even on error, return no session (not an error response)
    return unauthorized('Invalid session');
  }
}
