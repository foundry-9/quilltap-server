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
  SyncInstance,
  SyncMapping,
  SyncOperation,
  SyncEntityDelta,
  SyncConflict,
  SyncableEntityType,
  SyncResult,
  SyncDeltaResponse,
  SyncPushResponse,
  CreateSyncMapping,
} from './types';
import { checkVersionCompatibility, getLocalVersionInfo } from './version-checker';
import { resolveConflictWithRecord, needsSync } from './conflict-resolver';
import { detectDeltas } from './delta-detector';

/**
 * Apply a remote delta to the local database.
 * Creates or updates the entity based on conflict resolution.
 */
export async function applyRemoteDelta(
  userId: string,
  instanceId: string,
  delta: SyncEntityDelta,
  existingMapping: SyncMapping | null
): Promise<{
  success: boolean;
  conflict?: SyncConflict;
  newMapping?: CreateSyncMapping;
  error?: string;
}> {
  const repos = getRepositories();

  logger.debug('Applying remote delta', {
    context: 'sync:sync-service',
    userId,
    instanceId,
    entityType: delta.entityType,
    remoteId: delta.id,
    hasMapping: !!existingMapping,
  });

  try {
    if (delta.isDeleted) {
      // Handle deleted entity
      if (existingMapping) {
        // Delete the local entity
        await deleteLocalEntity(delta.entityType, existingMapping.localId);
        // Remove the mapping
        await repos.syncMappings.deleteByLocalId(
          userId,
          instanceId,
          delta.entityType,
          existingMapping.localId
        );

        logger.info('Applied remote deletion', {
          context: 'sync:sync-service',
          entityType: delta.entityType,
          localId: existingMapping.localId,
          remoteId: delta.id,
        });
      }
      return { success: true };
    }

    if (!delta.data) {
      logger.warn('Delta has no data and is not deleted', {
        context: 'sync:sync-service',
        entityType: delta.entityType,
        remoteId: delta.id,
      });
      return { success: false, error: 'Delta has no data' };
    }

    if (!existingMapping) {
      // New entity from remote - create locally with new UUID
      const localEntity = await createLocalEntity(userId, delta.entityType, delta.data);

      if (!localEntity) {
        return { success: false, error: 'Failed to create local entity' };
      }

      const now = new Date().toISOString();
      const newMapping: CreateSyncMapping = {
        userId,
        instanceId,
        entityType: delta.entityType,
        localId: localEntity.id,
        remoteId: delta.id,
        lastSyncedAt: now,
        lastLocalUpdatedAt: localEntity.updatedAt,
        lastRemoteUpdatedAt: delta.updatedAt,
      };

      logger.info('Created new local entity from remote', {
        context: 'sync:sync-service',
        entityType: delta.entityType,
        localId: localEntity.id,
        remoteId: delta.id,
      });

      return { success: true, newMapping };
    }

    // Existing entity - check for conflict
    const localEntity = await getLocalEntity(delta.entityType, existingMapping.localId);

    if (!localEntity) {
      // Deleted locally but exists remotely - recreate
      const newEntity = await createLocalEntity(userId, delta.entityType, delta.data);

      if (!newEntity) {
        return { success: false, error: 'Failed to recreate local entity' };
      }

      // Update mapping with new local ID
      await repos.syncMappings.update(existingMapping.id, {
        localId: newEntity.id,
        lastLocalUpdatedAt: newEntity.updatedAt,
        lastRemoteUpdatedAt: delta.updatedAt,
        lastSyncedAt: new Date().toISOString(),
      });

      logger.info('Recreated local entity from remote', {
        context: 'sync:sync-service',
        entityType: delta.entityType,
        localId: newEntity.id,
        remoteId: delta.id,
      });

      return { success: true };
    }

    // Both exist - resolve conflict
    const { resolution, conflict } = resolveConflictWithRecord(
      delta.entityType,
      { id: localEntity.id, updatedAt: localEntity.updatedAt },
      delta.id,
      delta.updatedAt
    );

    if (resolution === 'REMOTE_WINS') {
      // Update local entity with remote data
      await updateLocalEntity(delta.entityType, existingMapping.localId, delta.data);

      logger.info('Updated local entity from remote (REMOTE_WINS)', {
        context: 'sync:sync-service',
        entityType: delta.entityType,
        localId: existingMapping.localId,
        remoteId: delta.id,
      });
    } else {
      logger.info('Kept local entity (LOCAL_WINS)', {
        context: 'sync:sync-service',
        entityType: delta.entityType,
        localId: existingMapping.localId,
        remoteId: delta.id,
      });
    }

    // Update mapping timestamps
    await repos.syncMappings.updateSyncTimestamps(
      existingMapping.id,
      localEntity.updatedAt,
      delta.updatedAt
    );

    return { success: true, conflict };
  } catch (error) {
    logger.error('Error applying remote delta', {
      context: 'sync:sync-service',
      entityType: delta.entityType,
      remoteId: delta.id,
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
    case 'CHARACTER':
      return repos.characters.findById(id);
    case 'PERSONA':
      return repos.personas.findById(id);
    case 'CHAT':
      return repos.chats.findById(id);
    case 'MEMORY':
      return repos.memories.findById(id);
    case 'TAG':
      return repos.tags.findById(id);
    case 'ROLEPLAY_TEMPLATE':
      return repos.roleplayTemplates.findById(id);
    case 'PROMPT_TEMPLATE':
      return repos.promptTemplates.findById(id);
    default:
      return null;
  }
}

/**
 * Create a local entity from remote data
 */
async function createLocalEntity(
  userId: string,
  entityType: SyncableEntityType,
  data: Record<string, unknown>
): Promise<{ id: string; updatedAt: string } | null> {
  const repos = getRepositories();

  // Remove fields that will be regenerated
  const { id: _remoteId, createdAt: _createdAt, updatedAt: _updatedAt, ...entityData } = data;

  // Ensure userId is set to local user
  const createData = { ...entityData, userId };

  try {
    switch (entityType) {
      case 'CHARACTER':
        return repos.characters.create(createData as any);
      case 'PERSONA':
        return repos.personas.create(createData as any);
      case 'CHAT':
        return repos.chats.create(createData as any);
      case 'MEMORY':
        return repos.memories.create(createData as any);
      case 'TAG':
        return repos.tags.create(createData as any);
      case 'ROLEPLAY_TEMPLATE':
        return repos.roleplayTemplates.create(createData as any);
      case 'PROMPT_TEMPLATE':
        return repos.promptTemplates.create(createData as any);
      default:
        return null;
    }
  } catch (error) {
    logger.error('Error creating local entity', {
      context: 'sync:sync-service',
      entityType,
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
  const { id: _remoteId, userId: _userId, createdAt: _createdAt, ...updateData } = data;

  try {
    switch (entityType) {
      case 'CHARACTER':
        await repos.characters.update(id, updateData as any);
        return true;
      case 'PERSONA':
        await repos.personas.update(id, updateData as any);
        return true;
      case 'CHAT':
        await repos.chats.update(id, updateData as any);
        return true;
      case 'MEMORY':
        await repos.memories.update(id, updateData as any);
        return true;
      case 'TAG':
        await repos.tags.update(id, updateData as any);
        return true;
      case 'ROLEPLAY_TEMPLATE':
        await repos.roleplayTemplates.update(id, updateData as any);
        return true;
      case 'PROMPT_TEMPLATE':
        await repos.promptTemplates.update(id, updateData as any);
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
      case 'CHARACTER':
        return repos.characters.delete(id);
      case 'PERSONA':
        return repos.personas.delete(id);
      case 'CHAT':
        return repos.chats.delete(id);
      case 'MEMORY':
        return repos.memories.delete(id);
      case 'TAG':
        return repos.tags.delete(id);
      case 'ROLEPLAY_TEMPLATE':
        return repos.roleplayTemplates.delete(id);
      case 'PROMPT_TEMPLATE':
        return repos.promptTemplates.delete(id);
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
 * Process incoming deltas from a remote instance.
 * Applies each delta and tracks conflicts.
 */
export async function processRemoteDeltas(
  userId: string,
  instanceId: string,
  deltas: SyncEntityDelta[]
): Promise<{
  applied: number;
  conflicts: SyncConflict[];
  errors: string[];
  newMappings: CreateSyncMapping[];
}> {
  const repos = getRepositories();
  let applied = 0;
  const conflicts: SyncConflict[] = [];
  const errors: string[] = [];
  const newMappings: CreateSyncMapping[] = [];

  logger.info('Processing remote deltas', {
    context: 'sync:sync-service',
    userId,
    instanceId,
    deltaCount: deltas.length,
  });

  for (const delta of deltas) {
    // Find existing mapping for this remote entity
    const existingMapping = await repos.syncMappings.findByRemoteId(
      userId,
      instanceId,
      delta.entityType,
      delta.id
    );

    const result = await applyRemoteDelta(userId, instanceId, delta, existingMapping);

    if (result.success) {
      applied++;
      if (result.conflict) {
        conflicts.push(result.conflict);
      }
      if (result.newMapping) {
        newMappings.push(result.newMapping);
      }
    } else if (result.error) {
      errors.push(`${delta.entityType}:${delta.id}: ${result.error}`);
    }
  }

  // Create new mappings
  for (const mapping of newMappings) {
    await repos.syncMappings.create(mapping);
  }

  logger.info('Finished processing remote deltas', {
    context: 'sync:sync-service',
    userId,
    instanceId,
    applied,
    conflictCount: conflicts.length,
    errorCount: errors.length,
    newMappingCount: newMappings.length,
  });

  return { applied, conflicts, errors, newMappings };
}

/**
 * Prepare local deltas for pushing to a remote instance.
 * Converts local IDs to remote IDs using mappings.
 */
export async function prepareLocalDeltasForPush(
  userId: string,
  instanceId: string,
  sinceTimestamp: string | null
): Promise<{
  deltas: SyncEntityDelta[];
  mappings: Array<{ localId: string; remoteId?: string; entityType: SyncableEntityType }>;
}> {
  const repos = getRepositories();

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

  const mappings: Array<{ localId: string; remoteId?: string; entityType: SyncableEntityType }> = [];

  // For each delta, check if we have a mapping
  for (const delta of detectionResult.deltas) {
    const existingMapping = await repos.syncMappings.findByLocalId(
      userId,
      instanceId,
      delta.entityType,
      delta.id
    );

    mappings.push({
      localId: delta.id,
      remoteId: existingMapping?.remoteId,
      entityType: delta.entityType,
    });
  }

  logger.info('Prepared local deltas for push', {
    context: 'sync:sync-service',
    userId,
    instanceId,
    deltaCount: detectionResult.deltas.length,
    withMappings: mappings.filter((m) => m.remoteId).length,
    withoutMappings: mappings.filter((m) => !m.remoteId).length,
  });

  return {
    deltas: detectionResult.deltas,
    mappings,
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
 * Get the current local version info for handshake responses.
 */
export { getLocalVersionInfo, checkVersionCompatibility };
