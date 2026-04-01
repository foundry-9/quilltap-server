/**
 * Sync Instances API v1 - Individual Instance Endpoint
 *
 * GET /api/v1/sync/instances/[id] - Get instance details
 * PUT /api/v1/sync/instances/[id] - Update instance
 * DELETE /api/v1/sync/instances/[id] - Delete instance
 * POST /api/v1/sync/instances/[id]?action=test - Test connection
 * POST /api/v1/sync/instances/[id]?action=sync - Trigger manual sync
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  createAuthenticatedParamsHandler,
  AuthenticatedContext,
} from '@/lib/api/middleware';
import { getActionParam } from '@/lib/api/middleware/actions';
import { encryptApiKey } from '@/lib/encryption';
import { z } from 'zod';
import { logger } from '@/lib/logger';
import {
  notFound,
  badRequest,
  serverError,
  validationError,
  successResponse,
  messageResponse,
} from '@/lib/api/responses';
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
import { fileStorageManager } from '@/lib/file-storage/manager';

// ============================================================================
// Schemas
// ============================================================================

const updateInstanceSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  url: z.string().url().optional(),
  apiKey: z.string().min(1).optional(),
  isActive: z.boolean().optional(),
});

// ============================================================================
// Helper Functions
// ============================================================================

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
    case 'CONNECTION_PROFILE':
      return data.name as string | undefined;
    case 'PROJECT':
      return data.name as string | undefined;
    default:
      return undefined;
  }
}

// ============================================================================
// GET Handler
// ============================================================================

export const GET = createAuthenticatedParamsHandler<{ id: string }>(
  async (req, { user, repos }, { id }) => {
    try {
      logger.debug('[Sync Instance v1] GET', { instanceId: id, userId: user.id });

      const instance = await repos.syncInstances?.findById(id);

      if (!instance || instance.userId !== user.id) {
        return notFound('Sync instance');
      }

      return successResponse({
        instance: {
          id: instance.id,
          name: instance.name,
          url: instance.url,
          isActive: instance.isActive,
          remoteUserId: instance.remoteUserId,
          lastSyncAt: instance.lastSyncAt,
          lastSyncStatus: instance.lastSyncStatus,
          schemaVersion: instance.schemaVersion,
          appVersion: instance.appVersion,
          createdAt: instance.createdAt,
          updatedAt: instance.updatedAt,
        },
      });
    } catch (error) {
      logger.error(
        '[Sync Instance v1] Error getting instance',
        { instanceId: id },
        error instanceof Error ? error : undefined
      );
      return serverError('Failed to fetch sync instance');
    }
  }
);

// ============================================================================
// PUT Handler
// ============================================================================

export const PUT = createAuthenticatedParamsHandler<{ id: string }>(
  async (req, { user, repos }, { id }) => {
    try {
      logger.debug('[Sync Instance v1] PUT', { instanceId: id, userId: user.id });

      const existingInstance = await repos.syncInstances?.findById(id);

      if (!existingInstance || existingInstance.userId !== user.id) {
        return notFound('Sync instance');
      }

      const body = await req.json();
      const validatedData = updateInstanceSchema.parse(body);

      const updateData: any = {};

      if (validatedData.name !== undefined) {
        updateData.name = validatedData.name;
      }

      if (validatedData.url !== undefined) {
        updateData.url = validatedData.url;
      }

      if (validatedData.apiKey !== undefined) {
        const { encrypted, iv, authTag } = encryptApiKey(
          validatedData.apiKey,
          user.id
        );
        updateData.encryptedApiKey = encrypted;
        updateData.apiKeyIv = iv;
        updateData.apiKeyAuthTag = authTag;
      }

      if (validatedData.isActive !== undefined) {
        updateData.isActive = validatedData.isActive;
      }

      const updated = await repos.syncInstances?.update(id, updateData);

      if (!updated) {
        return serverError('Failed to update instance');
      }

      logger.info('[Sync Instance v1] Instance updated', { instanceId: id });

      return successResponse({
        instance: {
          id: updated.id,
          name: updated.name,
          url: updated.url,
          isActive: updated.isActive,
          remoteUserId: updated.remoteUserId,
          lastSyncAt: updated.lastSyncAt,
          lastSyncStatus: updated.lastSyncStatus,
          schemaVersion: updated.schemaVersion,
          appVersion: updated.appVersion,
          createdAt: updated.createdAt,
          updatedAt: updated.updatedAt,
        },
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return validationError(error);
      }

      logger.error(
        '[Sync Instance v1] Error updating instance',
        { instanceId: id },
        error instanceof Error ? error : undefined
      );
      return serverError('Failed to update sync instance');
    }
  }
);

// ============================================================================
// DELETE Handler
// ============================================================================

export const DELETE = createAuthenticatedParamsHandler<{ id: string }>(
  async (req, { user, repos }, { id }) => {
    try {
      logger.debug('[Sync Instance v1] DELETE', {
        instanceId: id,
        userId: user.id,
      });

      const instance = await repos.syncInstances?.findById(id);

      if (!instance || instance.userId !== user.id) {
        return notFound('Sync instance');
      }

      // Delete instance
      await repos.syncInstances?.delete(id);

      // Clean up associated mappings
      const mappingsDeleted = await repos.syncMappings?.deleteByInstanceId(id) || 0;

      logger.info('[Sync Instance v1] Instance deleted', {
        instanceId: id,
        mappingsDeleted,
      });

      return messageResponse('Sync instance deleted successfully');
    } catch (error) {
      logger.error(
        '[Sync Instance v1] Error deleting instance',
        { instanceId: id },
        error instanceof Error ? error : undefined
      );
      return serverError('Failed to delete sync instance');
    }
  }
);

// ============================================================================
// POST Handler - Actions
// ============================================================================

/**
 * Test connection to the remote instance and verify compatibility.
 */
async function handleTest(
  _req: NextRequest,
  context: AuthenticatedContext,
  instanceId: string
) {
  const startTime = Date.now();

  try {
    const { repos, user } = context;

    logger.info('[Sync Instance v1] Testing connection', { instanceId });

    const instance = await repos.syncInstances?.findById(instanceId);

    if (!instance || instance.userId !== user.id) {
      return notFound('Sync instance');
    }

    // Perform handshake to test connection
    try {
      const handshakeResult = await remoteHandshake(instance);

      // Update instance with remote version info
      if (handshakeResult.versionInfo) {
        await repos.syncInstances?.update(instanceId, {
          schemaVersion: handshakeResult.versionInfo.schemaVersion,
          appVersion: handshakeResult.versionInfo.appVersion,
          remoteUserId: handshakeResult.remoteUserId,
        });
      }

      const duration = Date.now() - startTime;

      logger.info('[Sync Instance v1] Connection test complete', {
        instanceId,
        compatible: handshakeResult.compatible,
        durationMs: duration,
      });

      return successResponse({
        success: true,
        compatible: handshakeResult.compatible,
        reason: handshakeResult.reason,
        remoteVersion: handshakeResult.versionInfo,
      });
    } catch (error) {
      const duration = Date.now() - startTime;

      if (error instanceof RemoteSyncError) {
        logger.warn('[Sync Instance v1] Connection test failed', {
          instanceId,
          error: error.message,
          statusCode: error.statusCode,
          durationMs: duration,
        });

        return successResponse({
          success: false,
          error: error.message,
          statusCode: error.statusCode,
        });
      }

      throw error;
    }
  } catch (error) {
    const duration = Date.now() - startTime;

    logger.error(
      '[Sync Instance v1] Error testing connection',
      { instanceId, durationMs: duration },
      error instanceof Error ? error : undefined
    );
    return serverError('Connection test failed');
  }
}

/**
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
async function handleSync(
  req: NextRequest,
  context: AuthenticatedContext,
  instanceId: string
) {
  const startTime = Date.now();
  const forceFull = req.nextUrl.searchParams.get('forceFull') === 'true';
  const directionParam = req.nextUrl.searchParams.get('direction') || 'BIDIRECTIONAL';
  const direction: SyncDirection = ['PUSH', 'PULL', 'BIDIRECTIONAL'].includes(directionParam)
    ? (directionParam as SyncDirection)
    : 'BIDIRECTIONAL';

  try {
    const { repos, user } = context;

    logger.info('[Sync Instance v1] Starting manual sync', {
      instanceId,
      userId: user.id,
      forceFull,
      direction,
    });

    const instance = await repos.syncInstances?.findById(instanceId);

    if (!instance) {
      logger.warn('[Sync Instance v1] Instance not found', { instanceId, userId: user.id });
      return notFound('Sync instance');
    }

    // Verify ownership
    if (instance.userId !== user.id) {
      logger.warn('[Sync Instance v1] Sync denied - not owner', {
        instanceId,
        userId: user.id,
        ownerId: instance.userId,
      });
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Check if instance is active
    if (!instance.isActive) {
      logger.warn('[Sync Instance v1] Sync requested for inactive instance', {
        instanceId,
        userId: user.id,
      });
      return badRequest('Instance is not active');
    }

    // Check for existing in-progress sync
    const inProgressOps = await repos.syncOperations?.findInProgress(user.id);
    const hasInProgress = inProgressOps?.some((op) => op.instanceId === instanceId);
    if (hasInProgress) {
      logger.warn('[Sync Instance v1] Sync already in progress', { instanceId, userId: user.id });
      return NextResponse.json({ error: 'Sync already in progress' }, { status: 409 });
    }

    // Start sync operation tracking
    const operation = await startSyncOperation(user.id, instanceId, direction);

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
      logger.info('[Sync Instance v1] Step 1: Handshake', { operationId: operation.id });

      const handshakeResult = await remoteHandshake(instance);

      if (!handshakeResult.compatible) {
        throw new RemoteSyncError(
          `Version incompatible: ${handshakeResult.reason}`,
          400
        );
      }

      // Update instance with remote version info
      if (handshakeResult.versionInfo) {
        await repos.syncInstances?.update(instanceId, {
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

        logger.info('[Sync Instance v1] Step 2: Pull remote changes', {
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
              user.id,
              instanceId,
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

        logger.info('[Sync Instance v1] Step 2 complete: Pulled remote changes', {
          operationId: operation.id,
          pulledCount: pullTotal,
          filesNeedingContent: allFilesNeedingContent.length,
        });
      } else {
        logger.info('[Sync Instance v1] Step 2: Skipped pull (PUSH-only mode)', {
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

        logger.info('[Sync Instance v1] Step 2.5: Fetching file content for large files', {
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
            const localFile = await repos.files?.findById(fileInfo.fileId);
            if (localFile) {
              // Upload content to local storage
              const uploadResult = await fileStorageManager.uploadFile({
                userId: localFile.userId,
                fileId: localFile.id,
                filename: localFile.originalFilename,
                content,
                contentType: mimeType || localFile.mimeType || 'application/octet-stream',
                projectId: localFile.projectId || null,
                folderPath: localFile.folderPath || '/',
              });

              // Update file entry with storage key and mount point ID
              await repos.files?.update(localFile.id, {
                storageKey: uploadResult.storageKey,
                mountPointId: uploadResult.mountPointId,
              });

              filesFetched++;
              logger.debug('[Sync Instance v1] Fetched and stored file content', {
                operationId: operation.id,
                fileId: fileInfo.fileId,
                size: content.length,
              });
            }
          } catch (error) {
            const errorMessage = `Failed to fetch file content ${fileInfo.fileId}: ${error instanceof Error ? error.message : String(error)}`;
            allErrors.push(errorMessage);
            logger.warn('[Sync Instance v1] Failed to fetch file content', {
              operationId: operation.id,
              fileId: fileInfo.fileId,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }

        logger.info('[Sync Instance v1] Step 2.5 complete: Fetched file content', {
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

        logger.info('[Sync Instance v1] Step 3: Push local changes', {
          operationId: operation.id,
          forceFull,
          pushSinceTimestamp,
        });

        const localDeltas = await prepareLocalDeltasForPush(user.id, instanceId, pushSinceTimestamp);

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

            logger.debug('[Sync Instance v1] Pushing batch to remote', {
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
              logger.warn('[Sync Instance v1] Stopping push due to errors in batch', {
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

        logger.info('[Sync Instance v1] Step 3 complete: Pushed local changes', {
          operationId: operation.id,
          pushedCount: entityCounts.pushed,
        });
      } else {
        entityCounts.pushed = 0;
        logger.info('[Sync Instance v1] Step 3: Skipped push (PULL-only mode)', {
          operationId: operation.id,
        });
      }

      // Step 4: Update sync timestamp
      await repos.syncInstances?.updateSyncStatus(
        instanceId,
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

      logger.info('[Sync Instance v1] Sync complete', {
        instanceId,
        userId: user.id,
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
      await repos.syncInstances?.updateSyncStatus(instanceId, 'FAILED');

      const duration = Date.now() - startTime;

      logger.error('[Sync Instance v1] Sync failed', {
        instanceId,
        userId: user.id,
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

    logger.error(
      '[Sync Instance v1] Error during sync',
      { instanceId, durationMs: duration },
      error instanceof Error ? error : undefined
    );

    return serverError('Internal server error');
  }
}

export const POST = createAuthenticatedParamsHandler<{ id: string }>(
  async (req, context, { id }) => {
    const action = getActionParam(req);

    switch (action) {
      case 'test':
        return handleTest(req, context, id);
      case 'sync':
        return handleSync(req, context, id);
      default:
        return badRequest(
          `Unknown action: ${action}. Available actions: test, sync`
        );
    }
  }
);
