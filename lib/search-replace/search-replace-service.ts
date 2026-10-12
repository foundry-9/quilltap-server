/**
 * Search and Replace Service
 *
 * Business logic for searching and replacing text across
 * chat messages and memories.
 */

import { getRepositories } from '@/lib/repositories/factory';
import { editMemory, type MemoryEditPatch } from '@/lib/memory/memory-edit';
import { logger } from '@/lib/logger';
import type { ChatMetadata, Memory } from '@/lib/schemas/types';
import type {
  SearchReplaceScope,
  SearchReplaceRequest,
  SearchReplacePreview,
  SearchReplaceResult,
} from '@/components/tools/search-replace/types';

/**
 * The fields of one memory a search and replace would rewrite: content,
 * summary and keywords. Null when the search text appears in none of them.
 * Pure, so the replacement is computed from the row as read and the write can
 * go through `editMemory` with the old row as its baseline (bug 233).
 */
export function planMemoryReplacement(
  memory: Pick<Memory, 'content' | 'summary' | 'keywords'>,
  searchText: string,
  replaceText: string
): MemoryEditPatch | null {
  if (!searchText) return null;
  const replace = (text: string) => text.split(searchText).join(replaceText);
  const patch: MemoryEditPatch = {};

  if (memory.content.includes(searchText)) patch.content = replace(memory.content);
  if (memory.summary.includes(searchText)) patch.summary = replace(memory.summary);
  if (memory.keywords?.some((keyword) => keyword.includes(searchText))) {
    patch.keywords = memory.keywords.map((keyword) => replace(keyword));
  }

  return Object.keys(patch).length > 0 ? patch : null;
}

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
      // Get all chats where character is a participant
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
  const repos = getRepositories();
  let messageMatches = 0;
  let memoryMatches = 0;
  let affectedChats = 0;
  let affectedMemories = 0;

  try {
    // Count message matches
    if (request.includeMessages) {
      const chatIds = await getChatIdsForScope(request.scope, userId);
      for (const chatId of chatIds) {
        const count = await repos.chats.countMessagesWithText(chatId, request.searchText);
        if (count > 0) {
          messageMatches += count;
          affectedChats++;
        }
      }
    }

    // Count memory matches
    if (request.includeMemories) {
      const memoryQuery = getMemoryQueryForScope(request.scope);
      const count = await repos.memories.countMemoriesWithText(
        memoryQuery.characterId,
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
    if (request.includeMemories) {
      const memoryQuery = getMemoryQueryForScope(request.scope);
      const memoriesToUpdate = await repos.memories.findMemoriesWithText(
        memoryQuery.characterId,
        memoryQuery.chatId,
        request.searchText
      );
      // Each row goes through editMemory, which embeds the new text before it
      // writes and writes text and vector together, then invalidates the
      // archive, publishes `memories` and re-mirrors a digest. Rewriting the
      // rows first and re-embedding afterwards compared the new text with
      // itself, so nothing was ever re-embedded (bug 233).
      for (let i = 0; i < memoriesToUpdate.length; i++) {
        const memory = memoriesToUpdate[i];
        onProgress?.('Updating memories', i + 1, memoriesToUpdate.length);

        const patch = planMemoryReplacement(memory, request.searchText, request.replaceText);
        if (!patch) continue;

        try {
          const outcome = await editMemory(memory.characterId, memory.id, patch, { userId });
          if (outcome.ok) {
            memoriesUpdated++;
            logger.debug('Replaced text in memory and re-embedded it', {
              memoryId: memory.id,
              characterId: memory.characterId,
              fields: Object.keys(patch),
            });
          } else if (outcome.reason === 'embedding-failed') {
            const errorMsg = `Memory ${memory.id} left unchanged: its new text could not be embedded (${outcome.message})`;
            logger.warn(errorMsg, { memoryId: memory.id, characterId: memory.characterId });
            errors.push(errorMsg);
          } else {
            logger.debug('Memory skipped during replace', { memoryId: memory.id, reason: outcome.reason });
          }
        } catch (error) {
          const errorMsg = `Failed to update memory ${memory.id}: ${error instanceof Error ? error.message : String(error)}`;
          logger.error(errorMsg);
          errors.push(errorMsg);
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
