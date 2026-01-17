/**
 * Authentication Middleware
 *
 * Provides a reusable authentication wrapper for API routes.
 * Extracts the common pattern of session verification, user lookup,
 * and repository initialization used across 100+ routes.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession, type ExtendedSession } from '@/lib/auth/session';
import { getRepositoriesSafe, type RepositoryContainer } from '@/lib/repositories/factory';
import { logger } from '@/lib/logger';
import type { User } from '@/lib/schemas/types';

const authLogger = logger.child({ module: 'api-auth-middleware' });

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
 * This extracts the common pattern from 100+ routes:
 * 1. Get server session
 * 2. Check for valid session/user ID
 * 3. Get repositories
 * 4. Look up user
 * 5. Verify user exists
 *
 * @example
 * ```ts
 * // Before (repeated in every route):
 * export async function GET(req: NextRequest) {
 *   const session = await getServerSession();
 *   if (!session?.user?.id) {
 *     return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
 *   }
 *   const repos = await getRepositoriesSafe();
 *   const user = await repos.users.findById(session.user.id);
 *   if (!user) {
 *     return NextResponse.json({ error: 'User not found' }, { status: 404 });
 *   }
 *   // ... actual handler logic
 * }
 *
 * // After:
 * export async function GET(req: NextRequest) {
 *   return withAuth(async (request, { user, repos, session }) => {
 *     // ... actual handler logic
 *   });
 * }
 * ```
 */
export async function withAuth<T>(
  handler: AuthenticatedHandler<T>
): Promise<T | NextResponse> {
  const session = await getServerSession();

  if (!session?.user?.id) {
    authLogger.debug('Unauthorized request - no valid session');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const repos = await getRepositoriesSafe();
  const user = await repos.users.findById(session.user.id);

  if (!user) {
    authLogger.warn('User not found for session', { userId: session.user.id });
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  authLogger.debug('Request authenticated', { userId: user.id });
  return handler({} as NextRequest, { user, repos, session });
}

/**
 * Create an authenticated handler wrapper for routes with params
 *
 * This is useful for routes like /api/characters/[id] that need
 * to access route parameters.
 *
 * @example
 * ```ts
 * // For routes with params like /api/characters/[id]
 * export async function GET(
 *   req: NextRequest,
 *   { params }: { params: Promise<{ id: string }> }
 * ) {
 *   const { id } = await params;
 *   return withAuthParams(req, { id }, async (request, { user, repos }, { id }) => {
 *     const character = await repos.characters.findById(id);
 *     // ... handle character
 *   });
 * }
 * ```
 */
export async function withAuthParams<P extends Record<string, string>, T>(
  request: NextRequest,
  params: P,
  handler: AuthenticatedParamsHandler<P, T>
): Promise<T | NextResponse> {
  const session = await getServerSession();

  if (!session?.user?.id) {
    authLogger.debug('Unauthorized request - no valid session');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const repos = await getRepositoriesSafe();
  const user = await repos.users.findById(session.user.id);

  if (!user) {
    authLogger.warn('User not found for session', { userId: session.user.id });
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  authLogger.debug('Request authenticated', { userId: user.id });
  return handler(request, { user, repos, session }, params);
}

/**
 * Higher-order function to create an authenticated route handler
 *
 * Creates a complete route handler that can be directly exported.
 * Handles the request object properly.
 *
 * @example
 * ```ts
 * export const GET = createAuthenticatedHandler(async (req, { user, repos }) => {
 *   const characters = await repos.characters.findByUserId(user.id);
 *   return NextResponse.json({ characters });
 * });
 * ```
 */
export function createAuthenticatedHandler(
  handler: (
    request: NextRequest,
    context: AuthenticatedContext
  ) => Promise<NextResponse>
): (request: NextRequest) => Promise<NextResponse> {
  return async (request: NextRequest) => {
    const session = await getServerSession();

    if (!session?.user?.id) {
      authLogger.debug('Unauthorized request - no valid session');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const repos = await getRepositoriesSafe();
    const user = await repos.users.findById(session.user.id);

    if (!user) {
      authLogger.warn('User not found for session', { userId: session.user.id });
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    authLogger.debug('Request authenticated', { userId: user.id });
    return handler(request, { user, repos, session });
  };
}

/**
 * Higher-order function to create an authenticated route handler with params
 *
 * Creates a complete route handler that can be directly exported for routes
 * with dynamic parameters like [id].
 *
 * @example
 * ```ts
 * export const GET = createAuthenticatedParamsHandler<{ id: string }>(
 *   async (req, { user, repos }, { id }) => {
 *     const character = await repos.characters.findById(id);
 *     if (!character || character.userId !== user.id) {
 *       return NextResponse.json({ error: 'Not found' }, { status: 404 });
 *     }
 *     return NextResponse.json({ character });
 *   }
 * );
 * ```
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
    const params = await context.params;
    const session = await getServerSession();

    if (!session?.user?.id) {
      authLogger.debug('Unauthorized request - no valid session');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const repos = await getRepositoriesSafe();
    const user = await repos.users.findById(session.user.id);

    if (!user) {
      authLogger.warn('User not found for session', { userId: session.user.id });
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    authLogger.debug('Request authenticated', { userId: user.id });
    return handler(request, { user, repos, session }, params);
  };
}

/**
 * Check ownership of a resource
 *
 * Common pattern for verifying a resource belongs to the current user.
 *
 * @example
 * ```ts
 * const character = await repos.characters.findById(id);
 * if (!checkOwnership(character, user.id)) {
 *   return NextResponse.json({ error: 'Not found' }, { status: 404 });
 * }
 * ```
 */
export function checkOwnership<T extends { userId?: string }>(
  resource: T | null | undefined,
  userId: string
): resource is T {
  return resource != null && resource.userId === userId;
}
