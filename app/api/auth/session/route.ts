/**
 * Session API Route
 *
 * GET /api/auth/session
 *
 * Returns the current session for authenticated users.
 * Used by the frontend SessionProvider to get session state.
 */

import { NextResponse } from 'next/server';
import { getServerSession, type ExtendedSession } from '@/lib/auth/session';
import { logger } from '@/lib/logger';

interface SessionResponse {
  user: ExtendedSession['user'] | null;
  expires: string | null;
}

export async function GET(): Promise<NextResponse<SessionResponse>> {
  try {
    const session = await getServerSession();

    if (!session) {
      return NextResponse.json({
        user: null,
        expires: null,
      });
    }

    logger.debug('Session fetched', {
      context: 'session.GET',
      userId: session.user.id,
    });

    return NextResponse.json({
      user: session.user,
      expires: session.expires,
    });
  } catch (error) {
    logger.error(
      'Session fetch error',
      { context: 'session.GET' },
      error instanceof Error ? error : undefined
    );

    return NextResponse.json({
      user: null,
      expires: null,
    });
  }
}
