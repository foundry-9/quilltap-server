/**
 * Sync Push API
 *
 * POST /api/sync/push
 *
 * Receives entities from a remote instance and applies them locally.
 * Handles conflict resolution using last-write-wins strategy.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { logger } from '@/lib/logger';
import { getServerSession } from '@/lib/auth/session';
import { getRepositories } from '@/lib/repositories/factory';
import { SyncPushRequestSchema, SyncPushResponse } from '@/lib/sync/types';
import {
  processRemoteDeltas,
  startSyncOperation,
  completeSyncOperation,
} from '@/lib/sync/sync-service';
import { getAuthenticatedUserForSync } from '@/lib/sync/api-key-auth';

/**
 * POST /api/sync/push
 *
 * Receive and apply entities from a remote instance.
 *
 * Request body:
 * - deltas: SyncEntityDelta[] - Entities to apply
 * - mappings: Array<{ localId, remoteId?, entityType }> - ID mappings
 */
export async function POST(req: NextRequest) {
  const startTime = Date.now();

  try {
    // Check authentication (via session or API key)
    const session = await getServerSession();
    const authResult = await getAuthenticatedUserForSync(req, session?.user?.id || null);

    if (!authResult.userId) {
      logger.warn('Sync push attempted without authentication', {
        context: 'api:sync:push',
      });
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userId = authResult.userId;

    // Parse request body
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      logger.warn('Sync push received invalid JSON', {
        context: 'api:sync:push',
        userId,
      });
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    // Validate request
    const parseResult = SyncPushRequestSchema.safeParse(body);
    if (!parseResult.success) {
      logger.warn('Sync push received invalid request', {
        context: 'api:sync:push',
        userId,
        errors: parseResult.error.errors,
      });
      return NextResponse.json(
        { error: 'Invalid request', details: parseResult.error.errors },
        { status: 400 }
      );
    }

    const { deltas, mappings } = parseResult.data;

    // Get remote instance ID from header (identifies who is pushing to us)
    const remoteInstanceId = req.headers.get('X-Sync-Instance-Id') || 'unknown-remote';

    logger.info('Processing sync push request', {
      context: 'api:sync:push',
      userId,
      authMethod: authResult.authMethod,
      remoteInstanceId,
      deltaCount: deltas.length,
      mappingCount: mappings.length,
    });

    // Start a sync operation to record this push (from our perspective, we're receiving/pulling)
    const operation = await startSyncOperation(userId, remoteInstanceId, 'PULL');

    try {
      // Process the incoming deltas
      const result = await processRemoteDeltas(userId, remoteInstanceId, deltas);

      // Build mapping updates to return
      // These tell the remote instance what local IDs were created for their entities
      const mappingUpdates = result.newMappings.map((m) => ({
        localId: m.remoteId, // From remote's perspective, their localId is our remoteId
        remoteId: m.localId, // Our localId becomes their remoteId
        entityType: m.entityType,
      }));

      const response: SyncPushResponse = {
        success: result.errors.length === 0,
        mappingUpdates,
        conflicts: result.conflicts,
        errors: result.errors,
      };

      const duration = Date.now() - startTime;

      // Complete the sync operation
      await completeSyncOperation(
        operation.id,
        result.errors.length === 0,
        { received: result.applied },
        result.conflicts,
        result.errors
      );

      logger.info('Sync push request complete', {
        context: 'api:sync:push',
        userId,
        operationId: operation.id,
        applied: result.applied,
        conflictCount: result.conflicts.length,
        errorCount: result.errors.length,
        newMappingCount: result.newMappings.length,
        durationMs: duration,
      });

      return NextResponse.json(response, { status: 200 });
    } catch (error) {
      // Mark operation as failed
      await completeSyncOperation(
        operation.id,
        false,
        {},
        [],
        [error instanceof Error ? error.message : String(error)]
      );
      throw error;
    }
  } catch (error) {
    const duration = Date.now() - startTime;

    logger.error('Error processing sync push request', {
      context: 'api:sync:push',
      error: error instanceof Error ? error.message : String(error),
      durationMs: duration,
    });

    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
