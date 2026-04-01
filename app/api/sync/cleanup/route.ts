/**
 * Sync Cleanup API
 *
 * POST /api/sync/cleanup - Clean up sync data for user
 *
 * Removes all sync mappings, operations, and resets instance sync timestamps.
 * Used after migrating to ID preservation to clean up legacy mapping data.
 */

import { NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { createAuthenticatedHandler } from '@/lib/api/middleware';
import { cleanSyncData } from '@/lib/sync/sync-service';

/**
 * POST /api/sync/cleanup
 *
 * Clean up all sync data for the authenticated user.
 * This removes legacy sync mappings, operation history, and resets
 * instance sync timestamps to allow a fresh sync.
 *
 * Response:
 * - mappingsDeleted: number - Count of deleted sync mappings
 * - operationsDeleted: number - Count of deleted sync operations
 * - instancesReset: number - Count of reset sync instances
 */
export const POST = createAuthenticatedHandler(async (req, { user }) => {
  const startTime = Date.now();

  try {
    logger.info('Starting sync data cleanup', {
      context: 'api:sync:cleanup',
      userId: user.id,
    });

    const result = await cleanSyncData(user.id);

    const duration = Date.now() - startTime;

    logger.info('Sync cleanup complete', {
      context: 'api:sync:cleanup',
      userId: user.id,
      mappingsDeleted: result.mappingsDeleted,
      operationsDeleted: result.operationsDeleted,
      instancesReset: result.instancesReset,
      durationMs: duration,
    });

    return NextResponse.json(
      {
        success: true,
        ...result,
      },
      { status: 200 }
    );
  } catch (error) {
    const duration = Date.now() - startTime;

    logger.error('Error during sync cleanup', {
      context: 'api:sync:cleanup',
      error: error instanceof Error ? error.message : String(error),
      durationMs: duration,
    });

    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
});
