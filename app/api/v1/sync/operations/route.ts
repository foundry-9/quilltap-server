/**
 * Sync Operations v1 API
 *
 * GET /api/v1/sync/operations - List sync operations for user
 *
 * Query params:
 * - instanceId?: string - Filter by instance ID
 * - limit?: number - Maximum number of operations (default 50, max 100)
 */

import { logger } from '@/lib/logger';
import { createAuthenticatedHandler } from '@/lib/api/middleware';
import { successResponse, notFound, serverError } from '@/lib/api/responses';

const syncOpsLogger = logger.child({ module: 'sync-operations-v1' });

/**
 * GET /api/v1/sync/operations
 *
 * List recent sync operations for the authenticated user.
 * Optionally filter by instance ID.
 */
export const GET = createAuthenticatedHandler(async (req, { user, repos }) => {
  const startTime = Date.now();

  try {
    // Get query params
    const { searchParams } = new URL(req.url);
    const instanceId = searchParams.get('instanceId');
    const limitParam = searchParams.get('limit');
    const limit = Math.min(parseInt(limitParam || '50', 10), 100);


    let operations;

    if (instanceId) {
      // Verify instance ownership
      const instance = await repos.syncInstances.findById(instanceId);
      if (!instance || instance.userId !== user.id) {
        syncOpsLogger.warn('[Sync Operations v1] Operations requested for non-owned instance', {
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

    syncOpsLogger.info('[Sync Operations v1] GET complete', {
      userId: user.id,
      instanceId,
      operationCount: operations.length,
      durationMs: duration,
    });

    return successResponse({ operations });
  } catch (error) {
    const duration = Date.now() - startTime;

    syncOpsLogger.error('[Sync Operations v1] Error getting sync operations', {
      error: error instanceof Error ? error.message : String(error),
      durationMs: duration,
    });

    return serverError();
  }
});
