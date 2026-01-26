/**
 * Authentication Middleware (Single-User Mode)
 *
 * Provides a reusable wrapper for API routes in single-user mode.
 * Since Quilltap operates in single-user mode only, authentication
 * always succeeds with the single user.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession, type ExtendedSession } from '@/lib/auth/session';
import { getRepositoriesSafe, type RepositoryContainer } from '@/lib/repositories/factory';
import { startupState } from '@/lib/startup/startup-state';
import { logger } from '@/lib/logger';
import type { User } from '@/lib/schemas/types';

const authLogger = logger.child({ module: 'api-auth-middleware' });

/**
 * Wait for server startup to complete before processing requests.
 * This ensures plugins and providers are fully loaded.
 */
async function ensureServerReady(): Promise<void> {
  if (!startupState.isReady()) {
    const isReady = await startupState.waitForReady(30000);
    if (!isReady) {
      authLogger.warn('Server startup not complete after 30s, proceeding anyway', {
        currentPhase: startupState.getPhase(),
      });
    }
  }
}

/**
 * Context provided to authenticated route handlers
 */
export interface AuthenticatedContext {
  /** The authenticated user entity from the database */
  user: User;
  /** Repository container for data access */
  repos: RepositoryContainer;
  /** The session object with user info */
  session: ExtendedSession;
}

/**
 * Type for authenticated route handlers
 */
export type AuthenticatedHandler<T = NextResponse> = (
  request: NextRequest,
  context: AuthenticatedContext
) => Promise<T>;

/**
 * Type for authenticated route handlers with route params
 */
export type AuthenticatedParamsHandler<P = Record<string, string>, T = NextResponse> = (
  request: NextRequest,
  context: AuthenticatedContext,
  params: P
) => Promise<T>;

/**
 * Wrap an API route handler with authentication
 *
 * In single-user mode, this always succeeds with the single user.
 * Handles server readiness and user lookup.
 */
export async function withAuth<T>(
  handler: AuthenticatedHandler<T>
): Promise<T | NextResponse> {
  await ensureServerReady();

  const session = await getServerSession();

  if (!session?.user?.id) {
    authLogger.error('Failed to get single user session');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }

  const repos = await getRepositoriesSafe();
  const user = await repos.users.findById(session.user.id);

  if (!user) {
    authLogger.warn('Single user not found, this should not happen', { userId: session.user.id });
    return NextResponse.json({ error: 'User not found' }, { status: 500 });
  }

  return handler({} as NextRequest, { user, repos, session });
}

/**
 * Wrap an API route handler with authentication and params
 *
 * In single-user mode, this always succeeds with the single user.
 */
export async function withAuthParams<P extends Record<string, string>, T>(
  request: NextRequest,
  params: P,
  handler: AuthenticatedParamsHandler<P, T>
): Promise<T | NextResponse> {
  await ensureServerReady();

  const session = await getServerSession();

  if (!session?.user?.id) {
    authLogger.error('Failed to get single user session');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }

  const repos = await getRepositoriesSafe();
  const user = await repos.users.findById(session.user.id);

  if (!user) {
    authLogger.warn('Single user not found, this should not happen', { userId: session.user.id });
    return NextResponse.json({ error: 'User not found' }, { status: 500 });
  }

  return handler(request, { user, repos, session }, params);
}

/**
 * Higher-order function to create an authenticated route handler
 *
 * Creates a complete route handler that can be directly exported.
 * In single-user mode, always returns the single user context.
 */
export function createAuthenticatedHandler(
  handler: (
    request: NextRequest,
    context: AuthenticatedContext
  ) => Promise<NextResponse>
): (request: NextRequest) => Promise<NextResponse> {
  return async (request: NextRequest) => {
    await ensureServerReady();

    const session = await getServerSession();

    if (!session?.user?.id) {
      authLogger.error('Failed to get single user session');
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }

    const repos = await getRepositoriesSafe();
    const user = await repos.users.findById(session.user.id);

    if (!user) {
      authLogger.warn('Single user not found, this should not happen', { userId: session.user.id });
      return NextResponse.json({ error: 'User not found' }, { status: 500 });
    }

    return handler(request, { user, repos, session });
  };
}

/**
 * Higher-order function to create an authenticated route handler with params
 *
 * Creates a complete route handler that can be directly exported for routes
 * with dynamic parameters like [id].
 */
export function createAuthenticatedParamsHandler<P extends Record<string, string>>(
  handler: (
    request: NextRequest,
    context: AuthenticatedContext,
    params: P
  ) => Promise<NextResponse>
): (
  request: NextRequest,
  context: { params: Promise<P> }
) => Promise<NextResponse> {
  return async (request: NextRequest, context: { params: Promise<P> }) => {
    await ensureServerReady();

    const params = await context.params;
    const session = await getServerSession();

    if (!session?.user?.id) {
      authLogger.error('Failed to get single user session');
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }

    const repos = await getRepositoriesSafe();
    const user = await repos.users.findById(session.user.id);

    if (!user) {
      authLogger.warn('Single user not found, this should not happen', { userId: session.user.id });
      return NextResponse.json({ error: 'User not found' }, { status: 500 });
    }

    return handler(request, { user, repos, session }, params);
  };
}

/**
 * Check ownership of a resource
 *
 * Common pattern for verifying a resource belongs to the current user.
 */
export function checkOwnership<T extends { userId?: string }>(
  resource: T | null | undefined,
  userId: string
): resource is T {
  return resource != null && resource.userId === userId;
}
