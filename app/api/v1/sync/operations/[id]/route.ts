/**
 * Sync Operation Detail v1 API
 *
 * GET /api/v1/sync/operations/[id] - Get operation details
 * GET /api/v1/sync/operations/[id]?action=progress - Get operation progress
 */

import { logger } from '@/lib/logger';
import { createAuthenticatedParamsHandler } from '@/lib/api/middleware';
import { getActionParam } from '@/lib/api/middleware/actions';
import { successResponse, notFound, serverError, badRequest } from '@/lib/api/responses';

const syncOpsLogger = logger.child({ module: 'sync-operations-v1' });

/**
 * GET /api/v1/sync/operations/[id]
 *
 * Get details of a specific sync operation.
 * Use ?action=progress to get real-time progress information.
 */
export const GET = createAuthenticatedParamsHandler<{ id: string }>(
  async (req, { user, repos }, { id: operationId }) => {
    const startTime = Date.now();
    const action = getActionParam(req);

    try {
      syncOpsLogger.debug('[Sync Operations v1] Getting sync operation', {
        userId: user.id,
        operationId,
        action,
      });

      const operation = await repos.syncOperations.findById(operationId);

      if (!operation) {
        syncOpsLogger.warn('[Sync Operations v1] Operation not found', {
          userId: user.id,
          operationId,
        });
        return notFound('Operation');
      }

      // Verify ownership
      if (operation.userId !== user.id) {
        syncOpsLogger.warn('[Sync Operations v1] Operation requested for non-owned operation', {
          userId: user.id,
          operationId,
          operationUserId: operation.userId,
        });
        return notFound('Operation');
      }

      const duration = Date.now() - startTime;

      // Handle action=progress
      if (action === 'progress') {
        syncOpsLogger.debug('[Sync Operations v1] Progress retrieved', {
          userId: user.id,
          operationId,
          status: operation.status,
          phase: operation.progress?.phase,
          durationMs: duration,
        });

        return successResponse({
          operationId: operation.id,
          instanceId: operation.instanceId,
          status: operation.status,
          direction: operation.direction,
          progress: operation.progress || null,
          entityCounts: operation.entityCounts,
          errors: operation.errors,
          conflicts: operation.conflicts,
          startedAt: operation.startedAt,
          completedAt: operation.completedAt,
        });
      }

      // Handle unknown actions
      if (action && action !== 'progress') {
        syncOpsLogger.warn('[Sync Operations v1] Unknown action requested', {
          userId: user.id,
          operationId,
          action,
        });
        return badRequest(`Unknown action: ${action}`, {
          availableActions: ['progress'],
        });
      }

      // Default: return full operation details
      syncOpsLogger.info('[Sync Operations v1] Operation details retrieved', {
        userId: user.id,
        operationId,
        status: operation.status,
        durationMs: duration,
      });

      return successResponse({ operation });
    } catch (error) {
      const duration = Date.now() - startTime;

      syncOpsLogger.error('[Sync Operations v1] Error getting sync operation', {
        operationId,
        action,
        error: error instanceof Error ? error.message : String(error),
        durationMs: duration,
      });

      return serverError();
    }
  }
);
