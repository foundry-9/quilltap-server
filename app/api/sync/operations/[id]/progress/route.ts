/**
 * Sync Operation Progress API
 *
 * GET /api/sync/operations/[id]/progress - Get real-time progress for a sync operation
 */

import { NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { createAuthenticatedParamsHandler } from '@/lib/api/middleware';

/**
 * GET /api/sync/operations/[id]/progress
 *
 * Get real-time progress for a specific sync operation.
 * Returns the current progress state including phase, item being synced, and counts.
 */
export const GET = createAuthenticatedParamsHandler<{ id: string }>(
  async (req, { user, repos }, { id: operationId }) => {
    const startTime = Date.now();

    try {
      logger.debug('Getting sync operation progress', {
        context: 'api:sync:operations:progress',
        userId: user.id,
        operationId,
      });

      const operation = await repos.syncOperations.findById(operationId);

      if (!operation) {
        logger.warn('Sync operation not found for progress request', {
          context: 'api:sync:operations:progress',
          userId: user.id,
          operationId,
        });
        return NextResponse.json({ error: 'Operation not found' }, { status: 404 });
      }

      // Verify ownership
      if (operation.userId !== user.id) {
        logger.warn('Sync operation progress requested for non-owned operation', {
          context: 'api:sync:operations:progress',
          userId: user.id,
          operationId,
          operationUserId: operation.userId,
        });
        return NextResponse.json({ error: 'Operation not found' }, { status: 404 });
      }

      const duration = Date.now() - startTime;

      logger.debug('Sync operation progress retrieved', {
        context: 'api:sync:operations:progress',
        userId: user.id,
        operationId,
        status: operation.status,
        phase: operation.progress?.phase,
        durationMs: duration,
      });

      // Return progress state
      return NextResponse.json(
        {
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
        },
        { status: 200 }
      );
    } catch (error) {
      const duration = Date.now() - startTime;

      logger.error('Error getting sync operation progress', {
        context: 'api:sync:operations:progress',
        operationId,
        error: error instanceof Error ? error.message : String(error),
        durationMs: duration,
      });

      return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
  }
);
