/**
 * Sync Instance Manual Sync API
 *
 * POST /api/sync/instances/[id]/sync
 *
 * Trigger a manual bidirectional sync with a remote instance.
 */

import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { getServerSession } from '@/lib/auth/session';
import { getRepositories } from '@/lib/repositories/factory';
import {
  remoteHandshake,
  fetchRemoteDeltas,
  pushToRemote,
  RemoteSyncError,
} from '@/lib/sync/remote-client';
import {
  processRemoteDeltas,
  prepareLocalDeltasForPush,
  startSyncOperation,
  completeSyncOperation,
} from '@/lib/sync/sync-service';
import { SyncConflict, SyncResult } from '@/lib/sync/types';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/sync/instances/[id]/sync
 *
 * Perform a full bidirectional sync with the remote instance.
 *
 * Sync algorithm:
 * 1. Handshake - Verify connection and versions
 * 2. Pull - Fetch remote changes and apply locally
 * 3. Push - Send local changes to remote
 * 4. Reconcile - Update mappings
 */
export async function POST(req: NextRequest, { params }: RouteParams) {
  const startTime = Date.now();
  const { id } = await params;

  try {
    const session = await getServerSession();
    if (!session?.user?.id) {
      logger.warn('Sync requested without authentication', {
        context: 'api:sync:instances:[id]:sync',
      });
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    logger.info('Starting manual sync', {
      context: 'api:sync:instances:[id]:sync',
      userId: session.user.id,
      instanceId: id,
    });

    const repos = getRepositories();
    const instance = await repos.syncInstances.findById(id);

    if (!instance) {
      logger.warn('Sync instance not found', {
        context: 'api:sync:instances:[id]:sync',
        userId: session.user.id,
        instanceId: id,
      });
      return NextResponse.json({ error: 'Instance not found' }, { status: 404 });
    }

    // Verify ownership
    if (instance.userId !== session.user.id) {
      logger.warn('Sync denied - not owner', {
        context: 'api:sync:instances:[id]:sync',
        userId: session.user.id,
        instanceId: id,
        ownerId: instance.userId,
      });
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Check if instance is active
    if (!instance.isActive) {
      logger.warn('Sync requested for inactive instance', {
        context: 'api:sync:instances:[id]:sync',
        userId: session.user.id,
        instanceId: id,
      });
      return NextResponse.json({ error: 'Instance is not active' }, { status: 400 });
    }

    // Check for existing in-progress sync
    const inProgressOps = await repos.syncOperations.findInProgress(session.user.id);
    const hasInProgress = inProgressOps.some((op) => op.instanceId === id);
    if (hasInProgress) {
      logger.warn('Sync already in progress for instance', {
        context: 'api:sync:instances:[id]:sync',
        userId: session.user.id,
        instanceId: id,
      });
      return NextResponse.json({ error: 'Sync already in progress' }, { status: 409 });
    }

    // Start sync operation tracking
    const operation = await startSyncOperation(session.user.id, id, 'BIDIRECTIONAL');

    const entityCounts: Record<string, number> = {};
    const allConflicts: SyncConflict[] = [];
    const allErrors: string[] = [];

    try {
      // Step 1: Handshake
      logger.info('Sync step 1: Handshake', {
        context: 'api:sync:instances:[id]:sync',
        operationId: operation.id,
      });

      const handshakeResult = await remoteHandshake(instance);

      if (!handshakeResult.compatible) {
        throw new RemoteSyncError(
          `Version incompatible: ${handshakeResult.reason}`,
          400
        );
      }

      // Update instance with remote version info
      if (handshakeResult.versionInfo) {
        await repos.syncInstances.update(id, {
          schemaVersion: handshakeResult.versionInfo.schemaVersion,
          appVersion: handshakeResult.versionInfo.appVersion,
          remoteUserId: handshakeResult.remoteUserId,
        });
      }

      // Step 2: Pull - Fetch remote changes
      logger.info('Sync step 2: Pull remote changes', {
        context: 'api:sync:instances:[id]:sync',
        operationId: operation.id,
      });

      const lastSyncAt = instance.lastSyncAt ?? null;
      let pullTotal = 0;
      let hasMore = true;
      let cursor: string | null = lastSyncAt;

      while (hasMore) {
        const deltaResponse = await fetchRemoteDeltas(instance, cursor, 100);

        if (deltaResponse.deltas.length > 0) {
          const pullResult = await processRemoteDeltas(
            session.user.id,
            id,
            deltaResponse.deltas
          );

          pullTotal += pullResult.applied;
          allConflicts.push(...pullResult.conflicts);
          allErrors.push(...pullResult.errors);
        }

        hasMore = deltaResponse.hasMore;
        cursor = deltaResponse.nextCursor || null;
      }

      entityCounts.pulled = pullTotal;

      logger.info('Sync step 2 complete: Pulled remote changes', {
        context: 'api:sync:instances:[id]:sync',
        operationId: operation.id,
        pulledCount: pullTotal,
      });

      // Step 3: Push - Send local changes
      logger.info('Sync step 3: Push local changes', {
        context: 'api:sync:instances:[id]:sync',
        operationId: operation.id,
      });

      const localDeltas = await prepareLocalDeltasForPush(session.user.id, id, lastSyncAt);

      if (localDeltas.deltas.length > 0) {
        const pushResponse = await pushToRemote(
          instance,
          localDeltas.deltas,
          localDeltas.mappings
        );

        entityCounts.pushed = localDeltas.deltas.length;
        allConflicts.push(...pushResponse.conflicts);
        allErrors.push(...pushResponse.errors);

        // Create mappings for new entities
        const now = new Date().toISOString();
        for (const update of pushResponse.mappingUpdates) {
          // Check if mapping already exists
          const existingMapping = await repos.syncMappings.findByLocalId(
            session.user.id,
            id,
            update.entityType,
            update.localId
          );

          if (!existingMapping) {
            await repos.syncMappings.create({
              userId: session.user.id,
              instanceId: id,
              entityType: update.entityType,
              localId: update.localId,
              remoteId: update.remoteId,
              lastSyncedAt: now,
              lastLocalUpdatedAt: now,
              lastRemoteUpdatedAt: now,
            });
          }
        }
      } else {
        entityCounts.pushed = 0;
      }

      logger.info('Sync step 3 complete: Pushed local changes', {
        context: 'api:sync:instances:[id]:sync',
        operationId: operation.id,
        pushedCount: entityCounts.pushed,
      });

      // Step 4: Update sync timestamp
      const now = new Date().toISOString();
      await repos.syncInstances.updateSyncStatus(
        id,
        allErrors.length === 0 ? 'SUCCESS' : 'PARTIAL',
        handshakeResult.versionInfo
          ? {
              schemaVersion: handshakeResult.versionInfo.schemaVersion,
              appVersion: handshakeResult.versionInfo.appVersion,
            }
          : undefined
      );

      // Complete operation
      await completeSyncOperation(
        operation.id,
        allErrors.length === 0,
        entityCounts,
        allConflicts,
        allErrors
      );

      const duration = Date.now() - startTime;

      logger.info('Sync complete', {
        context: 'api:sync:instances:[id]:sync',
        userId: session.user.id,
        instanceId: id,
        operationId: operation.id,
        entityCounts,
        conflictCount: allConflicts.length,
        errorCount: allErrors.length,
        durationMs: duration,
      });

      const result: SyncResult = {
        success: allErrors.length === 0,
        operationId: operation.id,
        direction: 'BIDIRECTIONAL',
        entityCounts,
        conflicts: allConflicts,
        errors: allErrors,
        duration,
      };

      return NextResponse.json(result, { status: 200 });
    } catch (error) {
      // Handle sync errors
      const errorMessage = error instanceof Error ? error.message : String(error);
      allErrors.push(errorMessage);

      await completeSyncOperation(operation.id, false, entityCounts, allConflicts, allErrors);

      // Update instance status to failed
      await repos.syncInstances.updateSyncStatus(id, 'FAILED');

      const duration = Date.now() - startTime;

      logger.error('Sync failed', {
        context: 'api:sync:instances:[id]:sync',
        userId: session.user.id,
        instanceId: id,
        operationId: operation.id,
        error: errorMessage,
        durationMs: duration,
      });

      if (error instanceof RemoteSyncError) {
        return NextResponse.json(
          {
            success: false,
            operationId: operation.id,
            error: errorMessage,
            statusCode: error.statusCode,
          },
          { status: 200 } // Return 200 with success:false for handled errors
        );
      }

      throw error;
    }
  } catch (error) {
    const duration = Date.now() - startTime;

    logger.error('Error during sync', {
      context: 'api:sync:instances:[id]:sync',
      instanceId: id,
      error: error instanceof Error ? error.message : String(error),
      durationMs: duration,
    });

    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
