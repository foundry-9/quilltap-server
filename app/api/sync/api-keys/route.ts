/**
 * Sync API Keys API
 *
 * GET /api/sync/api-keys - List all sync API keys for user
 * POST /api/sync/api-keys - Create a new sync API key
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { logger } from '@/lib/logger';
import { createAuthenticatedHandler } from '@/lib/api/middleware';
import { badRequest, serverError, validationError, created } from '@/lib/api/responses';

// Schema for creating a new API key
const CreateApiKeySchema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
});

/**
 * GET /api/sync/api-keys
 *
 * List all sync API keys for the authenticated user.
 * Returns keys without the hash (only prefix for display).
 */
export const GET = createAuthenticatedHandler(async (req, { user, repos }) => {
  const startTime = Date.now();

  try {
    logger.debug('Getting sync API keys', {
      context: 'api:sync:api-keys',
      userId: user.id,
    });

    const keys = await repos.userSyncApiKeys.findByUserId(user.id);

    // Remove sensitive data (hash) from response
    const sanitizedKeys = keys.map((key) => ({
      id: key.id,
      name: key.name,
      keyPrefix: key.keyPrefix,
      isActive: key.isActive,
      lastUsedAt: key.lastUsedAt,
      createdAt: key.createdAt,
      updatedAt: key.updatedAt,
    }));

    const duration = Date.now() - startTime;

    logger.info('Sync API keys GET complete', {
      context: 'api:sync:api-keys',
      userId: user.id,
      keyCount: sanitizedKeys.length,
      durationMs: duration,
    });

    return NextResponse.json({ keys: sanitizedKeys }, { status: 200 });
  } catch (error) {
    const duration = Date.now() - startTime;

    logger.error('Error getting sync API keys', {
      context: 'api:sync:api-keys',
      error: error instanceof Error ? error.message : String(error),
      durationMs: duration,
    });

    return serverError();
  }
});

/**
 * POST /api/sync/api-keys
 *
 * Create a new sync API key.
 * Returns the full plaintext key (only shown once).
 */
export const POST = createAuthenticatedHandler(async (req, { user, repos }) => {
  const startTime = Date.now();

  try {
    // Parse request body
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      logger.warn('Sync API keys POST received invalid JSON', {
        context: 'api:sync:api-keys',
        userId: user.id,
      });
      return badRequest('Invalid JSON body');
    }

    // Validate request
    const parseResult = CreateApiKeySchema.safeParse(body);
    if (!parseResult.success) {
      logger.warn('Sync API keys POST received invalid request', {
        context: 'api:sync:api-keys',
        userId: user.id,
        errors: parseResult.error.errors,
      });
      return validationError(parseResult.error);
    }

    const { name } = parseResult.data;

    logger.info('Creating sync API key', {
      context: 'api:sync:api-keys',
      userId: user.id,
      name,
    });

    // Create the key
    const result = await repos.userSyncApiKeys.createApiKey(user.id, name);

    const duration = Date.now() - startTime;

    logger.info('Sync API key created', {
      context: 'api:sync:api-keys',
      userId: user.id,
      keyId: result.key.id,
      name,
      keyPrefix: result.key.keyPrefix,
      durationMs: duration,
    });

    // Return the key with the plaintext (only time it's shown)
    return created({
      key: {
        id: result.key.id,
        name: result.key.name,
        keyPrefix: result.key.keyPrefix,
        isActive: result.key.isActive,
        createdAt: result.key.createdAt,
        updatedAt: result.key.updatedAt,
      },
      plaintextKey: result.plaintextKey,
    });
  } catch (error) {
    const duration = Date.now() - startTime;

    logger.error('Error creating sync API key', {
      context: 'api:sync:api-keys',
      error: error instanceof Error ? error.message : String(error),
      durationMs: duration,
    });

    return serverError();
  }
});
