/**
 * Logout API Route
 *
 * POST /api/auth/logout
 *
 * Clears the session cookie and logs the user out.
 */

import { NextResponse } from 'next/server';
import { clearSessionCookie, getCurrentUserId } from '@/lib/auth/session';
import { logger } from '@/lib/logger';

interface LogoutResponse {
  success: boolean;
}

export async function POST(): Promise<NextResponse<LogoutResponse>> {
  try {
    // Get current user ID for logging (optional, don't fail if not available)
    let userId: string | null = null;
    try {
      userId = await getCurrentUserId();
    } catch {
      // Ignore errors getting user ID
    }

    logger.info('User logging out', {
      context: 'logout.POST',
      userId: userId || 'unknown',
    });

    // Create response and clear session cookie
    const response = NextResponse.json({ success: true });
    clearSessionCookie(response);

    return response;
  } catch (error) {
    logger.error(
      'Logout error',
      { context: 'logout.POST' },
      error instanceof Error ? error : undefined
    );

    // Even on error, try to clear the cookie
    const response = NextResponse.json({ success: true });
    clearSessionCookie(response);

    return response;
  }
}
