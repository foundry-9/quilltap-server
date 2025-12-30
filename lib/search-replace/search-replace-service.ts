/**
 * Search and Replace Service
 *
 * Business logic for searching and replacing text across
 * chat messages and memories.
 */

import { getRepositories } from '@/lib/mongodb/repositories';
import { updateMemoryWithEmbedding } from '@/lib/memory/memory-service';
import { logger } from '@/lib/logger';
import type { ChatMetadata } from '@/lib/schemas/types';
import type {
  SearchReplaceScope,
  SearchReplaceRequest,
  SearchReplacePreview,
  SearchReplaceResult,
} from '@/components/tools/search-replace/types';

/**
 * Get chat IDs based on scope
 */
async function getChatIdsForScope(
  scope: SearchReplaceScope,
  userId: string
): Promise<string[]> {
  const repos = getRepositories();

  switch (scope.type) {
    case 'chat':
      // Verify chat belongs to user
      const chat = await repos.chats.findById(scope.chatId);
      if (!chat || chat.userId !== userId) {
        logger.warn('Chat not found or not owned by user', {
          chatId: scope.chatId,
          userId,
        });
        return [];
      }
      return [scope.chatId];

    case 'character':
      // Get all chats where character is a participant (includes former personas with controlledBy: 'user')
      const characterChats = await repos.chats.findByCharacterId(scope.characterId);
      // Filter to only user's chats
      return characterChats
        .filter((c: ChatMetadata) => c.userId === userId)
        .map((c: ChatMetadata) => c.id);

    default:
      logger.error('Unknown scope type', { scope });
      return [];
  }
}

/**
 * Get memory query criteria based on scope
 * Note: personaId removed - personas are now characters with controlledBy: 'user'
 */
function getMemoryQueryForScope(scope: SearchReplaceScope): {
  characterId: string | null;
  chatId: string | null;
} {
  switch (scope.type) {
    case 'chat':
      return { characterId: null, chatId: scope.chatId };
    case 'character':
      return { characterId: scope.characterId, chatId: null };
    default:
      return { characterId: null, chatId: null };
  }
}

/**
 * Get preview counts for a search/replace operation
 */
export async function getSearchReplacePreview(
  request: SearchReplaceRequest,
  userId: string
): Promise<SearchReplacePreview> {
  logger.debug('Getting search/replace preview', {
    scope: request.scope,
    searchTextLength: request.searchText.length,
    includeMessages: request.includeMessages,
    includeMemories: request.includeMemories,
  });

  const repos = getRepositories();
  let messageMatches = 0;
  let memoryMatches = 0;
  let affectedChats = 0;
  let affectedMemories = 0;

  try {
    // Count message matches
    if (request.includeMessages) {
      const chatIds = await getChatIdsForScope(request.scope, userId);
      logger.debug('Counting messages in chats', { chatCount: chatIds.length });

      for (const chatId of chatIds) {
        const count = await repos.chats.countMessagesWithText(chatId, request.searchText);
        if (count > 0) {
          messageMatches += count;
          affectedChats++;
        }
      }
    }

    // Count memory matches
    // Note: personaId parameter removed - personas are now characters with controlledBy: 'user'
    if (request.includeMemories) {
      const memoryQuery = getMemoryQueryForScope(request.scope);
      const count = await repos.memories.countMemoriesWithText(
        memoryQuery.characterId,
        null, // personaId - no longer used, personas are now characters
        memoryQuery.chatId,
        request.searchText
      );
      memoryMatches = count;
      affectedMemories = count;
    }

    const preview = {
      messageMatches,
      memoryMatches,
      affectedChats,
      affectedMemories,
    };

    logger.debug('Search/replace preview complete', preview);
    return preview;
  } catch (error) {
    logger.error('Error getting search/replace preview', {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Execute search and replace operation
 */
export async function executeSearchReplace(
  request: SearchReplaceRequest,
  userId: string,
  onProgress?: (phase: string, current: number, total: number) => void
): Promise<SearchReplaceResult> {
  logger.info('Executing search/replace', {
    scope: request.scope,
    searchTextLength: request.searchText.length,
    replaceTextLength: request.replaceText.length,
    includeMessages: request.includeMessages,
    includeMemories: request.includeMemories,
  });

  const repos = getRepositories();
  let messagesUpdated = 0;
  let memoriesUpdated = 0;
  let chatsAffected = 0;
  const errors: string[] = [];

  try {
    // Process messages
    if (request.includeMessages) {
      const chatIds = await getChatIdsForScope(request.scope, userId);
      logger.debug('Processing messages in chats', { chatCount: chatIds.length });

      for (let i = 0; i < chatIds.length; i++) {
        const chatId = chatIds[i];
        onProgress?.('Updating messages', i + 1, chatIds.length);

        try {
          const updated = await repos.chats.replaceInMessages(
            chatId,
            request.searchText,
            request.replaceText
          );
          if (updated > 0) {
            messagesUpdated += updated;
            chatsAffected++;
          }
        } catch (error) {
          const errorMsg = `Failed to update messages in chat ${chatId}: ${error instanceof Error ? error.message : String(error)}`;
          logger.error(errorMsg);
          errors.push(errorMsg);
        }
      }
    }

    // Process memories
    // Note: personaId parameter removed - personas are now characters with controlledBy: 'user'
    if (request.includeMemories) {
      const memoryQuery = getMemoryQueryForScope(request.scope);
      logger.debug('Finding memories to update', memoryQuery);

      const memoriesToUpdate = await repos.memories.findMemoriesWithText(
        memoryQuery.characterId,
        null, // personaId - no longer used, personas are now characters
        memoryQuery.chatId,
        request.searchText
      );

      logger.debug('Found memories to update', { count: memoriesToUpdate.length });

      if (memoriesToUpdate.length > 0) {
        onProgress?.('Updating memories', 0, memoriesToUpdate.length);

        const memoryIds = memoriesToUpdate.map((m) => m.id);
        const updatedMemories = await repos.memories.replaceInMemories(
          memoryIds,
          request.searchText,
          request.replaceText
        );

        memoriesUpdated = updatedMemories.length;

        // Regenerate embeddings for updated memories
        logger.debug('Regenerating embeddings for updated memories', {
          count: updatedMemories.length,
        });

        for (let i = 0; i < updatedMemories.length; i++) {
          const memory = updatedMemories[i];
          onProgress?.('Regenerating embeddings', i + 1, updatedMemories.length);

          try {
            await updateMemoryWithEmbedding(
              memory.characterId,
              memory.id,
              {
                content: memory.content,
                summary: memory.summary,
              },
              { userId }
            );
          } catch (error) {
            // Log but don't fail - embedding regeneration is best-effort
            logger.warn('Failed to regenerate embedding for memory', {
              memoryId: memory.id,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }
      }
    }

    const result: SearchReplaceResult = {
      messagesUpdated,
      memoriesUpdated,
      chatsAffected,
      errors,
    };

    logger.info('Search/replace execution complete', result);
    return result;
  } catch (error) {
    logger.error('Error executing search/replace', {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
