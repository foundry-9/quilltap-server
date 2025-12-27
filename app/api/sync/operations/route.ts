/**
 * Sync Operations API
 *
 * GET /api/sync/operations - List sync operations for user
 */

import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { getServerSession } from '@/lib/auth/session';
import { getRepositories } from '@/lib/repositories/factory';

/**
 * GET /api/sync/operations
 *
 * List recent sync operations for the authenticated user.
 *
 * Query params:
 * - instanceId?: string - Filter by instance ID
 * - limit?: number - Maximum number of operations (default 50, max 100)
 */
export async function GET(req: NextRequest) {
  const startTime = Date.now();

  try {
    const session = await getServerSession();
    if (!session?.user?.id) {
      logger.warn('Sync operations GET requested without authentication', {
        context: 'api:sync:operations',
      });
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get query params
    const { searchParams } = new URL(req.url);
    const instanceId = searchParams.get('instanceId');
    const limitParam = searchParams.get('limit');
    const limit = Math.min(parseInt(limitParam || '50', 10), 100);

    logger.debug('Getting sync operations', {
      context: 'api:sync:operations',
      userId: session.user.id,
      instanceId,
      limit,
    });

    const repos = getRepositories();
    let operations;

    if (instanceId) {
      // Verify instance ownership
      const instance = await repos.syncInstances.findById(instanceId);
      if (!instance || instance.userId !== session.user.id) {
        logger.warn('Sync operations requested for non-owned instance', {
          context: 'api:sync:operations',
          userId: session.user.id,
          instanceId,
        });
        return NextResponse.json({ error: 'Instance not found' }, { status: 404 });
      }

      operations = await repos.syncOperations.findByInstanceId(
        session.user.id,
        instanceId,
        limit
      );
    } else {
      operations = await repos.syncOperations.findByUserId(session.user.id, limit);
    }

    const duration = Date.now() - startTime;

    logger.info('Sync operations GET complete', {
      context: 'api:sync:operations',
      userId: session.user.id,
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

    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
