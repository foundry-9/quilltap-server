/**
 * Auth API v1 - Session Endpoint
 *
 * GET /api/v1/auth/session - Get current session info
 *
 * Returns the current session for authenticated users.
 * Used by the frontend SessionProvider to get session state.
 */

import { NextRequest } from 'next/server';
import { getServerSession, type ExtendedSession } from '@/lib/auth/session';
import { logger } from '@/lib/logger';
import { successResponse } from '@/lib/api/responses';

interface SessionResponse {
  user: ExtendedSession['user'] | null;
  expires: string | null;
}

// ============================================================================
// GET Handler
// ============================================================================

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession();

    if (!session) {
      return successResponse<SessionResponse>({
        user: null,
        expires: null,
      });
    }


    return successResponse<SessionResponse>({
      user: session.user,
      expires: session.expires,
    });
  } catch (error) {
    logger.error(
      '[Auth v1] Error checking session',
      {},
      error instanceof Error ? error : undefined
    );

    // Even on error, return no session (not an error response)
    return successResponse<SessionResponse>({
      user: null,
      expires: null,
    });
  }
}
