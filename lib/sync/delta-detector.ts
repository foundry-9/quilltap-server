/**
 * Sync Delta Detector
 *
 * Detects changes (deltas) in local entities since a given timestamp.
 * Used to identify which entities need to be synced to remote instances.
 */

import { logger } from '@/lib/logger';
import { getRepositories } from '@/lib/repositories/factory';
import { SyncableEntityType, SyncEntityDelta, FILE_CONTENT_SIZE_THRESHOLD } from './types';
import { fileStorageManager } from '@/lib/file-storage/manager';

/**
 * Options for delta detection
 */
export interface DeltaDetectionOptions {
  userId: string;
  entityTypes?: SyncableEntityType[];
  sinceTimestamp?: string | null;
  limit?: number;
}

/**
 * Result of delta detection
 */
export interface DeltaDetectionResult {
  deltas: SyncEntityDelta[];
  hasMore: boolean;
  oldestTimestamp: string | null;
  newestTimestamp: string | null;
}

/**
 * Get deltas for a specific entity type
 */
async function getEntityDeltas(
  userId: string,
  entityType: SyncableEntityType,
  sinceTimestamp: string | null,
  limit: number
): Promise<SyncEntityDelta[]> {
  const repos = getRepositories();
  const deltas: SyncEntityDelta[] = [];
  try {
    switch (entityType) {
      case 'CHARACTER': {
        const characters = await repos.characters.findByUserId(userId);
        for (const char of characters) {
          if (!sinceTimestamp || char.updatedAt > sinceTimestamp) {
            deltas.push({
              entityType: 'CHARACTER',
              id: char.id,
              createdAt: char.createdAt,
              updatedAt: char.updatedAt,
              isDeleted: false,
              data: char as unknown as Record<string, unknown>,
            });
          }
          if (deltas.length >= limit) break;
        }
        break;
      }

      case 'CHAT': {
        const chats = await repos.chats.findByUserId(userId);
        for (const chat of chats) {
          if (!sinceTimestamp || chat.updatedAt > sinceTimestamp) {
            // Get full chat metadata
            const fullChat = await repos.chats.findById(chat.id);
            if (fullChat) {
              // Also fetch messages for the chat
              const messages = await repos.chats.getMessages(chat.id);
              deltas.push({
                entityType: 'CHAT',
                id: chat.id,
                createdAt: chat.createdAt,
                updatedAt: chat.updatedAt,
                isDeleted: false,
                data: {
                  ...fullChat,
                  messages, // Include messages in the delta
                } as unknown as Record<string, unknown>,
              });
            }
          }
          if (deltas.length >= limit) break;
        }
        break;
      }

      case 'MEMORY': {
        // Memories don't have userId directly - get via characters
        const characters = await repos.characters.findByUserId(userId);
        for (const character of characters) {
          const memories = await repos.memories.findByCharacterId(character.id);
          for (const memory of memories) {
            if (!sinceTimestamp || memory.updatedAt > sinceTimestamp) {
              deltas.push({
                entityType: 'MEMORY',
                id: memory.id,
                createdAt: memory.createdAt,
                updatedAt: memory.updatedAt,
                isDeleted: false,
                data: memory as unknown as Record<string, unknown>,
              });
            }
            if (deltas.length >= limit) break;
          }
          if (deltas.length >= limit) break;
        }
        break;
      }

      case 'TAG': {
        const tags = await repos.tags.findByUserId(userId);
        for (const tag of tags) {
          if (!sinceTimestamp || tag.updatedAt > sinceTimestamp) {
            deltas.push({
              entityType: 'TAG',
              id: tag.id,
              createdAt: tag.createdAt,
              updatedAt: tag.updatedAt,
              isDeleted: false,
              data: tag as unknown as Record<string, unknown>,
            });
          }
          if (deltas.length >= limit) break;
        }
        break;
      }

      case 'FILE': {
        const files = await repos.files.findByUserId(userId);
        for (const file of files) {
          if (!sinceTimestamp || file.updatedAt > sinceTimestamp) {
            // Prepare file data for sync
            const fileData: Record<string, unknown> = {
              ...file,
              // Don't sync storage-specific references - let local instance manage storage
              storageKey: undefined,
              mountPointId: undefined,
              // Strip legacy S3 fields as well
              s3Key: undefined,
              s3Bucket: undefined,
            };

            // For small files, include base64 content inline
            // For large files, set flag for separate content fetch
            if (file.size < FILE_CONTENT_SIZE_THRESHOLD && file.storageKey) {
              try {
                const content = await fileStorageManager.downloadFile(file);
                fileData.content = content.toString('base64');
                fileData.requiresContentFetch = false;
              } catch (error) {
                // If we can't read the content, mark for separate fetch
                logger.warn('Failed to read file content for sync, marking for fetch', {
                  context: 'sync:delta-detector',
                  fileId: file.id,
                  error: error instanceof Error ? error.message : String(error),
                });
                fileData.requiresContentFetch = true;
              }
            } else {
              // Large file - requires separate content fetch
              fileData.requiresContentFetch = true;
            }

            deltas.push({
              entityType: 'FILE',
              id: file.id,
              createdAt: file.createdAt,
              updatedAt: file.updatedAt,
              isDeleted: false,
              data: fileData,
            });
          }
          if (deltas.length >= limit) break;
        }
        break;
      }

      case 'PROJECT': {
        const projects = await repos.projects.findByUserId(userId);
        for (const project of projects) {
          if (!sinceTimestamp || project.updatedAt > sinceTimestamp) {
            deltas.push({
              entityType: 'PROJECT',
              id: project.id,
              createdAt: project.createdAt,
              updatedAt: project.updatedAt,
              isDeleted: false,
              data: project as unknown as Record<string, unknown>,
            });
          }
          if (deltas.length >= limit) break;
        }
        break;
      }

      case 'CONNECTION_PROFILE': {
        const profiles = await repos.connections.findByUserId(userId);
        for (const profile of profiles) {
          if (!sinceTimestamp || profile.updatedAt > sinceTimestamp) {
            // Strip apiKeyId and add _apiKeyLabel for reference
            // API keys are instance-specific (different encryption) so can't be synced
            const { apiKeyId, ...profileData } = profile;
            let apiKeyLabel: string | undefined;
            if (apiKeyId) {
              const apiKey = await repos.connections.findApiKeyById(apiKeyId);
              apiKeyLabel = apiKey?.label;
            }
            deltas.push({
              entityType: 'CONNECTION_PROFILE',
              id: profile.id,
              createdAt: profile.createdAt,
              updatedAt: profile.updatedAt,
              isDeleted: false,
              data: {
                ...profileData,
                _apiKeyLabel: apiKeyLabel,
              } as unknown as Record<string, unknown>,
            });
          }
          if (deltas.length >= limit) break;
        }
        break;
      }

      case 'ROLEPLAY_TEMPLATE': {
        const templates = await repos.roleplayTemplates.findByUserId(userId);
        for (const template of templates) {
          if (!sinceTimestamp || template.updatedAt > sinceTimestamp) {
            deltas.push({
              entityType: 'ROLEPLAY_TEMPLATE',
              id: template.id,
              createdAt: template.createdAt,
              updatedAt: template.updatedAt,
              isDeleted: false,
              data: template as unknown as Record<string, unknown>,
            });
          }
          if (deltas.length >= limit) break;
        }
        break;
      }

      case 'PROMPT_TEMPLATE': {
        const prompts = await repos.promptTemplates.findByUserId(userId);
        for (const prompt of prompts) {
          if (!sinceTimestamp || prompt.updatedAt > sinceTimestamp) {
            deltas.push({
              entityType: 'PROMPT_TEMPLATE',
              id: prompt.id,
              createdAt: prompt.createdAt,
              updatedAt: prompt.updatedAt,
              isDeleted: false,
              data: prompt as unknown as Record<string, unknown>,
            });
          }
          if (deltas.length >= limit) break;
        }
        break;
      }

      default:
        logger.warn('Unknown entity type for delta detection', {
          context: 'sync:delta-detector',
          entityType,
        });
    }
  } catch (error) {
    logger.error('Error detecting deltas for entity type', {
      context: 'sync:delta-detector',
      entityType,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
  return deltas;
}

/**
 * Detect all deltas for a user since a given timestamp.
 * Returns entities that have been updated since the last sync.
 */
export async function detectDeltas(options: DeltaDetectionOptions): Promise<DeltaDetectionResult> {
  const {
    userId,
    // Enforced sync order - entities with dependencies come after their dependencies
    entityTypes = ['TAG', 'FILE', 'PROJECT', 'CONNECTION_PROFILE', 'CHARACTER', 'ROLEPLAY_TEMPLATE', 'PROMPT_TEMPLATE', 'CHAT', 'MEMORY'],
    sinceTimestamp = null,
    limit = 100,
  } = options;

  logger.info('Starting delta detection', {
    context: 'sync:delta-detector',
    userId,
    entityTypes,
    sinceTimestamp,
    limit,
  });

  const allDeltas: SyncEntityDelta[] = [];

  // Collect deltas from each entity type
  // Use a high internal limit per type to ensure we collect enough entities
  // from ALL types, not just the first few. This ensures later entity types (like MEMORY)
  // aren't starved when earlier types have many entities.
  // We collect up to 10x the requested limit per type to ensure proper sorting by updatedAt
  // across all entity types. The final result is trimmed to the requested limit.
  const perTypeLimit = Math.max(limit * 10, 1000);

  for (const entityType of entityTypes) {
    const typeDeltas = await getEntityDeltas(userId, entityType, sinceTimestamp, perTypeLimit);
    allDeltas.push(...typeDeltas);
  }

  // Sort by updatedAt ascending (oldest first)
  // This ensures pagination works correctly - we return the oldest first,
  // and the cursor can pick up where we left off
  allDeltas.sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));

  // Trim to the requested limit
  const trimmedDeltas = allDeltas.slice(0, limit);

  // hasMore is true if we collected more entities than the limit
  const hasMore = allDeltas.length > limit;

  // Calculate timestamp range
  const oldestTimestamp = trimmedDeltas.length > 0 ? trimmedDeltas[0].updatedAt : null;
  const newestTimestamp =
    trimmedDeltas.length > 0 ? trimmedDeltas[trimmedDeltas.length - 1].updatedAt : null;

  logger.info('Delta detection complete', {
    context: 'sync:delta-detector',
    userId,
    totalCollected: allDeltas.length,
    totalDeltas: trimmedDeltas.length,
    hasMore,
    oldestTimestamp,
    newestTimestamp,
  });

  return {
    deltas: trimmedDeltas,
    hasMore,
    oldestTimestamp,
    newestTimestamp,
  };
}

/**
 * Count entities that would be included in a delta detection.
 * Useful for previewing sync operations.
 */
export async function countDeltas(options: DeltaDetectionOptions): Promise<Record<SyncableEntityType, number>> {
  const {
    userId,
    // Enforced sync order - entities with dependencies come after their dependencies
    entityTypes = ['TAG', 'FILE', 'PROJECT', 'CONNECTION_PROFILE', 'CHARACTER', 'ROLEPLAY_TEMPLATE', 'PROMPT_TEMPLATE', 'CHAT', 'MEMORY'],
    sinceTimestamp = null,
  } = options;
  const counts: Record<string, number> = {};

  for (const entityType of entityTypes) {
    // Use a high limit just to count
    const deltas = await getEntityDeltas(userId, entityType, sinceTimestamp, 10000);
    counts[entityType] = deltas.length;
  }
  return counts as Record<SyncableEntityType, number>;
}

/**
 * Get the most recent updatedAt timestamp across all entities for a user.
 * Useful for determining if any sync is needed.
 */
export async function getMostRecentUpdate(userId: string): Promise<string | null> {
  const repos = getRepositories();
  let mostRecent: string | null = null;
  try {
    // Check each entity type for the most recent update
    const checkTimestamp = (timestamp: string | undefined) => {
      if (timestamp && (!mostRecent || timestamp > mostRecent)) {
        mostRecent = timestamp;
      }
    };

    const characters = await repos.characters.findByUserId(userId);
    characters.forEach((c) => checkTimestamp(c.updatedAt));

    const chats = await repos.chats.findByUserId(userId);
    chats.forEach((c) => checkTimestamp(c.updatedAt));

    // Memories don't have userId - check via characters
    for (const char of characters) {
      const memories = await repos.memories.findByCharacterId(char.id);
      memories.forEach((m) => checkTimestamp(m.updatedAt));
    }

    const tags = await repos.tags.findByUserId(userId);
    tags.forEach((t) => checkTimestamp(t.updatedAt));

    const files = await repos.files.findByUserId(userId);
    files.forEach((f) => checkTimestamp(f.updatedAt));

    const projects = await repos.projects.findByUserId(userId);
    projects.forEach((p) => checkTimestamp(p.updatedAt));

    const connectionProfiles = await repos.connections.findByUserId(userId);
    connectionProfiles.forEach((c) => checkTimestamp(c.updatedAt));

    const roleplayTemplates = await repos.roleplayTemplates.findByUserId(userId);
    roleplayTemplates.forEach((r) => checkTimestamp(r.updatedAt));

    const promptTemplates = await repos.promptTemplates.findByUserId(userId);
    promptTemplates.forEach((p) => checkTimestamp(p.updatedAt));
  } catch (error) {
    logger.error('Error getting most recent update', {
      context: 'sync:delta-detector',
      userId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
  return mostRecent;
}
