/**
 * Sync API Key Individual Operations
 *
 * PATCH /api/sync/api-keys/[id] - Update an API key (name, active status)
 * DELETE /api/sync/api-keys/[id] - Delete an API key
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { logger } from '@/lib/logger';
import { getServerSession } from '@/lib/auth/session';
import { getRepositories } from '@/lib/repositories/factory';

// Schema for updating an API key
const UpdateApiKeySchema = z.object({
  name: z.string().min(1).max(100).optional(),
  isActive: z.boolean().optional(),
});

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * PATCH /api/sync/api-keys/[id]
 *
 * Update an API key's name or active status.
 */
export async function PATCH(req: NextRequest, { params }: RouteParams) {
  const startTime = Date.now();
  const { id } = await params;

  try {
    const session = await getServerSession();
    if (!session?.user?.id) {
      logger.warn('Sync API key PATCH requested without authentication', {
        context: 'api:sync:api-keys',
        keyId: id,
      });
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Parse request body
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      logger.warn('Sync API key PATCH received invalid JSON', {
        context: 'api:sync:api-keys',
        userId: session.user.id,
        keyId: id,
      });
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    // Validate request
    const parseResult = UpdateApiKeySchema.safeParse(body);
    if (!parseResult.success) {
      logger.warn('Sync API key PATCH received invalid request', {
        context: 'api:sync:api-keys',
        userId: session.user.id,
        keyId: id,
        errors: parseResult.error.errors,
      });
      return NextResponse.json(
        { error: 'Invalid request', details: parseResult.error.errors },
        { status: 400 }
      );
    }

    logger.debug('Updating sync API key', {
      context: 'api:sync:api-keys',
      userId: session.user.id,
      keyId: id,
    });

    const repos = getRepositories();

    // Check key exists and belongs to user
    const existingKey = await repos.userSyncApiKeys.findById(id);
    if (!existingKey) {
      logger.warn('Sync API key not found for update', {
        context: 'api:sync:api-keys',
        userId: session.user.id,
        keyId: id,
      });
      return NextResponse.json({ error: 'API key not found' }, { status: 404 });
    }

    if (existingKey.userId !== session.user.id) {
      logger.warn('Sync API key update forbidden - wrong user', {
        context: 'api:sync:api-keys',
        userId: session.user.id,
        keyId: id,
        keyUserId: existingKey.userId,
      });
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Update the key
    const updatedKey = await repos.userSyncApiKeys.update(id, parseResult.data);

    if (!updatedKey) {
      logger.error('Failed to update sync API key', {
        context: 'api:sync:api-keys',
        userId: session.user.id,
        keyId: id,
      });
      return NextResponse.json({ error: 'Failed to update API key' }, { status: 500 });
    }

    const duration = Date.now() - startTime;

    logger.info('Sync API key updated', {
      context: 'api:sync:api-keys',
      userId: session.user.id,
      keyId: id,
      durationMs: duration,
    });

    return NextResponse.json(
      {
        key: {
          id: updatedKey.id,
          name: updatedKey.name,
          keyPrefix: updatedKey.keyPrefix,
          isActive: updatedKey.isActive,
          lastUsedAt: updatedKey.lastUsedAt,
          createdAt: updatedKey.createdAt,
          updatedAt: updatedKey.updatedAt,
        },
      },
      { status: 200 }
    );
  } catch (error) {
    const duration = Date.now() - startTime;

    logger.error('Error updating sync API key', {
      context: 'api:sync:api-keys',
      keyId: id,
      error: error instanceof Error ? error.message : String(error),
      durationMs: duration,
    });

    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * DELETE /api/sync/api-keys/[id]
 *
 * Delete an API key.
 */
export async function DELETE(req: NextRequest, { params }: RouteParams) {
  const startTime = Date.now();
  const { id } = await params;

  try {
    const session = await getServerSession();
    if (!session?.user?.id) {
      logger.warn('Sync API key DELETE requested without authentication', {
        context: 'api:sync:api-keys',
        keyId: id,
      });
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    logger.debug('Deleting sync API key', {
      context: 'api:sync:api-keys',
      userId: session.user.id,
      keyId: id,
    });

    const repos = getRepositories();

    // Check key exists and belongs to user
    const existingKey = await repos.userSyncApiKeys.findById(id);
    if (!existingKey) {
      logger.warn('Sync API key not found for delete', {
        context: 'api:sync:api-keys',
        userId: session.user.id,
        keyId: id,
      });
      return NextResponse.json({ error: 'API key not found' }, { status: 404 });
    }

    if (existingKey.userId !== session.user.id) {
      logger.warn('Sync API key delete forbidden - wrong user', {
        context: 'api:sync:api-keys',
        userId: session.user.id,
        keyId: id,
        keyUserId: existingKey.userId,
      });
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Delete the key
    const deleted = await repos.userSyncApiKeys.delete(id);

    if (!deleted) {
      logger.error('Failed to delete sync API key', {
        context: 'api:sync:api-keys',
        userId: session.user.id,
        keyId: id,
      });
      return NextResponse.json({ error: 'Failed to delete API key' }, { status: 500 });
    }

    const duration = Date.now() - startTime;

    logger.info('Sync API key deleted', {
      context: 'api:sync:api-keys',
      userId: session.user.id,
      keyId: id,
      durationMs: duration,
    });

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    const duration = Date.now() - startTime;

    logger.error('Error deleting sync API key', {
      context: 'api:sync:api-keys',
      keyId: id,
      error: error instanceof Error ? error.message : String(error),
      durationMs: duration,
    });

    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
