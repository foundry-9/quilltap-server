/**
 * Session Cookie Management
 *
 * Handles setting, getting, and clearing session cookies.
 * Uses httpOnly secure cookies for session tokens.
 */

import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { getSessionConfig } from './jwt';

// Cookie configuration
const SESSION_COOKIE_NAME = 'qt_session';

/**
 * Get cookie options for session cookie
 */
function getCookieOptions(expiresAt?: Date) {
  const isProduction = process.env.NODE_ENV === 'production';
  const config = getSessionConfig();

  return {
    name: SESSION_COOKIE_NAME,
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax' as const,
    path: '/',
    expires: expiresAt || new Date(Date.now() + config.expiryHours * 60 * 60 * 1000),
  };
}

/**
 * Set session cookie on a NextResponse
 *
 * @param response - NextResponse to set cookie on
 * @param token - JWT session token
 * @returns The response with cookie set
 */
export function setSessionCookie(
  response: NextResponse,
  token: string
): NextResponse {
  const options = getCookieOptions();

  response.cookies.set(SESSION_COOKIE_NAME, token, options);
  return response;
}

/**
 * Set session cookie using the cookies() API (for server actions/route handlers)
 *
 * @param token - JWT session token
 */
export async function setSessionCookieFromAction(token: string): Promise<void> {
  const cookieStore = await cookies();
  const options = getCookieOptions();

  cookieStore.set(SESSION_COOKIE_NAME, token, options);
}

/**
 * Get session cookie from NextRequest
 *
 * @param request - NextRequest to get cookie from
 * @returns Session token or null
 */
export function getSessionCookieFromRequest(request: NextRequest): string | null {
  const cookie = request.cookies.get(SESSION_COOKIE_NAME);
  return cookie?.value || null;
}

/**
 * Get session cookie using the cookies() API (for server components/route handlers)
 *
 * @returns Session token or null
 */
export async function getSessionCookie(): Promise<string | null> {
  const cookieStore = await cookies();
  const cookie = cookieStore.get(SESSION_COOKIE_NAME);
  return cookie?.value || null;
}

/**
 * Clear session cookie on a NextResponse
 *
 * @param response - NextResponse to clear cookie on
 * @returns The response with cookie cleared
 */
export function clearSessionCookie(response: NextResponse): NextResponse {
  response.cookies.set(SESSION_COOKIE_NAME, '', {
    ...getCookieOptions(new Date(0)),
    expires: new Date(0),
    maxAge: 0,
  });
  return response;
}

/**
 * Clear session cookie using the cookies() API (for server actions/route handlers)
 */
export async function clearSessionCookieFromAction(): Promise<void> {
  const cookieStore = await cookies();

  cookieStore.set(SESSION_COOKIE_NAME, '', {
    ...getCookieOptions(new Date(0)),
    expires: new Date(0),
    maxAge: 0,
  });
}

/**
 * Get the session cookie name (for external use if needed)
 */
export function getSessionCookieName(): string {
  return SESSION_COOKIE_NAME;
}
