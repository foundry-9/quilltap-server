/**
 * Sync API Keys API
 *
 * GET /api/sync/api-keys - List all sync API keys for user
 * POST /api/sync/api-keys - Create a new sync API key
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { logger } from '@/lib/logger';
import { getServerSession } from '@/lib/auth/session';
import { getRepositories } from '@/lib/repositories/factory';

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
export async function GET(req: NextRequest) {
  const startTime = Date.now();

  try {
    const session = await getServerSession();
    if (!session?.user?.id) {
      logger.warn('Sync API keys GET requested without authentication', {
        context: 'api:sync:api-keys',
      });
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    logger.debug('Getting sync API keys', {
      context: 'api:sync:api-keys',
      userId: session.user.id,
    });

    const repos = getRepositories();
    const keys = await repos.userSyncApiKeys.findByUserId(session.user.id);

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
      userId: session.user.id,
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

    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * POST /api/sync/api-keys
 *
 * Create a new sync API key.
 * Returns the full plaintext key (only shown once).
 */
export async function POST(req: NextRequest) {
  const startTime = Date.now();

  try {
    const session = await getServerSession();
    if (!session?.user?.id) {
      logger.warn('Sync API keys POST requested without authentication', {
        context: 'api:sync:api-keys',
      });
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Parse request body
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      logger.warn('Sync API keys POST received invalid JSON', {
        context: 'api:sync:api-keys',
        userId: session.user.id,
      });
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    // Validate request
    const parseResult = CreateApiKeySchema.safeParse(body);
    if (!parseResult.success) {
      logger.warn('Sync API keys POST received invalid request', {
        context: 'api:sync:api-keys',
        userId: session.user.id,
        errors: parseResult.error.errors,
      });
      return NextResponse.json(
        { error: 'Invalid request', details: parseResult.error.errors },
        { status: 400 }
      );
    }

    const { name } = parseResult.data;

    logger.info('Creating sync API key', {
      context: 'api:sync:api-keys',
      userId: session.user.id,
      name,
    });

    const repos = getRepositories();

    // Create the key
    const result = await repos.userSyncApiKeys.create(session.user.id, name);

    const duration = Date.now() - startTime;

    logger.info('Sync API key created', {
      context: 'api:sync:api-keys',
      userId: session.user.id,
      keyId: result.key.id,
      name,
      keyPrefix: result.key.keyPrefix,
      durationMs: duration,
    });

    // Return the key with the plaintext (only time it's shown)
    return NextResponse.json(
      {
        key: {
          id: result.key.id,
          name: result.key.name,
          keyPrefix: result.key.keyPrefix,
          isActive: result.key.isActive,
          createdAt: result.key.createdAt,
          updatedAt: result.key.updatedAt,
        },
        plaintextKey: result.plaintextKey,
      },
      { status: 201 }
    );
  } catch (error) {
    const duration = Date.now() - startTime;

    logger.error('Error creating sync API key', {
      context: 'api:sync:api-keys',
      error: error instanceof Error ? error.message : String(error),
      durationMs: duration,
    });

    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
