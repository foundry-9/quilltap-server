/**
 * Sync Service
 *
 * Core service for handling synchronization between Quilltap instances.
 * Coordinates version checking, delta detection, conflict resolution,
 * and data transfer for bidirectional sync operations.
 */

import { logger } from '@/lib/logger';
import { getRepositories } from '@/lib/mongodb/repositories';
import {
  SyncOperation,
  SyncEntityDelta,
  SyncConflict,
  SyncableEntityType,
} from './types';
import { checkVersionCompatibility, getLocalVersionInfo } from './version-checker';
import { resolveConflictWithRecord } from './conflict-resolver';
import { detectDeltas } from './delta-detector';
import { s3FileService } from '@/lib/s3/file-service';
import { ChatEvent } from '@/lib/schemas/types';

/**
 * Apply a remote delta to the local database.
 * Uses the remote entity ID directly (no mapping needed).
 * Creates or updates the entity based on whether it exists locally.
 */
export async function applyRemoteDelta(
  userId: string,
  instanceId: string,
  delta: SyncEntityDelta
): Promise<{
  success: boolean;
  conflict?: SyncConflict;
  error?: string;
  isNewEntity?: boolean;
}> {
  logger.debug('Applying remote delta', {
    context: 'sync:sync-service',
    userId,
    instanceId,
    entityType: delta.entityType,
    entityId: delta.id,
  });

  try {
    if (delta.isDeleted) {
      // Handle deleted entity - use the delta.id directly since IDs are the same
      await deleteLocalEntity(delta.entityType, delta.id);

      logger.info('Applied remote deletion', {
        context: 'sync:sync-service',
        entityType: delta.entityType,
        entityId: delta.id,
      });
      return { success: true };
    }

    if (!delta.data) {
      logger.warn('Delta has no data and is not deleted', {
        context: 'sync:sync-service',
        entityType: delta.entityType,
        entityId: delta.id,
      });
      return { success: false, error: 'Delta has no data' };
    }

    // Check if entity already exists locally (same ID)
    const localEntity = await getLocalEntity(delta.entityType, delta.id);

    if (!localEntity) {
      // New entity - create with the remote ID (preserved)
      const createdEntity = await createLocalEntity(
        userId,
        instanceId,
        delta.entityType,
        delta.id,           // Use remote ID as local ID
        delta.createdAt,    // Preserve original createdAt
        delta.data
      );

      if (!createdEntity) {
        return { success: false, error: 'Failed to create local entity' };
      }

      logger.info('Created new local entity from remote', {
        context: 'sync:sync-service',
        entityType: delta.entityType,
        entityId: delta.id,
      });

      return { success: true, isNewEntity: true };
    }

    // Entity exists - check for conflict using timestamps
    const { resolution, conflict } = resolveConflictWithRecord(
      delta.entityType,
      { id: localEntity.id, updatedAt: localEntity.updatedAt },
      delta.id,
      delta.updatedAt
    );

    if (resolution === 'REMOTE_WINS') {
      // Update local entity with remote data
      await updateLocalEntity(delta.entityType, delta.id, delta.data);

      logger.info('Updated local entity from remote (REMOTE_WINS)', {
        context: 'sync:sync-service',
        entityType: delta.entityType,
        entityId: delta.id,
      });
    } else {
      logger.info('Kept local entity (LOCAL_WINS)', {
        context: 'sync:sync-service',
        entityType: delta.entityType,
        entityId: delta.id,
      });
    }

    return { success: true, conflict };
  } catch (error) {
    logger.error('Error applying remote delta', {
      context: 'sync:sync-service',
      entityType: delta.entityType,
      entityId: delta.id,
      error: error instanceof Error ? error.message : String(error),
    });
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Get a local entity by type and ID
 */
async function getLocalEntity(
  entityType: SyncableEntityType,
  id: string
): Promise<{ id: string; updatedAt: string } | null> {
  const repos = getRepositories();

  switch (entityType) {
    case 'TAG':
      return repos.tags.findById(id);
    case 'FILE':
      return repos.files.findById(id);
    case 'PROJECT':
      return repos.projects.findById(id);
    case 'CONNECTION_PROFILE':
      return repos.connections.findById(id);
    case 'PERSONA':
      return repos.personas.findById(id);
    case 'CHARACTER':
      return repos.characters.findById(id);
    case 'ROLEPLAY_TEMPLATE':
      return repos.roleplayTemplates.findById(id);
    case 'PROMPT_TEMPLATE':
      return repos.promptTemplates.findById(id);
    case 'CHAT':
      return repos.chats.findById(id);
    case 'MEMORY':
      return repos.memories.findById(id);
    default:
      return null;
  }
}

/**
 * Create a local entity from remote data.
 * Uses the original remote ID and createdAt to maintain consistency across instances.
 */
async function createLocalEntity(
  userId: string,
  instanceId: string,
  entityType: SyncableEntityType,
  entityId: string,        // Original ID from remote - use this as local ID
  entityCreatedAt: string, // Original createdAt from remote - preserve it
  data: Record<string, unknown>
): Promise<{ id: string; updatedAt: string } | null> {
  const repos = getRepositories();

  // Remove timestamp fields from data (we'll provide them via CreateOptions)
  const {
    id: _remoteId,
    createdAt: _createdAt,
    updatedAt: _updatedAt,
    // Extract special fields that need separate handling
    messages: messagesData,
    ...restData
  } = data;

  // Only extract file-specific fields for FILE entities
  // For other entities like MEMORY, 'content' is a required field and must be preserved
  const fileContent = entityType === 'FILE' ? (restData.content as string | undefined) : undefined;
  const requiresContentFetch = entityType === 'FILE' ? restData.requiresContentFetch : undefined;

  // Remove file-specific fields only for FILE type
  const entityData = entityType === 'FILE'
    ? (() => { const { content: _, requiresContentFetch: __, ...rest } = restData; return rest; })()
    : restData;

  // Ensure userId is set to local user
  const createData = { ...entityData, userId };

  // CreateOptions to preserve original ID and createdAt
  const createOptions = { id: entityId, createdAt: entityCreatedAt };

  try {
    switch (entityType) {
      case 'TAG':
        return repos.tags.createOrUpdate(entityId, createData as any, { createdAt: entityCreatedAt });

      case 'FILE': {
        // Create or update file entry in database
        const fileEntry = await repos.files.createOrUpdate(entityId, createData as any, { createdAt: entityCreatedAt });

        // If file content was provided inline (base64), save it to storage
        if (fileContent && typeof fileContent === 'string') {
          const buffer = Buffer.from(fileContent, 'base64');
          const originalFilename = (createData as any).originalFilename || 'synced-file';
          const category = (createData as any).category || 'ATTACHMENT';
          const mimeType = (createData as any).mimeType || 'application/octet-stream';

          await s3FileService.uploadUserFile(
            userId,
            fileEntry.id,
            originalFilename,
            category,
            buffer,
            mimeType
          );

          // Update file entry with S3 key
          const s3Key = s3FileService.generateS3Key(userId, fileEntry.id, originalFilename, category);
          await repos.files.update(fileEntry.id, { s3Key });

          logger.debug('Saved file content from sync', {
            context: 'sync:sync-service',
            fileId: fileEntry.id,
            size: buffer.length,
          });
        } else if (requiresContentFetch) {
          logger.info('File requires separate content fetch', {
            context: 'sync:sync-service',
            fileId: fileEntry.id,
            instanceId,
          });
          // Content will be fetched separately via the file content endpoint
        }

        return fileEntry;
      }

      case 'PROJECT':
        return repos.projects.createOrUpdate(entityId, createData as any, { createdAt: entityCreatedAt });

      case 'CONNECTION_PROFILE': {
        // Remove _apiKeyLabel from data (it's for user reference only, not stored)
        // Set apiKeyId to null - user must configure API key locally
        const { _apiKeyLabel, ...profileData } = createData as Record<string, unknown>;
        return repos.connections.createOrUpdate(
          entityId,
          { ...profileData, apiKeyId: null } as any,
          { createdAt: entityCreatedAt }
        );
      }

      case 'PERSONA':
        return repos.personas.createOrUpdate(entityId, createData as any, { createdAt: entityCreatedAt });

      case 'CHARACTER':
        return repos.characters.createOrUpdate(entityId, createData as any, { createdAt: entityCreatedAt });

      case 'ROLEPLAY_TEMPLATE':
        return repos.roleplayTemplates.createOrUpdate(entityId, createData as any, { createdAt: entityCreatedAt });

      case 'PROMPT_TEMPLATE':
        return repos.promptTemplates.createOrUpdate(entityId, createData as any, { createdAt: entityCreatedAt });

      case 'CHAT': {
        // Create or update chat metadata
        const chatEntry = await repos.chats.createOrUpdate(entityId, createData as any, { createdAt: entityCreatedAt });

        // Add messages if provided
        if (Array.isArray(messagesData) && messagesData.length > 0) {
          await repos.chats.addMessages(chatEntry.id, messagesData as ChatEvent[]);
          logger.debug('Added chat messages from sync', {
            context: 'sync:sync-service',
            chatId: chatEntry.id,
            messageCount: messagesData.length,
          });
        }

        return chatEntry;
      }

      case 'MEMORY':
        return repos.memories.createOrUpdate(entityId, createData as any, { createdAt: entityCreatedAt });

      default:
        return null;
    }
  } catch (error) {
    logger.error('Error creating local entity', {
      context: 'sync:sync-service',
      entityType,
      entityId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * Update a local entity with remote data
 */
async function updateLocalEntity(
  entityType: SyncableEntityType,
  id: string,
  data: Record<string, unknown>
): Promise<boolean> {
  const repos = getRepositories();

  // Remove fields that shouldn't be overwritten
  const {
    id: _remoteId,
    userId: _userId,
    createdAt: _createdAt,
    // Extract special fields that need separate handling
    messages: messagesData,
    ...restData
  } = data;

  // Only extract file-specific fields for FILE entities
  // For other entities like MEMORY, 'content' is a required field and must be preserved
  const fileContent = entityType === 'FILE' ? (restData.content as string | undefined) : undefined;

  // Remove file-specific fields only for FILE type
  const updateData = entityType === 'FILE'
    ? (() => { const { content: _, requiresContentFetch: __, ...rest } = restData; return rest; })()
    : restData;

  try {
    switch (entityType) {
      case 'TAG':
        await repos.tags.update(id, updateData as any);
        return true;

      case 'FILE': {
        // Get existing file to know storage details
        const existingFile = await repos.files.findById(id);

        // Update file metadata
        await repos.files.update(id, updateData as any);

        // If new content was provided inline, update storage
        if (fileContent && typeof fileContent === 'string' && existingFile) {
          const buffer = Buffer.from(fileContent, 'base64');
          const originalFilename = (updateData as any).originalFilename || existingFile.originalFilename;
          const category = (updateData as any).category || existingFile.category;
          const mimeType = (updateData as any).mimeType || existingFile.mimeType;

          await s3FileService.uploadUserFile(
            existingFile.userId,
            id,
            originalFilename,
            category,
            buffer,
            mimeType
          );

          logger.debug('Updated file content from sync', {
            context: 'sync:sync-service',
            fileId: id,
            size: buffer.length,
          });
        }
        return true;
      }

      case 'PROJECT':
        await repos.projects.update(id, updateData as any);
        return true;

      case 'CONNECTION_PROFILE': {
        // Remove _apiKeyLabel (not stored) and apiKeyId (preserve local API key config)
        const { _apiKeyLabel, apiKeyId, ...profileData } = updateData as Record<string, unknown>;
        await repos.connections.update(id, profileData as any);
        return true;
      }

      case 'PERSONA':
        await repos.personas.update(id, updateData as any);
        return true;

      case 'CHARACTER':
        await repos.characters.update(id, updateData as any);
        return true;

      case 'ROLEPLAY_TEMPLATE':
        await repos.roleplayTemplates.update(id, updateData as any);
        return true;

      case 'PROMPT_TEMPLATE':
        await repos.promptTemplates.update(id, updateData as any);
        return true;

      case 'CHAT': {
        // Update chat metadata
        await repos.chats.update(id, updateData as any);

        // If messages were provided, replace them (clear and add)
        if (Array.isArray(messagesData)) {
          await repos.chats.clearMessages(id);
          if (messagesData.length > 0) {
            await repos.chats.addMessages(id, messagesData as ChatEvent[]);
          }
          logger.debug('Replaced chat messages from sync', {
            context: 'sync:sync-service',
            chatId: id,
            messageCount: messagesData.length,
          });
        }
        return true;
      }

      case 'MEMORY':
        await repos.memories.update(id, updateData as any);
        return true;

      default:
        return false;
    }
  } catch (error) {
    logger.error('Error updating local entity', {
      context: 'sync:sync-service',
      entityType,
      id,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

/**
 * Delete a local entity
 */
async function deleteLocalEntity(entityType: SyncableEntityType, id: string): Promise<boolean> {
  const repos = getRepositories();

  try {
    switch (entityType) {
      case 'TAG':
        return repos.tags.delete(id);

      case 'FILE': {
        // Get file info to delete from storage
        const file = await repos.files.findById(id);
        if (file && file.s3Key) {
          try {
            await s3FileService.deleteByS3Key(file.s3Key);
          } catch (storageError) {
            logger.warn('Failed to delete file from storage during sync', {
              context: 'sync:sync-service',
              fileId: id,
              s3Key: file.s3Key,
              error: storageError instanceof Error ? storageError.message : String(storageError),
            });
            // Continue with database deletion even if storage deletion fails
          }
        }
        return repos.files.delete(id);
      }

      case 'PROJECT':
        return repos.projects.delete(id);

      case 'CONNECTION_PROFILE':
        return repos.connections.delete(id);

      case 'PERSONA':
        return repos.personas.delete(id);

      case 'CHARACTER':
        return repos.characters.delete(id);

      case 'ROLEPLAY_TEMPLATE':
        return repos.roleplayTemplates.delete(id);

      case 'PROMPT_TEMPLATE':
        return repos.promptTemplates.delete(id);

      case 'CHAT':
        return repos.chats.delete(id);

      case 'MEMORY':
        return repos.memories.delete(id);

      default:
        return false;
    }
  } catch (error) {
    logger.error('Error deleting local entity', {
      context: 'sync:sync-service',
      entityType,
      id,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

/**
 * Information about a file that needs content fetched separately.
 * Note: With the new ID-preservation approach, remoteId === localId (same entity ID).
 */
export interface FileNeedingContent {
  /** The file entity ID (same on both sides now) */
  fileId: string;
  /** Original filename for progress display */
  originalFilename?: string;
}

/**
 * Process incoming deltas from a remote instance.
 * Uses the original entity IDs directly (no mapping needed).
 */
export async function processRemoteDeltas(
  userId: string,
  instanceId: string,
  deltas: SyncEntityDelta[]
): Promise<{
  applied: number;
  conflicts: SyncConflict[];
  errors: string[];
  filesNeedingContent: FileNeedingContent[];
}> {
  let applied = 0;
  const conflicts: SyncConflict[] = [];
  const errors: string[] = [];
  const filesNeedingContent: FileNeedingContent[] = [];

  logger.info('Processing remote deltas', {
    context: 'sync:sync-service',
    userId,
    instanceId,
    deltaCount: deltas.length,
  });

  for (const delta of deltas) {
    const result = await applyRemoteDelta(userId, instanceId, delta);

    if (result.success) {
      applied++;
      if (result.conflict) {
        conflicts.push(result.conflict);
      }

      // Track FILE deltas that need content fetched
      // We need to fetch content for:
      // 1. New files that require content fetch
      // 2. Existing files that require content fetch (in case previous fetch failed)
      if (
        delta.entityType === 'FILE' &&
        delta.data?.requiresContentFetch === true
      ) {
        // Check if the local file has content (s3Key) already
        const repos = getRepositories();
        const localFile = await repos.files.findById(delta.id);
        if (!localFile?.s3Key) {
          filesNeedingContent.push({
            fileId: delta.id,
            originalFilename: (delta.data?.originalFilename as string) || localFile?.originalFilename,
          });
          logger.debug('File needs content fetch', {
            context: 'sync:sync-service',
            fileId: delta.id,
            isNewEntity: result.isNewEntity,
            hasS3Key: !!localFile?.s3Key,
          });
        }
      }
    } else if (result.error) {
      errors.push(`${delta.entityType}:${delta.id}: ${result.error}`);
    }
  }

  logger.info('Finished processing remote deltas', {
    context: 'sync:sync-service',
    userId,
    instanceId,
    applied,
    conflictCount: conflicts.length,
    errorCount: errors.length,
    filesNeedingContent: filesNeedingContent.length,
  });

  return { applied, conflicts, errors, filesNeedingContent };
}

/**
 * Prepare local deltas for pushing to a remote instance.
 * With ID preservation, no mapping is needed - IDs are the same everywhere.
 */
export async function prepareLocalDeltasForPush(
  userId: string,
  instanceId: string,
  sinceTimestamp: string | null
): Promise<{
  deltas: SyncEntityDelta[];
}> {
  logger.info('Preparing local deltas for push', {
    context: 'sync:sync-service',
    userId,
    instanceId,
    sinceTimestamp,
  });

  // Detect local changes
  const detectionResult = await detectDeltas({
    userId,
    sinceTimestamp,
    limit: 1000, // Reasonable batch size
  });

  logger.info('Prepared local deltas for push', {
    context: 'sync:sync-service',
    userId,
    instanceId,
    deltaCount: detectionResult.deltas.length,
  });

  return {
    deltas: detectionResult.deltas,
  };
}

/**
 * Start a new sync operation and return the operation record.
 */
export async function startSyncOperation(
  userId: string,
  instanceId: string,
  direction: 'PUSH' | 'PULL' | 'BIDIRECTIONAL'
): Promise<SyncOperation> {
  const repos = getRepositories();
  const now = new Date().toISOString();

  const operation = await repos.syncOperations.create({
    userId,
    instanceId,
    direction,
    status: 'IN_PROGRESS',
    entityCounts: {},
    conflicts: [],
    errors: [],
    startedAt: now,
  });

  logger.info('Started sync operation', {
    context: 'sync:sync-service',
    operationId: operation.id,
    userId,
    instanceId,
    direction,
  });

  return operation;
}

/**
 * Complete a sync operation with results.
 */
export async function completeSyncOperation(
  operationId: string,
  success: boolean,
  entityCounts: Record<string, number>,
  conflicts: SyncConflict[],
  errors: string[]
): Promise<SyncOperation | null> {
  const repos = getRepositories();

  const operation = await repos.syncOperations.complete(
    operationId,
    success ? 'COMPLETED' : 'FAILED',
    entityCounts,
    conflicts,
    errors
  );

  logger.info('Completed sync operation', {
    context: 'sync:sync-service',
    operationId,
    success,
    entityCounts,
    conflictCount: conflicts.length,
    errorCount: errors.length,
  });

  return operation;
}

/**
 * Clean sync state data for a user.
 * This removes old sync mappings and operations, and resets instance sync timestamps.
 * Use this after migrating to ID-preservation sync or when sync state becomes corrupted.
 * After calling this, user should do a Force Full Sync to re-establish data.
 */
export async function cleanSyncData(userId: string): Promise<{
  mappingsDeleted: number;
  operationsDeleted: number;
  instancesReset: number;
}> {
  const repos = getRepositories();

  logger.info('Cleaning sync data for user', {
    context: 'sync:sync-service',
    userId,
  });

  try {
    // Delete all sync mappings for user (deprecated with ID preservation)
    const mappingsResult = await repos.syncMappings.deleteByUserId(userId);
    const mappingsDeleted = mappingsResult || 0;

    // Delete all sync operations for user (historical tracking)
    const operationsResult = await repos.syncOperations.deleteByUserId(userId);
    const operationsDeleted = operationsResult || 0;

    // Reset lastSyncAt on all user's sync instances
    const instances = await repos.syncInstances.findByUserId(userId);
    let instancesReset = 0;
    for (const instance of instances) {
      await repos.syncInstances.update(instance.id, {
        lastSyncAt: null,
        lastSyncStatus: null,
      });
      instancesReset++;
    }

    logger.info('Sync data cleaned', {
      context: 'sync:sync-service',
      userId,
      mappingsDeleted,
      operationsDeleted,
      instancesReset,
    });

    return { mappingsDeleted, operationsDeleted, instancesReset };
  } catch (error) {
    logger.error('Error cleaning sync data', {
      context: 'sync:sync-service',
      userId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Get the current local version info for handshake responses.
 */
export { getLocalVersionInfo, checkVersionCompatibility };
