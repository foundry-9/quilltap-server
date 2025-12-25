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
import { s3FileService } from '@/lib/s3/file-service';
import { ChatEvent } from '@/lib/schemas/types';

/**
 * Helper to look up the local ID for a remote ID using sync mappings.
 * Returns null if no mapping exists (entity not yet synced).
 */
async function lookupLocalId(
  userId: string,
  instanceId: string,
  entityType: SyncableEntityType,
  remoteId: string | null | undefined
): Promise<string | null> {
  if (!remoteId) return null;

  const repos = getRepositories();
  const mapping = await repos.syncMappings.findByRemoteId(userId, instanceId, entityType, remoteId);
  return mapping?.localId ?? null;
}

/**
 * Remap all entity ID references in delta data from remote IDs to local IDs.
 * This is critical for maintaining entity relationships across sync.
 *
 * For each entity type, we identify fields that reference other entities
 * and look up their local IDs via sync mappings.
 */
async function remapEntityReferences(
  userId: string,
  instanceId: string,
  entityType: SyncableEntityType,
  data: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const remapped = { ...data };

  logger.debug('Remapping entity references', {
    context: 'sync:sync-service',
    entityType,
    userId,
    instanceId,
  });

  // Helper to remap an array of IDs
  const remapIdArray = async (
    arr: unknown[] | undefined,
    refType: SyncableEntityType
  ): Promise<string[]> => {
    if (!arr || !Array.isArray(arr)) return [];
    const result: string[] = [];
    for (const id of arr) {
      if (typeof id === 'string') {
        const localId = await lookupLocalId(userId, instanceId, refType, id);
        if (localId) {
          result.push(localId);
        } else {
          logger.debug('No mapping found for referenced ID, skipping', {
            context: 'sync:sync-service',
            refType,
            remoteId: id,
          });
        }
      }
    }
    return result;
  };

  // Helper to remap a single ID
  const remapSingleId = async (
    id: unknown,
    refType: SyncableEntityType
  ): Promise<string | null> => {
    if (typeof id !== 'string') return null;
    const localId = await lookupLocalId(userId, instanceId, refType, id);
    if (!localId) {
      logger.debug('No mapping found for referenced ID, nulling', {
        context: 'sync:sync-service',
        refType,
        remoteId: id,
      });
    }
    return localId;
  };

  switch (entityType) {
    case 'CHARACTER': {
      // Remap tags
      if (Array.isArray(remapped.tags)) {
        remapped.tags = await remapIdArray(remapped.tags as unknown[], 'TAG');
      }
      // Remap personaLinks[].personaId
      if (Array.isArray(remapped.personaLinks)) {
        const personaLinks = remapped.personaLinks as Array<{ personaId?: string; [key: string]: unknown }>;
        remapped.personaLinks = await Promise.all(
          personaLinks.map(async (link) => ({
            ...link,
            personaId: link.personaId
              ? (await remapSingleId(link.personaId, 'PERSONA')) ?? undefined
              : undefined,
          }))
        );
      }
      // Remap defaultImageId
      if (remapped.defaultImageId) {
        remapped.defaultImageId = await remapSingleId(remapped.defaultImageId, 'FILE');
      }
      break;
    }

    case 'PERSONA': {
      // Remap tags
      if (Array.isArray(remapped.tags)) {
        remapped.tags = await remapIdArray(remapped.tags as unknown[], 'TAG');
      }
      break;
    }

    case 'CHAT': {
      // Remap tags
      if (Array.isArray(remapped.tags)) {
        remapped.tags = await remapIdArray(remapped.tags as unknown[], 'TAG');
      }
      // Remap roleplayTemplateId
      if (remapped.roleplayTemplateId) {
        remapped.roleplayTemplateId = await remapSingleId(remapped.roleplayTemplateId, 'ROLEPLAY_TEMPLATE');
      }
      // Remap participants[].characterId and participants[].personaId
      if (Array.isArray(remapped.participants)) {
        const participants = remapped.participants as Array<{
          id?: string;
          type?: string;
          characterId?: string;
          personaId?: string;
          [key: string]: unknown;
        }>;

        // Build a map of old participant IDs to new participant IDs
        // (participants get new IDs when the chat is created locally)
        const oldToNewParticipantId = new Map<string, string>();

        remapped.participants = await Promise.all(
          participants.map(async (participant) => {
            const newParticipant = { ...participant };

            if (participant.type === 'CHARACTER' && participant.characterId) {
              newParticipant.characterId =
                (await remapSingleId(participant.characterId, 'CHARACTER')) ?? undefined;
            }
            if (participant.type === 'PERSONA' && participant.personaId) {
              newParticipant.personaId =
                (await remapSingleId(participant.personaId, 'PERSONA')) ?? undefined;
            }

            // Track participant ID mapping for message remapping
            if (participant.id) {
              const newId = crypto.randomUUID();
              oldToNewParticipantId.set(participant.id, newId);
              newParticipant.id = newId;
            }

            return newParticipant;
          })
        );

        // Store the participant ID mapping for message remapping
        (remapped as any)._participantIdMap = Object.fromEntries(oldToNewParticipantId);
      }

      // Remap messages[].participantId and messages[].attachments[]
      if (Array.isArray(remapped.messages)) {
        const messages = remapped.messages as Array<{
          participantId?: string;
          attachments?: string[];
          [key: string]: unknown;
        }>;
        const participantIdMap = (remapped as any)._participantIdMap as Record<string, string> | undefined;

        remapped.messages = await Promise.all(
          messages.map(async (message) => {
            const newMessage = { ...message };

            // Remap participantId using the participant ID map we built
            if (message.participantId && participantIdMap && participantIdMap[message.participantId]) {
              newMessage.participantId = participantIdMap[message.participantId];
            }

            // Remap attachments (file IDs)
            if (Array.isArray(message.attachments)) {
              newMessage.attachments = await remapIdArray(message.attachments, 'FILE');
            }

            return newMessage;
          })
        );

        // Clean up the temporary mapping
        delete (remapped as any)._participantIdMap;
      }
      break;
    }

    case 'MEMORY': {
      // Remap characterId (required)
      if (remapped.characterId) {
        remapped.characterId = await remapSingleId(remapped.characterId, 'CHARACTER');
      }
      // Remap personaId (optional)
      if (remapped.personaId) {
        remapped.personaId = await remapSingleId(remapped.personaId, 'PERSONA');
      }
      // Remap aboutCharacterId (optional - for inter-character memories)
      if (remapped.aboutCharacterId) {
        remapped.aboutCharacterId = await remapSingleId(remapped.aboutCharacterId, 'CHARACTER');
      }
      // Remap chatId (optional)
      if (remapped.chatId) {
        remapped.chatId = await remapSingleId(remapped.chatId, 'CHAT');
      }
      // Remap tags
      if (Array.isArray(remapped.tags)) {
        remapped.tags = await remapIdArray(remapped.tags as unknown[], 'TAG');
      }
      break;
    }

    case 'FILE': {
      // Remap linkedTo[] (entity IDs this file is linked to)
      if (Array.isArray(remapped.linkedTo)) {
        // linkedTo can reference any entity type, so we need to try each type
        const linkedTo = remapped.linkedTo as string[];
        const remappedLinkedTo: string[] = [];

        for (const id of linkedTo) {
          // Try each entity type until we find a mapping
          let localId: string | null = null;
          for (const type of [
            'CHARACTER',
            'PERSONA',
            'CHAT',
            'MEMORY',
          ] as SyncableEntityType[]) {
            localId = await lookupLocalId(userId, instanceId, type, id);
            if (localId) break;
          }
          if (localId) {
            remappedLinkedTo.push(localId);
          } else {
            logger.debug('No mapping found for linkedTo ID, skipping', {
              context: 'sync:sync-service',
              remoteId: id,
            });
          }
        }
        remapped.linkedTo = remappedLinkedTo;
      }
      // Remap tags
      if (Array.isArray(remapped.tags)) {
        remapped.tags = await remapIdArray(remapped.tags as unknown[], 'TAG');
      }
      break;
    }

    case 'ROLEPLAY_TEMPLATE':
    case 'PROMPT_TEMPLATE': {
      // Remap tags
      if (Array.isArray(remapped.tags)) {
        remapped.tags = await remapIdArray(remapped.tags as unknown[], 'TAG');
      }
      break;
    }

    case 'TAG':
      // Tags don't reference other entities
      break;
  }

  logger.debug('Completed remapping entity references', {
    context: 'sync:sync-service',
    entityType,
  });

  return remapped;
}

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
      // Remap entity references from remote IDs to local IDs
      const remappedData = await remapEntityReferences(userId, instanceId, delta.entityType, delta.data);

      // New entity from remote - create locally with new UUID
      const localEntity = await createLocalEntity(userId, instanceId, delta.entityType, remappedData);

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
      // Remap entity references from remote IDs to local IDs
      const remappedData = await remapEntityReferences(userId, instanceId, delta.entityType, delta.data);
      const newEntity = await createLocalEntity(userId, instanceId, delta.entityType, remappedData);

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
      // Remap entity references from remote IDs to local IDs
      const remappedData = await remapEntityReferences(userId, instanceId, delta.entityType, delta.data);
      // Update local entity with remote data
      await updateLocalEntity(delta.entityType, existingMapping.localId, remappedData);

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
    case 'TAG':
      return repos.tags.findById(id);
    case 'FILE':
      return repos.files.findById(id);
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
 * Create a local entity from remote data
 */
async function createLocalEntity(
  userId: string,
  instanceId: string,
  entityType: SyncableEntityType,
  data: Record<string, unknown>
): Promise<{ id: string; updatedAt: string } | null> {
  const repos = getRepositories();

  // Remove fields that will be regenerated
  const {
    id: _remoteId,
    createdAt: _createdAt,
    updatedAt: _updatedAt,
    // Extract special fields that need separate handling
    messages: messagesData,
    content: fileContent,
    requiresContentFetch,
    ...entityData
  } = data;

  // Ensure userId is set to local user
  const createData = { ...entityData, userId };

  try {
    switch (entityType) {
      case 'TAG':
        return repos.tags.create(createData as any);

      case 'FILE': {
        // Create file entry in database
        const fileEntry = await repos.files.create(createData as any);

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

      case 'PERSONA':
        return repos.personas.create(createData as any);

      case 'CHARACTER':
        return repos.characters.create(createData as any);

      case 'ROLEPLAY_TEMPLATE':
        return repos.roleplayTemplates.create(createData as any);

      case 'PROMPT_TEMPLATE':
        return repos.promptTemplates.create(createData as any);

      case 'CHAT': {
        // Create chat metadata (without messages - that's done by repos.chats.create)
        const chatEntry = await repos.chats.create(createData as any);

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
        return repos.memories.create(createData as any);

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
  const {
    id: _remoteId,
    userId: _userId,
    createdAt: _createdAt,
    // Extract special fields that need separate handling
    messages: messagesData,
    content: fileContent,
    requiresContentFetch: _requiresContentFetch,
    ...updateData
  } = data;

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
 * Information about a file that needs content fetched separately
 */
export interface FileNeedingContent {
  remoteId: string;
  localId: string;
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
  filesNeedingContent: FileNeedingContent[];
}> {
  const repos = getRepositories();
  let applied = 0;
  const conflicts: SyncConflict[] = [];
  const errors: string[] = [];
  const newMappings: CreateSyncMapping[] = [];
  const filesNeedingContent: FileNeedingContent[] = [];

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

        // Track FILE deltas that need content fetched
        if (
          delta.entityType === 'FILE' &&
          delta.data?.requiresContentFetch === true
        ) {
          filesNeedingContent.push({
            remoteId: delta.id,
            localId: result.newMapping.localId,
          });
        }
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
    filesNeedingContent: filesNeedingContent.length,
  });

  return { applied, conflicts, errors, newMappings, filesNeedingContent };
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
