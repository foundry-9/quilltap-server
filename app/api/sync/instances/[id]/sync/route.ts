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
import { SyncConflict, SyncResult } from '@/lib/sync/types';
import { s3FileService } from '@/lib/s3/file-service';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/sync/instances/[id]/sync
 *
 * Perform a full bidirectional sync with the remote instance.
 *
 * Query parameters:
 * - forceFull: If "true", ignores lastSyncAt and pulls ALL data from remote.
 *              Useful after local data deletion to restore from remote.
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
  const forceFull = req.nextUrl.searchParams.get('forceFull') === 'true';

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
      // If forceFull is true, we ignore lastSyncAt and pull everything
      const lastSyncAt = forceFull ? null : (instance.lastSyncAt ?? null);

      logger.info('Sync step 2: Pull remote changes', {
        context: 'api:sync:instances:[id]:sync',
        operationId: operation.id,
        forceFull,
        lastSyncAt,
      });

      let pullTotal = 0;
      let hasMore = true;
      let cursor: string | null = lastSyncAt;
      const allFilesNeedingContent: FileNeedingContent[] = [];

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
          allFilesNeedingContent.push(...pullResult.filesNeedingContent);
        }

        hasMore = deltaResponse.hasMore;
        cursor = deltaResponse.nextCursor || null;
      }

      entityCounts.pulled = pullTotal;

      logger.info('Sync step 2 complete: Pulled remote changes', {
        context: 'api:sync:instances:[id]:sync',
        operationId: operation.id,
        pulledCount: pullTotal,
        filesNeedingContent: allFilesNeedingContent.length,
      });

      // Step 2.5: Fetch content for large files
      if (allFilesNeedingContent.length > 0) {
        logger.info('Sync step 2.5: Fetching file content for large files', {
          context: 'api:sync:instances:[id]:sync',
          operationId: operation.id,
          fileCount: allFilesNeedingContent.length,
        });

        let filesFetched = 0;
        for (const fileInfo of allFilesNeedingContent) {
          try {
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

        entityCounts.filesFetched = filesFetched;
        logger.info('Sync step 2.5 complete: Fetched file content', {
          context: 'api:sync:instances:[id]:sync',
          operationId: operation.id,
          filesFetched,
          filesFailed: allFilesNeedingContent.length - filesFetched,
        });
      }

      // Step 3: Push - Send local changes
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
            direction: 'BIDIRECTIONAL',
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
