/**
 * Chat Search & Replace Operations
 *
 * Handles text search and replace within chat messages:
 * count matches, find matches, and bulk replace.
 */

import { ChatEventSchema } from '@/lib/schemas/types';
import { QueryFilter } from '../interfaces';
import { logger } from '@/lib/logger';
import { ChatOpsContext } from './chats-ops-context';
import { ChatMessagesOps } from './chats-messages.ops';
import { safeQuery } from './safe-query';

/** Maximum allowed search query length to prevent excessive memory usage */
export const MAX_SEARCH_QUERY_LENGTH = 1000;

export class ChatSearchReplaceOps {
  constructor(
    private readonly ctx: ChatOpsContext,
    private readonly messagesOps: ChatMessagesOps
  ) {}

  /**
   * Count messages containing specific text in a chat
   * @param chatId The chat ID
   * @param searchText Text to search for
   * @returns Number of messages containing the text
   */
  async countMessagesWithText(chatId: string, searchText: string): Promise<number> {
    return safeQuery(async () => {
      if (searchText.length > MAX_SEARCH_QUERY_LENGTH) {
        logger.warn('Search text exceeds maximum length', {
          chatId,
          queryLength: searchText.length,
          maxLength: MAX_SEARCH_QUERY_LENGTH,
        });
        return 0;
      }
      const messages = await this.messagesOps.getMessages(chatId);
      let count = 0;

      for (const msg of messages) {
        if (msg.type === 'message' && msg.content.includes(searchText)) {
          count++;
        }
      }
      return count;
    }, 'Failed to count messages with text', { chatId }, 0);
  }

  /**
   * Find messages containing specific text in a chat
   * @param chatId The chat ID
   * @param searchText Text to search for
   * @returns Array of matching messages with their IDs and content
   */
  async findMessagesWithText(
    chatId: string,
    searchText: string
  ): Promise<Array<{ messageId: string; content: string; chatId: string }>> {
    return safeQuery(async () => {
      if (searchText.length > MAX_SEARCH_QUERY_LENGTH) {
        logger.warn('Search text exceeds maximum length', {
          chatId,
          queryLength: searchText.length,
          maxLength: MAX_SEARCH_QUERY_LENGTH,
        });
        return [];
      }
      const messages = await this.messagesOps.getMessages(chatId);
      const matches: Array<{ messageId: string; content: string; chatId: string }> = [];

      for (const msg of messages) {
        if (msg.type === 'message' && msg.content.includes(searchText)) {
          matches.push({
            messageId: msg.id,
            content: msg.content,
            chatId,
          });
        }
      }
      return matches;
    }, 'Failed to find messages with text', { chatId }, []);
  }

  /**
   * Replace text in all messages of a chat
   * @param chatId The chat ID
   * @param searchText Text to find
   * @param replaceText Text to replace with
   * @returns Number of messages updated
   */
  async replaceInMessages(
    chatId: string,
    searchText: string,
    replaceText: string
  ): Promise<number> {
    return safeQuery(async () => {
      const messages = await this.messagesOps.getMessages(chatId);
      let updatedCount = 0;
      const messagesCollection = await this.ctx.getMessagesCollection();

      if (this.ctx.isSQLiteBackend()) {
        // SQLite: Update each matching message row individually
        for (const msg of messages) {
          if (msg.type === 'message' && msg.content.includes(searchText)) {
            const newContent = msg.content.split(searchText).join(replaceText);
            if (newContent !== msg.content) {
              const validated = ChatEventSchema.parse({ ...msg, content: newContent });
              await messagesCollection.updateOne(
                { id: msg.id } as QueryFilter,
                { $set: { content: newContent } } as any
              );
              updatedCount++;
            }
          }
        }
      } else {
        // Legacy data compatibility: Update entire embedded array
        let hasChanges = false;
        const updatedMessages = messages.map(msg => {
          if (msg.type === 'message' && msg.content.includes(searchText)) {
            const newContent = msg.content.split(searchText).join(replaceText);
            if (newContent !== msg.content) {
              updatedCount++;
              hasChanges = true;
              return { ...msg, content: newContent };
            }
          }
          return msg;
        });

        if (hasChanges) {
          const validated = updatedMessages.map(msg => ChatEventSchema.parse(msg));
          const now = this.ctx.getCurrentTimestamp();

          await messagesCollection.updateOne(
            { chatId } as QueryFilter,
            {
              $set: {
                messages: validated,
                updatedAt: now,
              },
            } as any
          );
        }
      }

      if (updatedCount === 0) {
        return 0;
      }

      // Note: We intentionally don't update chat.updatedAt here since message edits
      // are not considered "new messages" for sorting purposes

      logger.info('Replaced text in messages', { chatId, updatedCount });
      return updatedCount;
    }, 'Failed to replace text in messages', { chatId });
  }
}
