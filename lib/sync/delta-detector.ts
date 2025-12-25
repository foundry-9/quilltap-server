/**
 * Sync Delta Detector
 *
 * Detects changes (deltas) in local entities since a given timestamp.
 * Used to identify which entities need to be synced to remote instances.
 */

import { logger } from '@/lib/logger';
import { getRepositories } from '@/lib/mongodb/repositories';
import { SyncableEntityType, SyncEntityDelta, FILE_CONTENT_SIZE_THRESHOLD } from './types';
import { s3FileService } from '@/lib/s3/file-service';

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

  logger.debug('Detecting deltas for entity type', {
    context: 'sync:delta-detector',
    userId,
    entityType,
    sinceTimestamp,
    limit,
  });

  try {
    switch (entityType) {
      case 'CHARACTER': {
        const characters = await repos.characters.findByUserId(userId);
        for (const char of characters) {
          if (!sinceTimestamp || char.updatedAt > sinceTimestamp) {
            deltas.push({
              entityType: 'CHARACTER',
              id: char.id,
              updatedAt: char.updatedAt,
              isDeleted: false,
              data: char as unknown as Record<string, unknown>,
            });
          }
          if (deltas.length >= limit) break;
        }
        break;
      }

      case 'PERSONA': {
        const personas = await repos.personas.findByUserId(userId);
        for (const persona of personas) {
          if (!sinceTimestamp || persona.updatedAt > sinceTimestamp) {
            deltas.push({
              entityType: 'PERSONA',
              id: persona.id,
              updatedAt: persona.updatedAt,
              isDeleted: false,
              data: persona as unknown as Record<string, unknown>,
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
                updatedAt: chat.updatedAt,
                isDeleted: false,
                data: {
                  ...fullChat,
                  messages, // Include messages in the delta
                } as unknown as Record<string, unknown>,
              });
              logger.debug('Added chat delta with messages', {
                context: 'sync:delta-detector',
                chatId: chat.id,
                messageCount: messages.length,
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
              // Don't sync S3-specific references - let local instance manage storage
              s3Key: undefined,
              s3Bucket: undefined,
            };

            // For small files, include base64 content inline
            // For large files, set flag for separate content fetch
            if (file.size < FILE_CONTENT_SIZE_THRESHOLD && file.s3Key) {
              try {
                const content = await s3FileService.downloadUserFile(
                  file.userId,
                  file.id,
                  file.originalFilename,
                  file.category
                );
                fileData.content = content.toString('base64');
                fileData.requiresContentFetch = false;
                logger.debug('Added file delta with inline content', {
                  context: 'sync:delta-detector',
                  fileId: file.id,
                  size: file.size,
                });
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
              logger.debug('Added file delta requiring content fetch', {
                context: 'sync:delta-detector',
                fileId: file.id,
                size: file.size,
                threshold: FILE_CONTENT_SIZE_THRESHOLD,
              });
            }

            deltas.push({
              entityType: 'FILE',
              id: file.id,
              updatedAt: file.updatedAt,
              isDeleted: false,
              data: fileData,
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

  logger.debug('Detected deltas for entity type', {
    context: 'sync:delta-detector',
    entityType,
    count: deltas.length,
  });

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
    entityTypes = ['TAG', 'FILE', 'PERSONA', 'CHARACTER', 'ROLEPLAY_TEMPLATE', 'PROMPT_TEMPLATE', 'CHAT', 'MEMORY'],
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
  let remainingLimit = limit;

  // Collect deltas from each entity type
  for (const entityType of entityTypes) {
    if (remainingLimit <= 0) break;

    const typeDeltas = await getEntityDeltas(userId, entityType, sinceTimestamp, remainingLimit);
    allDeltas.push(...typeDeltas);
    remainingLimit -= typeDeltas.length;
  }

  // Sort by updatedAt ascending (oldest first)
  allDeltas.sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));

  // Trim to limit
  const trimmedDeltas = allDeltas.slice(0, limit);
  const hasMore = allDeltas.length > limit;

  // Calculate timestamp range
  const oldestTimestamp = trimmedDeltas.length > 0 ? trimmedDeltas[0].updatedAt : null;
  const newestTimestamp =
    trimmedDeltas.length > 0 ? trimmedDeltas[trimmedDeltas.length - 1].updatedAt : null;

  logger.info('Delta detection complete', {
    context: 'sync:delta-detector',
    userId,
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
    entityTypes = ['TAG', 'FILE', 'PERSONA', 'CHARACTER', 'ROLEPLAY_TEMPLATE', 'PROMPT_TEMPLATE', 'CHAT', 'MEMORY'],
    sinceTimestamp = null,
  } = options;

  logger.debug('Counting deltas', {
    context: 'sync:delta-detector',
    userId,
    entityTypes,
    sinceTimestamp,
  });

  const counts: Record<string, number> = {};

  for (const entityType of entityTypes) {
    // Use a high limit just to count
    const deltas = await getEntityDeltas(userId, entityType, sinceTimestamp, 10000);
    counts[entityType] = deltas.length;
  }

  logger.debug('Delta count complete', {
    context: 'sync:delta-detector',
    userId,
    counts,
  });

  return counts as Record<SyncableEntityType, number>;
}

/**
 * Get the most recent updatedAt timestamp across all entities for a user.
 * Useful for determining if any sync is needed.
 */
export async function getMostRecentUpdate(userId: string): Promise<string | null> {
  const repos = getRepositories();
  let mostRecent: string | null = null;

  logger.debug('Getting most recent update', {
    context: 'sync:delta-detector',
    userId,
  });

  try {
    // Check each entity type for the most recent update
    const checkTimestamp = (timestamp: string | undefined) => {
      if (timestamp && (!mostRecent || timestamp > mostRecent)) {
        mostRecent = timestamp;
      }
    };

    const characters = await repos.characters.findByUserId(userId);
    characters.forEach((c) => checkTimestamp(c.updatedAt));

    const personas = await repos.personas.findByUserId(userId);
    personas.forEach((p) => checkTimestamp(p.updatedAt));

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

  logger.debug('Most recent update found', {
    context: 'sync:delta-detector',
    userId,
    mostRecent,
  });

  return mostRecent;
}
