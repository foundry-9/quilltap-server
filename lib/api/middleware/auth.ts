/**
 * Request Context Middleware
 *
 * Provides request context (user, repositories, session) to API route handlers.
 * Ensures server readiness before processing requests.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession, type ExtendedSession } from '@/lib/auth/session';
import { getRepositoriesSafe, type RepositoryContainer } from '@/lib/repositories/factory';
import { startupState } from '@/lib/startup/startup-state';
import { logger } from '@/lib/logger';
import type { User } from '@/lib/schemas/types';

const contextLogger = logger.child({ module: 'api-context-middleware' });

/**
 * Wait for server startup to complete before processing requests.
 * This ensures plugins and providers are fully loaded.
 */
async function ensureServerReady(): Promise<void> {
  if (!startupState.isReady()) {
    const isReady = await startupState.waitForReady(30000);
    if (!isReady) {
      contextLogger.warn('Server startup not complete after 30s, proceeding anyway', {
        currentPhase: startupState.getPhase(),
      });
    }
  }

  if (!startupState.isPepperResolved()) {
    const pepperState = startupState.getPepperState();
    contextLogger.debug('Request blocked: pepper not resolved', { pepperState });
    throw new PepperNotReadyError(pepperState);
  }
}

/**
 * Error thrown when the pepper vault is not yet resolved
 */
class PepperNotReadyError extends Error {
  public pepperState: string;
  constructor(pepperState: string) {
    super('Setup required');
    this.name = 'PepperNotReadyError';
    this.pepperState = pepperState;
  }
}

/**
 * Context provided to route handlers
 */
export interface RequestContext {
  /** The user entity from the database */
  user: User;
  /** Repository container for data access */
  repos: RepositoryContainer;
  /** The session object with user info */
  session: ExtendedSession;
}

/**
 * Type for route handlers with context
 */
export type ContextHandler<T = NextResponse> = (
  request: NextRequest,
  context: RequestContext
) => Promise<T>;

/**
 * Type for route handlers with context and route params
 */
export type ContextParamsHandler<P = Record<string, string>, T = NextResponse> = (
  request: NextRequest,
  context: RequestContext,
  params: P
) => Promise<T>;

/**
 * Wrap an API route handler with context
 */
export async function withContext<T>(
  handler: ContextHandler<T>
): Promise<T | NextResponse> {
  try {
    await ensureServerReady();
  } catch (error) {
    if (error instanceof PepperNotReadyError) {
      return NextResponse.json(
        { error: 'Setup required', setupUrl: '/setup', pepperState: error.pepperState },
        { status: 503 }
      );
    }
    throw error;
  }

  const session = await getServerSession();

  if (!session?.user?.id) {
    contextLogger.error('Failed to get user session');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }

  const repos = await getRepositoriesSafe();
  const user = await repos.users.findById(session.user.id);

  if (!user) {
    contextLogger.warn('User not found', { userId: session.user.id });
    return NextResponse.json({ error: 'User not found' }, { status: 500 });
  }

  return handler({} as NextRequest, { user, repos, session });
}

/**
 * Wrap an API route handler with context and params
 */
export async function withContextParams<P extends Record<string, string>, T>(
  request: NextRequest,
  params: P,
  handler: ContextParamsHandler<P, T>
): Promise<T | NextResponse> {
  try {
    await ensureServerReady();
  } catch (error) {
    if (error instanceof PepperNotReadyError) {
      return NextResponse.json(
        { error: 'Setup required', setupUrl: '/setup', pepperState: error.pepperState },
        { status: 503 }
      );
    }
    throw error;
  }

  const session = await getServerSession();

  if (!session?.user?.id) {
    contextLogger.error('Failed to get user session');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }

  const repos = await getRepositoriesSafe();
  const user = await repos.users.findById(session.user.id);

  if (!user) {
    contextLogger.warn('User not found', { userId: session.user.id });
    return NextResponse.json({ error: 'User not found' }, { status: 500 });
  }

  return handler(request, { user, repos, session }, params);
}

/**
 * Higher-order function to create a route handler with context
 *
 * Creates a complete route handler that can be directly exported.
 */
export function createContextHandler(
  handler: (
    request: NextRequest,
    context: RequestContext
  ) => Promise<NextResponse>
): (request: NextRequest) => Promise<NextResponse> {
  return async (request: NextRequest) => {
    try {
      await ensureServerReady();
    } catch (error) {
      if (error instanceof PepperNotReadyError) {
        return NextResponse.json(
          { error: 'Setup required', setupUrl: '/setup', pepperState: error.pepperState },
          { status: 503 }
        );
      }
      throw error;
    }

    const session = await getServerSession();

    if (!session?.user?.id) {
      contextLogger.error('Failed to get user session');
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }

    const repos = await getRepositoriesSafe();
    const user = await repos.users.findById(session.user.id);

    if (!user) {
      contextLogger.warn('User not found', { userId: session.user.id });
      return NextResponse.json({ error: 'User not found' }, { status: 500 });
    }

    return handler(request, { user, repos, session });
  };
}

/**
 * Higher-order function to create a route handler with context and params
 *
 * Creates a complete route handler that can be directly exported for routes
 * with dynamic parameters like [id].
 */
export function createContextParamsHandler<P extends Record<string, string>>(
  handler: (
    request: NextRequest,
    context: RequestContext,
    params: P
  ) => Promise<NextResponse>
): (
  request: NextRequest,
  context: { params: Promise<P> }
) => Promise<NextResponse> {
  return async (request: NextRequest, context: { params: Promise<P> }) => {
    try {
      await ensureServerReady();
    } catch (error) {
      if (error instanceof PepperNotReadyError) {
        return NextResponse.json(
          { error: 'Setup required', setupUrl: '/setup', pepperState: error.pepperState },
          { status: 503 }
        );
      }
      throw error;
    }

    const params = await context.params;
    const session = await getServerSession();

    if (!session?.user?.id) {
      contextLogger.error('Failed to get user session');
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }

    const repos = await getRepositoriesSafe();
    const user = await repos.users.findById(session.user.id);

    if (!user) {
      contextLogger.warn('User not found', { userId: session.user.id });
      return NextResponse.json({ error: 'User not found' }, { status: 500 });
    }

    return handler(request, { user, repos, session }, params);
  };
}

/**
 * Check if a resource exists (type guard)
 */
export function exists<T>(resource: T | null | undefined): resource is T {
  return resource != null;
}

// Legacy aliases for backward compatibility during migration
export const AuthenticatedContext = {} as RequestContext;
export type AuthenticatedContext = RequestContext;
export type AuthenticatedHandler<T = NextResponse> = ContextHandler<T>;
export type AuthenticatedParamsHandler<P = Record<string, string>, T = NextResponse> = ContextParamsHandler<P, T>;
export const withAuth = withContext;
export const withAuthParams = withContextParams;
export const createAuthenticatedHandler = createContextHandler;
export const createAuthenticatedParamsHandler = createContextParamsHandler;
export const checkOwnership = <T extends { userId?: string }>(
  resource: T | null | undefined,
  _userId: string
): resource is T => exists(resource);
