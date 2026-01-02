/**
 * Sync Operations API
 *
 * GET /api/sync/operations - List sync operations for user
 */

import { NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { createAuthenticatedHandler } from '@/lib/api/middleware';
import { notFound, serverError } from '@/lib/api/responses';

/**
 * GET /api/sync/operations
 *
 * List recent sync operations for the authenticated user.
 *
 * Query params:
 * - instanceId?: string - Filter by instance ID
 * - limit?: number - Maximum number of operations (default 50, max 100)
 */
export const GET = createAuthenticatedHandler(async (req, { user, repos }) => {
  const startTime = Date.now();

  try {
    // Get query params
    const { searchParams } = new URL(req.url);
    const instanceId = searchParams.get('instanceId');
    const limitParam = searchParams.get('limit');
    const limit = Math.min(parseInt(limitParam || '50', 10), 100);

    logger.debug('Getting sync operations', {
      context: 'api:sync:operations',
      userId: user.id,
      instanceId,
      limit,
    });

    let operations;

    if (instanceId) {
      // Verify instance ownership
      const instance = await repos.syncInstances.findById(instanceId);
      if (!instance || instance.userId !== user.id) {
        logger.warn('Sync operations requested for non-owned instance', {
          context: 'api:sync:operations',
          userId: user.id,
          instanceId,
        });
        return notFound('Instance');
      }

      operations = await repos.syncOperations.findByInstanceId(
        user.id,
        instanceId,
        limit
      );
    } else {
      operations = await repos.syncOperations.findByUserId(user.id, limit);
    }

    const duration = Date.now() - startTime;

    logger.info('Sync operations GET complete', {
      context: 'api:sync:operations',
      userId: user.id,
      instanceId,
      operationCount: operations.length,
      durationMs: duration,
    });

    return NextResponse.json({ operations }, { status: 200 });
  } catch (error) {
    const duration = Date.now() - startTime;

    logger.error('Error getting sync operations', {
      context: 'api:sync:operations',
      error: error instanceof Error ? error.message : String(error),
      durationMs: duration,
    });

    return serverError();
  }
});
