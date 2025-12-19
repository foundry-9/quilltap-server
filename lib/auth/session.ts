/**
 * Session utilities for authentication
 *
 * Provides a unified session access that handles both authenticated
 * and no-auth modes transparently.
 *
 * Uses custom JWT session management (no NextAuth dependency).
 */

import { isAuthDisabled } from '@/lib/auth/config';
import { getOrCreateUnauthenticatedUser } from '@/lib/auth/unauthenticated-user';
import { logger } from '@/lib/logger';
import {
  verifySessionToken,
  shouldRefreshToken,
  refreshSessionToken,
  type DecodedSession,
} from './session/jwt';
import { getSessionCookie, setSessionCookieFromAction } from './session/cookies';

/**
 * Session user type
 */
export interface SessionUser {
  id: string;
  email: string;
  name?: string | null;
  image?: string | null;
}

/**
 * Extended session type that includes user ID
 */
export interface ExtendedSession {
  user: SessionUser;
  expires: string;
}

/**
 * Get the current session, handling no-auth mode
 *
 * When AUTH_DISABLED=true, returns an unauthenticated user session.
 * Otherwise, verifies the JWT session cookie.
 *
 * @returns The current session or null if not authenticated
 */
export async function getServerSession(): Promise<ExtendedSession | null> {
  // If auth is disabled, return unauthenticated user session
  if (isAuthDisabled()) {
    logger.debug('Auth disabled - returning unauthenticated user session', {
      context: 'getServerSession',
    });

    try {
      const unauthenticatedUser = await getOrCreateUnauthenticatedUser();

      return {
        user: {
          id: unauthenticatedUser.id,
          email: unauthenticatedUser.email || unauthenticatedUser.username,
          name: unauthenticatedUser.name,
          image: unauthenticatedUser.image,
        },
        expires: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(), // 30 days
      };
    } catch (error) {
      logger.error(
        'Failed to get unauthenticated user session',
        { context: 'getServerSession' },
        error instanceof Error ? error : new Error(String(error))
      );
      return null;
    }
  }

  // Normal auth flow - verify JWT from session cookie
  try {
    const token = await getSessionCookie();

    if (!token) {
      logger.debug('No session cookie found', { context: 'getServerSession' });
      return null;
    }

    const decoded = await verifySessionToken(token);

    if (!decoded) {
      logger.debug('Session token invalid or expired', { context: 'getServerSession' });
      return null;
    }

    // Check if token needs refreshing
    if (shouldRefreshToken(decoded)) {
      logger.debug('Refreshing session token', {
        context: 'getServerSession',
        userId: decoded.userId,
      });

      try {
        const newToken = await refreshSessionToken(decoded);
        await setSessionCookieFromAction(newToken);
      } catch (refreshError) {
        // Log but don't fail the request if refresh fails
        logger.warn('Failed to refresh session token', {
          context: 'getServerSession',
          error: refreshError instanceof Error ? refreshError.message : String(refreshError),
        });
      }
    }

    return {
      user: {
        id: decoded.userId,
        email: decoded.email,
        name: decoded.name,
        image: decoded.image,
      },
      expires: new Date(decoded.exp * 1000).toISOString(),
    };
  } catch (error) {
    // During Next.js static generation, cookies() throws a dynamic server usage error.
    // This is expected behavior - just return null without logging an error.
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (errorMessage.includes('Dynamic server usage') || errorMessage.includes("couldn't be rendered statically")) {
      return null;
    }

    logger.error(
      'Failed to verify session',
      { context: 'getServerSession' },
      error instanceof Error ? error : new Error(String(error))
    );
    return null;
  }
}

/**
 * Get required session or throw
 *
 * Convenience wrapper that throws if no session is available.
 * Useful for API routes that require authentication.
 *
 * @throws Error if no session is available
 * @returns The current session
 */
export async function getRequiredSession(): Promise<ExtendedSession> {
  const session = await getServerSession();

  if (!session?.user?.id) {
    throw new Error('Unauthorized: No valid session');
  }

  return session;
}

/**
 * Get current user ID from session
 *
 * @returns The current user ID or null if not authenticated
 */
export async function getCurrentUserId(): Promise<string | null> {
  const session = await getServerSession();
  return session?.user?.id ?? null;
}

/**
 * Get required user ID from session
 *
 * @throws Error if no session is available
 * @returns The current user ID
 */
export async function getRequiredUserId(): Promise<string> {
  const session = await getRequiredSession();
  return session.user.id;
}

// Re-export types and utilities from session modules
export type { DecodedSession } from './session/jwt';
export {
  createSessionToken,
  verifySessionToken,
  shouldRefreshToken,
  refreshSessionToken,
} from './session/jwt';
export {
  setSessionCookie,
  setSessionCookieFromAction,
  getSessionCookie,
  getSessionCookieFromRequest,
  clearSessionCookie,
  clearSessionCookieFromAction,
} from './session/cookies';
