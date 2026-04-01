/**
 * Session API Route (Single-User Mode)
 *
 * GET /api/v1/session - Returns the current user session
 *
 * In single-user mode, this always returns the single user's session.
 */

import { NextResponse } from 'next/server';
import { getServerSession } from '@/lib/auth/session';
import { logger } from '@/lib/logger';

/**
 * GET /api/v1/session
 *
 * Returns the current user session.
 * In single-user mode, always returns the single user's session.
 */
export async function GET() {
  try {
    const session = await getServerSession();

    if (!session) {
      logger.error('Failed to get session', {
        context: 'api.v1.session',
      });
      return NextResponse.json(
        { error: 'Failed to get session' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      user: session.user,
      expires: session.expires,
    });
  } catch (error) {
    logger.error(
      'Error getting session',
      { context: 'api.v1.session' },
      error instanceof Error ? error : new Error(String(error))
    );
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
