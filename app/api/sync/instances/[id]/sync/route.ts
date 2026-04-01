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
  fetchRemoteFileContent,
  RemoteSyncError,
} from '@/lib/sync/remote-client';
import {
  processRemoteDeltas,
  prepareLocalDeltasForPush,
  startSyncOperation,
  completeSyncOperation,
  FileNeedingContent,
} from '@/lib/sync/sync-service';
import { SyncConflict, SyncResult, SyncDirection, SyncProgress } from '@/lib/sync/types';
import { s3FileService } from '@/lib/s3/file-service';

/**
 * Helper to update sync progress
 */
async function updateProgress(
  operationId: string,
  progress: SyncProgress
): Promise<void> {
  const repos = getRepositories();
  await repos.syncOperations.updateProgress(operationId, progress);
}

/**
 * Get a display name for an entity based on its type and data
 */
function getEntityDisplayName(
  entityType: string,
  data: Record<string, unknown> | null | undefined
): string | undefined {
  if (!data) return undefined;

  switch (entityType) {
    case 'CHARACTER':
      return data.name as string | undefined;
    case 'PERSONA':
      return data.name as string | undefined;
    case 'CHAT':
      return data.title as string | undefined;
    case 'MEMORY':
      return data.title as string | undefined;
    case 'TAG':
      return data.name as string | undefined;
    case 'FILE':
      return data.originalFilename as string | undefined;
    case 'ROLEPLAY_TEMPLATE':
      return data.name as string | undefined;
    case 'PROMPT_TEMPLATE':
      return data.name as string | undefined;
    default:
      return undefined;
  }
}

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/sync/instances/[id]/sync
 *
 * Perform a sync with the remote instance.
 *
 * Query parameters:
 * - forceFull: If "true", ignores lastSyncAt and syncs ALL data.
 *              Useful after local data deletion to restore from remote.
 * - direction: Sync direction - "BIDIRECTIONAL" (default), "PUSH", or "PULL"
 *
 * Sync algorithm:
 * 1. Handshake - Verify connection and versions
 * 2. Pull - Fetch remote changes and apply locally (if direction allows)
 * 3. Push - Send local changes to remote (if direction allows)
 * 4. Update - Update sync status and timestamps
 */
export async function POST(req: NextRequest, { params }: RouteParams) {
  const startTime = Date.now();
  const { id } = await params;
  const forceFull = req.nextUrl.searchParams.get('forceFull') === 'true';
  const directionParam = req.nextUrl.searchParams.get('direction') || 'BIDIRECTIONAL';
  const direction: SyncDirection = ['PUSH', 'PULL', 'BIDIRECTIONAL'].includes(directionParam)
    ? (directionParam as SyncDirection)
    : 'BIDIRECTIONAL';

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
      forceFull,
      direction,
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
    const operation = await startSyncOperation(session.user.id, id, direction);

    // Update progress: starting
    await updateProgress(operation.id, {
      phase: 'HANDSHAKE',
      message: 'Connecting to remote instance...',
      pulled: 0,
      pushed: 0,
      filesFetched: 0,
    });

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

      // Step 2: Pull - Fetch remote changes (skip if PUSH-only)
      const lastSyncAt = forceFull ? null : (instance.lastSyncAt ?? null);
      let pullTotal = 0;
      const allFilesNeedingContent: FileNeedingContent[] = [];

      if (direction !== 'PUSH') {
        // Update progress: starting pull
        await updateProgress(operation.id, {
          phase: 'PULL',
          message: 'Fetching remote changes...',
          pulled: 0,
          pushed: 0,
          filesFetched: 0,
        });

        logger.info('Sync step 2: Pull remote changes', {
          context: 'api:sync:instances:[id]:sync',
          operationId: operation.id,
          forceFull,
          lastSyncAt,
        });

        let hasMore = true;
        let cursor: string | null = lastSyncAt;

        while (hasMore) {
          const deltaResponse = await fetchRemoteDeltas(instance, cursor, 100);

          if (deltaResponse.deltas.length > 0) {
            // Update progress with current item being processed
            const firstDelta = deltaResponse.deltas[0];
            const itemName = getEntityDisplayName(firstDelta.entityType, firstDelta.data);
            await updateProgress(operation.id, {
              phase: 'PULL',
              currentEntity: firstDelta.entityType,
              currentItemName: itemName,
              message: `Pulling ${firstDelta.entityType.toLowerCase()}s...`,
              pulled: pullTotal,
              pushed: 0,
              filesFetched: 0,
            });

            const pullResult = await processRemoteDeltas(
              session.user.id,
              id,
              deltaResponse.deltas
            );

            pullTotal += pullResult.applied;
            allConflicts.push(...pullResult.conflicts);
            allErrors.push(...pullResult.errors);
            allFilesNeedingContent.push(...pullResult.filesNeedingContent);
          }

          hasMore = deltaResponse.hasMore;
          cursor = deltaResponse.nextCursor || null;
        }

        logger.info('Sync step 2 complete: Pulled remote changes', {
          context: 'api:sync:instances:[id]:sync',
          operationId: operation.id,
          pulledCount: pullTotal,
          filesNeedingContent: allFilesNeedingContent.length,
        });
      } else {
        logger.info('Sync step 2: Skipped pull (PUSH-only mode)', {
          context: 'api:sync:instances:[id]:sync',
          operationId: operation.id,
        });
      }

      entityCounts.pulled = pullTotal;

      // Step 2.5: Fetch content for large files (only if we pulled)
      let filesFetched = 0;
      if (allFilesNeedingContent.length > 0) {
        // Update progress: starting file fetch
        await updateProgress(operation.id, {
          phase: 'FETCH_FILES',
          message: 'Downloading files...',
          pulled: pullTotal,
          pushed: 0,
          filesFetched: 0,
          estimatedTotal: allFilesNeedingContent.length,
        });

        logger.info('Sync step 2.5: Fetching file content for large files', {
          context: 'api:sync:instances:[id]:sync',
          operationId: operation.id,
          fileCount: allFilesNeedingContent.length,
        });

        for (const fileInfo of allFilesNeedingContent) {
          try {
            // Update progress with current file
            await updateProgress(operation.id, {
              phase: 'FETCH_FILES',
              currentEntity: 'FILE',
              currentItemName: fileInfo.originalFilename,
              message: `Downloading: ${fileInfo.originalFilename}`,
              pulled: pullTotal,
              pushed: 0,
              filesFetched,
              estimatedTotal: allFilesNeedingContent.length,
            });

            // With ID preservation, fileId is the same on both sides
            const { content, mimeType } = await fetchRemoteFileContent(instance, fileInfo.fileId);

            // Get the local file entry to know how to store it
            const localFile = await repos.files.findById(fileInfo.fileId);
            if (localFile) {
              // Upload content to local storage
              await s3FileService.uploadUserFile(
                localFile.userId,
                localFile.id,
                localFile.originalFilename,
                localFile.category,
                content,
                mimeType || localFile.mimeType || 'application/octet-stream'
              );

              // Update file entry with S3 key
              const s3Key = s3FileService.generateS3Key(
                localFile.userId,
                localFile.id,
                localFile.originalFilename,
                localFile.category
              );
              await repos.files.update(localFile.id, { s3Key });

              filesFetched++;
              logger.debug('Fetched and stored file content', {
                context: 'api:sync:instances:[id]:sync',
                operationId: operation.id,
                fileId: fileInfo.fileId,
                size: content.length,
              });
            }
          } catch (error) {
            const errorMessage = `Failed to fetch file content ${fileInfo.fileId}: ${error instanceof Error ? error.message : String(error)}`;
            allErrors.push(errorMessage);
            logger.warn('Failed to fetch file content', {
              context: 'api:sync:instances:[id]:sync',
              operationId: operation.id,
              fileId: fileInfo.fileId,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }

        logger.info('Sync step 2.5 complete: Fetched file content', {
          context: 'api:sync:instances:[id]:sync',
          operationId: operation.id,
          filesFetched,
          filesFailed: allFilesNeedingContent.length - filesFetched,
        });
      }

      entityCounts.filesFetched = filesFetched;

      // Step 3: Push - Send local changes (skip if PULL-only)
      if (direction !== 'PULL') {
        // Update progress: starting push
        await updateProgress(operation.id, {
          phase: 'PUSH',
          message: 'Preparing local changes...',
          pulled: pullTotal,
          pushed: 0,
          filesFetched,
        });

        // If forceFull, push all local data regardless of timestamp
        const pushSinceTimestamp = forceFull ? null : lastSyncAt;

        logger.info('Sync step 3: Push local changes', {
          context: 'api:sync:instances:[id]:sync',
          operationId: operation.id,
          forceFull,
          pushSinceTimestamp,
        });

        const localDeltas = await prepareLocalDeltasForPush(session.user.id, id, pushSinceTimestamp);

        if (localDeltas.deltas.length > 0) {
          // Push in batches to avoid body size limits (Next.js default is 1MB)
          const PUSH_BATCH_SIZE = 50;
          let totalPushed = 0;

          for (let i = 0; i < localDeltas.deltas.length; i += PUSH_BATCH_SIZE) {
            const batchDeltas = localDeltas.deltas.slice(i, i + PUSH_BATCH_SIZE);

            // Update progress with current batch info
            const firstDelta = batchDeltas[0];
            const itemName = getEntityDisplayName(firstDelta.entityType, firstDelta.data);
            await updateProgress(operation.id, {
              phase: 'PUSH',
              currentEntity: firstDelta.entityType,
              currentItemName: itemName,
              message: `Pushing ${firstDelta.entityType.toLowerCase()}s...`,
              pulled: pullTotal,
              pushed: totalPushed,
              filesFetched,
              estimatedTotal: localDeltas.deltas.length,
            });

            logger.debug('Pushing batch to remote', {
              context: 'api:sync:instances:[id]:sync',
              operationId: operation.id,
              batchIndex: Math.floor(i / PUSH_BATCH_SIZE) + 1,
              batchSize: batchDeltas.length,
              totalDeltas: localDeltas.deltas.length,
            });

            // With ID preservation, no mappings needed - push deltas directly
            const pushResponse = await pushToRemote(instance, batchDeltas);

            totalPushed += batchDeltas.length;
            allConflicts.push(...pushResponse.conflicts);
            allErrors.push(...pushResponse.errors);

            // Stop if we encountered errors in this batch
            if (allErrors.length > 0) {
              logger.warn('Stopping push due to errors in batch', {
                context: 'api:sync:instances:[id]:sync',
                operationId: operation.id,
                errorCount: allErrors.length,
              });
              break;
            }
          }

          entityCounts.pushed = totalPushed;
        } else {
          entityCounts.pushed = 0;
        }

        logger.info('Sync step 3 complete: Pushed local changes', {
          context: 'api:sync:instances:[id]:sync',
          operationId: operation.id,
          pushedCount: entityCounts.pushed,
        });
      } else {
        entityCounts.pushed = 0;
        logger.info('Sync step 3: Skipped push (PULL-only mode)', {
          context: 'api:sync:instances:[id]:sync',
          operationId: operation.id,
        });
      }

      // Step 4: Update sync timestamp
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

      // Update progress: complete
      await updateProgress(operation.id, {
        phase: 'COMPLETE',
        message: allErrors.length === 0 ? 'Sync complete!' : 'Sync completed with errors',
        pulled: entityCounts.pulled || 0,
        pushed: entityCounts.pushed || 0,
        filesFetched: entityCounts.filesFetched || 0,
      });

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
        forceFull,
        direction,
        entityCounts,
        conflictCount: allConflicts.length,
        errorCount: allErrors.length,
        durationMs: duration,
      });

      const result: SyncResult = {
        success: allErrors.length === 0,
        operationId: operation.id,
        direction,
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

      // Update progress: error
      await updateProgress(operation.id, {
        phase: 'ERROR',
        message: errorMessage,
        pulled: entityCounts.pulled || 0,
        pushed: entityCounts.pushed || 0,
        filesFetched: entityCounts.filesFetched || 0,
      });

      await completeSyncOperation(operation.id, false, entityCounts, allConflicts, allErrors);

      // Update instance status to failed
      await repos.syncInstances.updateSyncStatus(id, 'FAILED');

      const duration = Date.now() - startTime;

      logger.error('Sync failed', {
        context: 'api:sync:instances:[id]:sync',
        userId: session.user.id,
        instanceId: id,
        operationId: operation.id,
        direction,
        error: errorMessage,
        durationMs: duration,
      });

      if (error instanceof RemoteSyncError) {
        return NextResponse.json(
          {
            success: false,
            operationId: operation.id,
            direction,
            entityCounts,
            conflicts: allConflicts,
            errors: allErrors,
            duration,
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
