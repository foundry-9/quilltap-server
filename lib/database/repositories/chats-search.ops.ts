/**
 * Chat Search & Replace Operations
 *
 * Handles text search and replace within chat messages:
 * count matches, find matches, and bulk replace.
 */

import { ChatEventSchema } from '@/lib/schemas/types';
import { QueryFilter } from '../interfaces';
import { logger } from '@/lib/logger';
import { rawQuery } from '../manager';
import { chatMessageFtsEligibilitySql } from '../backends/sqlite/chat-message-fts';
import { buildFtsMatchExpression } from './fts-query';
import { escapeLikeLiteral } from './like-escape';
import { ChatOpsContext } from './chats-ops-context';
import { ChatMessagesOps } from './chats-messages.ops';
import { safeQuery } from './safe-query';

/** Maximum allowed search query length to prevent excessive memory usage */
export const MAX_SEARCH_QUERY_LENGTH = 1000;

/** One row of a global message search, before it is shaped for the caller. */
interface GlobalSearchRow {
  id: string;
  chatId: string;
  role: string;
  createdAt: string;
  content: string | null;
}

/**
 * Wrap a matching-ids query so the message text is decoded ONLY for the rows
 * that survive `ORDER BY … LIMIT`.
 *
 * This is not cosmetic. SQLite puts a query's output columns into the sorter
 * record, so a `qt_text("content")` in the outer SELECT list is evaluated for
 * every match before the limit is applied. On 142,000 rows, a query for a word
 * that appears in most messages took 1.2 s that way and 86 ms this way —
 * identical results — because only 100 rows are ever decompressed. A rare term
 * (the normal case) costs a tenth of a millisecond either way.
 *
 * The inner query therefore carries nothing but the id and the sort key.
 */
function deferTextDecode(matchingIdsSql: string): string {
  return `
    SELECT m."id" AS id, m."chatId" AS chatId, m."role" AS role,
           s."ca" AS createdAt, qt_text(m."content") AS content
      FROM (${matchingIdsSql}) s
      JOIN "chat_messages" m ON m."id" = s."mid"
     ORDER BY s."ca" DESC
  `;
}

/**
 * The indexed path: probe the FTS5 index, then join back for the columns the
 * caller wants.
 *
 * The `chatId IN (…)` list is kept for PARITY with the pre-index query rather
 * than being replaced with a join on `chats.userId`. It binds the same
 * parameters the `$in` filter always did, so nothing about the caller's
 * contract changes; in a single-user instance it is every chat anyway.
 */
function buildFtsSearchSql(chatIdCount: number): string {
  const placeholders = Array.from({ length: chatIdCount }, () => '?').join(', ');
  return deferTextDecode(`
      SELECT x."messageId" AS mid, mm."createdAt" AS ca
        FROM "chat_messages_fts" f
        JOIN "chat_messages_fts_map" x ON x."ftsId" = f.rowid
        JOIN "chat_messages" mm        ON mm."id" = x."messageId"
       WHERE "chat_messages_fts" MATCH ?
         AND mm."chatId" IN (${placeholders})
       ORDER BY mm."createdAt" DESC
       LIMIT ?
  `);
}

/**
 * The fallback path: an exact substring scan, for queries FTS cannot answer
 * (all tokens under two characters, or no tokens at all).
 *
 * Slow, correct and rare — and slower still now that the column is compressed,
 * since every row must be decompressed to be compared. That cost is the reason
 * the fallback is reserved for queries the index genuinely cannot serve.
 *
 * Built as a direct `LIKE … ESCAPE` rather than through the repository's
 * `$regex` filter, whose regex→LIKE conversion drops the escape clause and
 * turns a user's `.` into a wildcard.
 */
function buildLikeSearchSql(chatIdCount: number): string {
  const placeholders = Array.from({ length: chatIdCount }, () => '?').join(', ');
  return deferTextDecode(`
      SELECT mm."id" AS mid, mm."createdAt" AS ca
        FROM "chat_messages" mm
       WHERE ${chatMessageFtsEligibilitySql('mm')}
         AND mm."chatId" IN (${placeholders})
         AND qt_text(mm."content") LIKE ? ESCAPE '\\'
       ORDER BY mm."createdAt" DESC
       LIMIT ?
  `);
}

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
   * Search messages globally across multiple chats
   * @param chatIds Array of chat IDs to search within
   * @param searchText Text to search for (case-insensitive)
   * @param limit Maximum number of results to return (default 100)
   * @returns Array of matching messages with their metadata
   */
  async searchMessagesGlobal(
    chatIds: string[],
    searchText: string,
    limit = 100
  ): Promise<Array<{ messageId: string; content: string; chatId: string; role: string; createdAt: string }>> {
    return safeQuery(async () => {
      if (searchText.length > MAX_SEARCH_QUERY_LENGTH) {
        logger.warn('Global search text exceeds maximum length', {
          queryLength: searchText.length,
          maxLength: MAX_SEARCH_QUERY_LENGTH,
        });
        return [];
      }

      if (chatIds.length === 0) {
        return [];
      }

      if (this.ctx.isSQLiteBackend()) {
        const plan = buildFtsMatchExpression(searchText);
        logger.debug('Global message search plan', {
          path: plan.kind,
          tokens: plan.tokens.length,
          chatCount: chatIds.length,
          ...(plan.kind === 'fallback' ? { reason: plan.reason } : {}),
        });

        let rows: GlobalSearchRow[] | null = null;

        if (plan.kind === 'fts') {
          try {
            rows = await rawQuery<GlobalSearchRow[]>(buildFtsSearchSql(chatIds.length), [
              plan.match,
              ...chatIds,
              limit,
            ]);
          } catch (ftsError) {
            // The index is created by `create-chat-message-fts-v1` and healed
            // at every boot, so this should not happen — but a search bar that
            // returns nothing is a worse failure than a slow one.
            logger.warn('FTS message search failed; falling back to an exact scan', {
              error: ftsError instanceof Error ? ftsError.message : String(ftsError),
            });
            rows = null;
          }
        }

        if (rows === null) {
          const likePattern =
            plan.kind === 'fallback' ? plan.likePattern : `%${escapeLikeLiteral(searchText)}%`;
          rows = await rawQuery<GlobalSearchRow[]>(buildLikeSearchSql(chatIds.length), [
            ...chatIds,
            likePattern,
            limit,
          ]);
        }

        return rows.map(row => ({
          messageId: row.id,
          content: row.content ?? '',
          chatId: row.chatId,
          role: row.role,
          createdAt: row.createdAt,
        }));
      } else {
        // Legacy data compatibility: iterate through each chat's embedded messages
        const results: Array<{ messageId: string; content: string; chatId: string; role: string; createdAt: string }> = [];

        for (const chatId of chatIds) {
          if (results.length >= limit) break;
          const messages = await this.messagesOps.getMessages(chatId);
          const lowerSearch = searchText.toLowerCase();

          for (const msg of messages) {
            if (results.length >= limit) break;
            if (
              msg.type === 'message' &&
              (msg.role === 'USER' || msg.role === 'ASSISTANT') &&
              msg.content.toLowerCase().includes(lowerSearch)
            ) {
              results.push({
                messageId: msg.id,
                content: msg.content,
                chatId,
                role: msg.role,
                createdAt: msg.createdAt || '',
              });
            }
          }
        }

        return results;
      }
    }, 'Failed to search messages globally', { chatCount: chatIds.length }, []);
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

      // But it IS a transcript change, and this is the one message-writing path
      // that doesn't go through the add/update/delete funnel. Without this, an
      // open Salon tab would go on being told "unchanged" while every line it
      // is displaying had its text rewritten underneath it.
      await this.messagesOps.announceTranscriptChange(chatId);

      logger.info('Replaced text in messages', { chatId, updatedCount });
      return updatedCount;
    }, 'Failed to replace text in messages', { chatId });
  }
}
