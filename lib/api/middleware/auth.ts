/**
 * Request Context Middleware
 *
 * Provides request context (user, repositories, session) to API route handlers.
 * Ensures server readiness before processing requests.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getServerSession, type ExtendedSession } from '@/lib/auth/session';
import { getRepositoriesSafe, type RepositoryContainer } from '@/lib/repositories/factory';
import { startupState } from '@/lib/startup/startup-state';
import { logger } from '@/lib/logger';
import { validationError, serverError } from '@/lib/api/responses';
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
export type ContextParamsHandler<P = Record<string, string | string[]>, T = NextResponse> = (
  request: NextRequest,
  context: RequestContext,
  params: P
) => Promise<T>;

// ============================================================================
// Internal helpers
// ============================================================================

type ContextBuildResult = { context: RequestContext } | { response: NextResponse };

/**
 * Shared context-building logic: ensures server readiness, validates the
 * session, and resolves the user record. Returns either a ready context or an
 * early-exit response — callers check which they got before proceeding.
 */
async function buildRequestContext(): Promise<ContextBuildResult> {
  try {
    await ensureServerReady();
  } catch (error) {
    if (error instanceof PepperNotReadyError) {
      return {
        response: NextResponse.json(
          { error: 'Setup required', setupUrl: '/setup', pepperState: error.pepperState },
          { status: 503 }
        ),
      };
    }
    throw error;
  }

  const session = await getServerSession();

  if (!session?.user?.id) {
    contextLogger.error('Failed to get user session');
    return { response: NextResponse.json({ error: 'Internal server error' }, { status: 500 }) };
  }

  const repos = await getRepositoriesSafe();
  const user = await repos.users.findById(session.user.id);

  if (!user) {
    contextLogger.warn('User not found', { userId: session.user.id });
    return { response: NextResponse.json({ error: 'User not found' }, { status: 500 }) };
  }

  return { context: { user, repos, session } };
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Wrap an API route handler with context
 */
export async function withContext<T>(
  handler: ContextHandler<T>
): Promise<T | NextResponse> {
  const result = await buildRequestContext();
  if ('response' in result) return result.response;
  return handler({} as NextRequest, result.context);
}

/**
 * Wrap an API route handler with context and params
 */
export async function withContextParams<P extends Record<string, string | string[]>, T>(
  request: NextRequest,
  params: P,
  handler: ContextParamsHandler<P, T>
): Promise<T | NextResponse> {
  const result = await buildRequestContext();
  if ('response' in result) return result.response;
  return handler(request, result.context, params);
}

/**
 * Catch handler errors and return appropriate responses.
 * ZodErrors become 400 validation errors; everything else becomes 500.
 */
async function handleRouteError(
  request: NextRequest,
  handlerFn: () => Promise<NextResponse>
): Promise<NextResponse> {
  try {
    return await handlerFn();
  } catch (error) {
    if (error instanceof z.ZodError) {
      return validationError(error);
    }
    const method = request.method;
    const url = new URL(request.url).pathname;
    contextLogger.error(`[${method} ${url}] Unhandled route error`, {}, error instanceof Error ? error : undefined);
    return serverError('Internal server error');
  }
}

/**
 * Higher-order function to create a route handler with context
 *
 * Creates a complete route handler that can be directly exported.
 * Automatically catches ZodErrors (returning 400) and unhandled errors (returning 500).
 */
export function createContextHandler(
  handler: (
    request: NextRequest,
    context: RequestContext
  ) => Promise<NextResponse>
): (request: NextRequest) => Promise<NextResponse> {
  return async (request: NextRequest) => {
    const result = await buildRequestContext();
    if ('response' in result) return result.response;
    return handleRouteError(request, () => handler(request, result.context));
  };
}

/**
 * Higher-order function to create a route handler with context and params
 *
 * Creates a complete route handler that can be directly exported for routes
 * with dynamic parameters like [id].
 */
export function createContextParamsHandler<P extends Record<string, string | string[]>>(
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
    const result = await buildRequestContext();
    if ('response' in result) return result.response;
    const params = await context.params;
    return handleRouteError(request, () => handler(request, result.context, params));
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
export type AuthenticatedParamsHandler<P = Record<string, string | string[]>, T = NextResponse> = ContextParamsHandler<P, T>;
export const withAuth = withContext;
export const withAuthParams = withContextParams;
export const createAuthenticatedHandler = createContextHandler;
export const createAuthenticatedParamsHandler = createContextParamsHandler;
export const checkOwnership = <T extends { userId?: string }>(
  resource: T | null | undefined,
  _userId: string
): resource is T => exists(resource);
