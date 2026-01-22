/**
 * Sync API Key Authentication
 *
 * Utilities for authenticating sync requests using API keys.
 * Supports Bearer token authentication for cross-instance sync.
 */

import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { getRepositories } from '@/lib/repositories/factory';
import { getRepositoriesSafe, type RepositoryContainer } from '@/lib/repositories/factory';
import { getServerSession, type ExtendedSession } from '@/lib/auth/session';
import { API_KEY_PREFIX } from './user-api-keys';
import type { User } from '@/lib/schemas/types';

/**
 * Result of API key authentication
 */
export interface ApiKeyAuthResult {
  authenticated: boolean;
  userId?: string;
  keyId?: string;
  error?: string;
}

/**
 * Extract Bearer token from Authorization header
 */
function extractBearerToken(request: NextRequest): string | null {
  const authHeader = request.headers.get('Authorization');

  if (!authHeader) {
    logger.debug('No Authorization header found', {
      context: 'sync:api-key-auth',
    });
    return null;
  }

  if (!authHeader.startsWith('Bearer ')) {
    logger.debug('Authorization header is not Bearer type', {
      context: 'sync:api-key-auth',
    });
    return null;
  }

  const token = authHeader.substring(7).trim();

  if (!token) {
    logger.debug('Bearer token is empty', {
      context: 'sync:api-key-auth',
    });
    return null;
  }

  return token;
}

/**
 * Validate an API key and return the associated user
 *
 * This function checks:
 * 1. The token is in the correct format (qt_sync_...)
 * 2. The token matches an active API key in the database
 * 3. Updates the last used timestamp on successful validation
 */
export async function validateApiKey(plaintextKey: string): Promise<ApiKeyAuthResult> {
  const startTime = Date.now();

  logger.debug('Validating API key', {
    context: 'sync:api-key-auth',
    keyPrefix: plaintextKey.substring(0, 16), // Show prefix for debugging
  });

  // Check format
  if (!plaintextKey.startsWith(API_KEY_PREFIX)) {
    logger.debug('API key has invalid format', {
      context: 'sync:api-key-auth',
    });
    return {
      authenticated: false,
      error: 'Invalid API key format',
    };
  }

  try {
    const repos = getRepositories();

    // Get all active API keys
    // Note: This could be optimized with a prefix-based lookup in the future
    const activeKeys = await repos.userSyncApiKeys.findAllActive();

    logger.debug('Checking against active API keys', {
      context: 'sync:api-key-auth',
      activeKeyCount: activeKeys.length,
    });

    // Try to match the key
    for (const key of activeKeys) {
      const isMatch = await repos.userSyncApiKeys.verifyApiKey(plaintextKey, key.keyHash);

      if (isMatch) {
        const duration = Date.now() - startTime;

        logger.info('API key validated successfully', {
          context: 'sync:api-key-auth',
          keyId: key.id,
          userId: key.userId,
          keyPrefix: key.keyPrefix,
          durationMs: duration,
        });

        // Update last used timestamp (fire and forget)
        repos.userSyncApiKeys.updateLastUsed(key.id).catch((error) => {
          logger.warn('Failed to update API key last used timestamp', {
            context: 'sync:api-key-auth',
            keyId: key.id,
            error: error instanceof Error ? error.message : String(error),
          });
        });

        return {
          authenticated: true,
          userId: key.userId,
          keyId: key.id,
        };
      }
    }

    const duration = Date.now() - startTime;

    logger.warn('API key not found or inactive', {
      context: 'sync:api-key-auth',
      durationMs: duration,
    });

    return {
      authenticated: false,
      error: 'Invalid or inactive API key',
    };
  } catch (error) {
    const duration = Date.now() - startTime;

    logger.error('Error validating API key', {
      context: 'sync:api-key-auth',
      error: error instanceof Error ? error.message : String(error),
      durationMs: duration,
    });

    return {
      authenticated: false,
      error: 'Authentication error',
    };
  }
}

/**
 * Authenticate a sync request using Bearer token
 *
 * This is the main entry point for sync endpoint authentication.
 * Returns the authenticated user ID if successful.
 */
export async function authenticateSyncRequest(request: NextRequest): Promise<ApiKeyAuthResult> {
  const token = extractBearerToken(request);

  if (!token) {
    return {
      authenticated: false,
      error: 'No Bearer token provided',
    };
  }

  return validateApiKey(token);
}

/**
 * Get user ID from either session cookie or Bearer token
 *
 * This allows sync endpoints to work with both:
 * - Local users authenticated via session cookie
 * - Remote instances authenticated via API key
 */
export async function getAuthenticatedUserForSync(
  request: NextRequest,
  sessionUserId: string | null
): Promise<{ userId: string | null; authMethod: 'session' | 'api_key' | null; keyId?: string }> {
  // First try session auth
  if (sessionUserId) {
    logger.debug('Using session authentication for sync', {
      context: 'sync:api-key-auth',
      userId: sessionUserId,
    });
    return {
      userId: sessionUserId,
      authMethod: 'session',
    };
  }

  // Fall back to API key auth
  const apiKeyResult = await authenticateSyncRequest(request);

  if (apiKeyResult.authenticated && apiKeyResult.userId) {
    logger.debug('Using API key authentication for sync', {
      context: 'sync:api-key-auth',
      userId: apiKeyResult.userId,
      keyId: apiKeyResult.keyId,
    });
    return {
      userId: apiKeyResult.userId,
      authMethod: 'api_key',
      keyId: apiKeyResult.keyId,
    };
  }

  logger.debug('No valid authentication for sync request', {
    context: 'sync:api-key-auth',
  });

  return {
    userId: null,
    authMethod: null,
  };
}

// ============================================================================
// Sync Route Authentication Handler
// ============================================================================

/**
 * Context provided to sync-authenticated route handlers
 */
export interface SyncAuthenticatedContext {
  /** The authenticated user entity from the database */
  user: User;
  /** Repository container for data access */
  repos: RepositoryContainer;
  /** The session object (only present for session auth) */
  session: ExtendedSession | null;
  /** How the request was authenticated */
  authMethod: 'session' | 'api_key';
  /** The API key ID if authenticated via API key */
  apiKeyId?: string;
}

/**
 * Higher-order function to create a sync-authenticated route handler
 *
 * This handler supports BOTH session-based authentication (for local users)
 * AND Bearer token API key authentication (for remote instances).
 *
 * @example
 * ```ts
 * export const POST = createSyncAuthenticatedHandler(async (req, { user, repos, authMethod }) => {
 *   logger.info('Sync request', { userId: user.id, authMethod });
 *   // ... handle sync request
 * });
 * ```
 */
export function createSyncAuthenticatedHandler(
  handler: (
    request: NextRequest,
    context: SyncAuthenticatedContext
  ) => Promise<NextResponse>
): (request: NextRequest) => Promise<NextResponse> {
  return async (request: NextRequest) => {
    const repos = await getRepositoriesSafe();

    // Try session auth first
    const session = await getServerSession();

    if (session?.user?.id) {
      const user = await repos.users.findById(session.user.id);

      if (user) {
        logger.debug('Sync request authenticated via session', {
          context: 'sync:api-key-auth',
          userId: user.id,
        });
        return handler(request, { user, repos, session, authMethod: 'session' });
      }
    }

    // Fall back to API key auth
    const apiKeyResult = await authenticateSyncRequest(request);

    if (apiKeyResult.authenticated && apiKeyResult.userId) {
      const user = await repos.users.findById(apiKeyResult.userId);

      if (user) {
        logger.debug('Sync request authenticated via API key', {
          context: 'sync:api-key-auth',
          userId: user.id,
          keyId: apiKeyResult.keyId,
        });
        return handler(request, {
          user,
          repos,
          session: null,
          authMethod: 'api_key',
          apiKeyId: apiKeyResult.keyId,
        });
      } else {
        logger.warn('API key valid but user not found', {
          context: 'sync:api-key-auth',
          userId: apiKeyResult.userId,
          keyId: apiKeyResult.keyId,
        });
      }
    }

    // No valid authentication
    logger.debug('Sync request unauthorized - no valid session or API key', {
      context: 'sync:api-key-auth',
    });
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  };
}
