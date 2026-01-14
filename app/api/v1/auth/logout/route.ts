/**
 * Auth API v1 - Logout Endpoint
 *
 * POST /api/v1/auth/logout - Clear session and logout user
 */

import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { successResponse } from '@/lib/api/responses';
import { getServerSession } from '@/lib/auth/session';

// ============================================================================
// POST Handler
// ============================================================================

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession();

    if (session) {
      logger.info('[Auth v1] Logout', { userId: session.user.id });
    } else {
      logger.debug('[Auth v1] Logout attempt without session');
    }

    const response = NextResponse.json(
      {
        success: true,
        message: 'Logged out successfully',
      },
      { status: 200 }
    );

    // Clear session cookie by setting an expired one
    response.cookies.delete('session');

    return response;
  } catch (error) {
    logger.error(
      '[Auth v1] Logout error',
      {},
      error instanceof Error ? error : undefined
    );

    const response = NextResponse.json(
      {
        success: true,
        message: 'Logged out',
      },
      { status: 200 }
    );

    // Clear session cookie even on error
    response.cookies.delete('session');

    return response;
  }
}
