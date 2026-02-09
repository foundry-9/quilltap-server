/**
 * Chat Messages Operations
 *
 * Handles message CRUD for chats: get, add, add-many, update,
 * count, and clear. Also exports the ChatMessageRowSchema
 * used for SQLite collection initialization.
 */

import { z } from 'zod';
import {
  ChatMetadata,
  ChatEvent,
  ChatEventSchema,
} from '@/lib/schemas/types';
import { UUIDSchema, TimestampSchema, JsonSchema, RoleEnum } from '@/lib/schemas/common.types';
import { QueryFilter, SortSpec } from '../interfaces';
import { logger } from '@/lib/logger';
import { ChatOpsContext } from './chats-ops-context';

/**
 * Schema for individual chat message rows in SQLite
 * This schema represents the flattened message format with chatId added
 * for the normalized SQLite storage pattern
 */
export const ChatMessageRowSchema = z.object({
  id: UUIDSchema,
  chatId: UUIDSchema,
  type: z.string(),  // 'message', 'context-summary', or 'system'
  role: RoleEnum.optional(),  // Only for type='message'
  content: z.string().optional(),  // For type='message'
  rawResponse: JsonSchema.nullable().optional(),  // JSON object
  tokenCount: z.number().nullable().optional(),
  promptTokens: z.number().nullable().optional(),
  completionTokens: z.number().nullable().optional(),
  swipeGroupId: z.string().nullable().optional(),
  swipeIndex: z.number().nullable().optional(),
  attachments: z.array(UUIDSchema).default([]),  // JSON array
  debugMemoryLogs: z.array(z.string()).optional(),  // JSON array
  thoughtSignature: z.string().nullable().optional(),
  participantId: UUIDSchema.nullable().optional(),
  recoveryType: z.enum(['token_limit', 'token_limit_static', 'content_limit', 'content_limit_static']).nullable().optional(),
  // For type='context-summary'
  context: z.string().optional(),
  // For type='system'
  systemEventType: z.string().optional(),
  description: z.string().optional(),
  totalTokens: z.number().nullable().optional(),
  provider: z.string().nullable().optional(),
  modelName: z.string().nullable().optional(),
  estimatedCostUSD: z.number().nullable().optional(),
  createdAt: TimestampSchema,
});

export class ChatMessagesOps {
  constructor(private readonly ctx: ChatOpsContext) {}

  /**
   * Count only messages that appear as visible bubbles in the UI
   * (type === 'message' with USER or ASSISTANT role, excluding SYSTEM and TOOL)
   */
  private countVisibleMessages(messages: ChatEvent[]): number {
    return messages.filter(m => m.type === 'message' && m.role !== 'SYSTEM' && m.role !== 'TOOL').length;
  }

  /**
   * Get all messages for a chat
   */
  async getMessages(chatId: string): Promise<ChatEvent[]> {
    try {
      const messagesCollection = await this.ctx.getMessagesCollection();

      if (this.ctx.isSQLiteBackend()) {
        // SQLite: Query individual message rows, sorted by createdAt
        const messages = await messagesCollection.find(
          { chatId } as QueryFilter,
          { sort: { createdAt: 1 } as SortSpec }
        );
        return messages.map((msg: any) => ChatEventSchema.parse(msg));
      } else {
        // Legacy data compatibility: Extract from embedded array
        const messagesDoc = await messagesCollection.findOne({ chatId } as QueryFilter);

        if (!messagesDoc) {
          return [];
        }

        const messages = (messagesDoc as any).messages || [];
        return messages.map((msg: any) => ChatEventSchema.parse(msg));
      }
    } catch (error) {
      logger.error('Failed to get messages for chat', {
        chatId,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Add a message to a chat
   */
  async addMessage(chatId: string, message: ChatEvent): Promise<ChatEvent> {
    try {
      const validated = ChatEventSchema.parse(message);
      const messagesCollection = await this.ctx.getMessagesCollection();
      const now = this.ctx.getCurrentTimestamp();

      if (this.ctx.isSQLiteBackend()) {
        // SQLite: Insert as individual row with chatId
        await messagesCollection.insertOne({ ...validated, chatId } as any);
      } else {
        // Legacy data compatibility: Push to embedded array
        await messagesCollection.updateOne(
          { chatId } as QueryFilter,
          {
            $push: { messages: validated },
            $set: { updatedAt: now },
          } as any,
        );
      }

      // Update chat metadata — only update lastMessageAt and updatedAt for actual messages
      const chat = await this.ctx.findById(chatId);
      if (chat) {
        const allMessages = await this.getMessages(chatId);
        const isActualMessage = validated.type === 'message';
        const updateData: Record<string, unknown> = {
          messageCount: this.countVisibleMessages(allMessages),
        };
        if (isActualMessage) {
          updateData.lastMessageAt = now;
          updateData.updatedAt = now;
        }
        await this.ctx.update(chatId, updateData as Partial<ChatMetadata>);
      }
      return validated;
    } catch (error) {
      logger.error('Failed to add message to chat', {
        chatId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Add multiple messages to a chat
   */
  async addMessages(chatId: string, messages: ChatEvent[]): Promise<ChatEvent[]> {
    try {
      const validated = messages.map(msg => ChatEventSchema.parse(msg));
      const messagesCollection = await this.ctx.getMessagesCollection();
      const now = this.ctx.getCurrentTimestamp();

      if (this.ctx.isSQLiteBackend()) {
        // SQLite: Insert each message as individual row with chatId
        for (const msg of validated) {
          await messagesCollection.insertOne({ ...msg, chatId } as any);
        }
      } else {
        // Legacy data compatibility: Push all to embedded array
        await messagesCollection.updateOne(
          { chatId } as QueryFilter,
          {
            $push: { messages: { $each: validated } },
            $set: { updatedAt: now },
          } as any
        );
      }

      // Update chat metadata — only update lastMessageAt and updatedAt if batch contains actual messages
      const chat = await this.ctx.findById(chatId);
      if (chat) {
        const allMessages = await this.getMessages(chatId);
        const hasActualMessages = validated.some(m => m.type === 'message');
        const updateData: Record<string, unknown> = {
          messageCount: this.countVisibleMessages(allMessages),
        };
        if (hasActualMessages) {
          updateData.lastMessageAt = now;
          updateData.updatedAt = now;
        }
        await this.ctx.update(chatId, updateData as Partial<ChatMetadata>);
      }
      return validated;
    } catch (error) {
      logger.error('Failed to add messages to chat', {
        chatId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Update a specific message in a chat
   */
  async updateMessage(chatId: string, messageId: string, updates: Partial<ChatEvent>): Promise<ChatEvent | null> {
    try {
      const messagesCollection = await this.ctx.getMessagesCollection();
      const now = this.ctx.getCurrentTimestamp();

      if (this.ctx.isSQLiteBackend()) {
        // SQLite: Find and update the specific message row
        const existingMessage = await messagesCollection.findOne({ id: messageId, chatId } as QueryFilter);
        if (!existingMessage) {
          return null;
        }

        const updatedMessage = { ...existingMessage, ...updates };
        const validated = ChatEventSchema.parse(updatedMessage);

        await messagesCollection.updateOne(
          { id: messageId } as QueryFilter,
          { $set: validated } as any
        );
        return validated;
      } else {
        // Legacy data compatibility: Update in embedded array
        const messages = await this.getMessages(chatId);
        const messageIndex = messages.findIndex(m => m.id === messageId);

        if (messageIndex === -1) {
          return null;
        }

        // Merge updates with existing message
        const updatedMessage = { ...messages[messageIndex], ...updates };
        const validated = ChatEventSchema.parse(updatedMessage);

        // Replace message in array
        messages[messageIndex] = validated;

        // Update entire messages array
        await messagesCollection.updateOne(
          { chatId } as QueryFilter,
          {
            $set: {
              messages: messages,
              updatedAt: now,
            },
          } as any
        );
        return validated;
      }
    } catch (error) {
      logger.error('Failed to update message in chat', {
        chatId,
        messageId,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Get message count for a chat
   */
  async getMessageCount(chatId: string): Promise<number> {
    try {
      const messages = await this.getMessages(chatId);
      return messages.length;
    } catch (error) {
      logger.error('Failed to get message count for chat', {
        chatId,
        error: error instanceof Error ? error.message : String(error),
      });
      return 0;
    }
  }

  /**
   * Clear all messages from a chat
   */
  async clearMessages(chatId: string): Promise<boolean> {
    try {
      const messagesCollection = await this.ctx.getMessagesCollection();
      const now = this.ctx.getCurrentTimestamp();

      if (this.ctx.isSQLiteBackend()) {
        // SQLite: Delete all message rows for this chat
        await messagesCollection.deleteMany({ chatId } as QueryFilter);
      } else {
        // Legacy data compatibility: Clear embedded messages array
        await messagesCollection.updateOne(
          { chatId } as QueryFilter,
          {
            $set: {
              messages: [],
              updatedAt: now,
            },
          } as any,
        );
      }

      // Reset metadata
      const chat = await this.ctx.findById(chatId);
      if (chat) {
        await this.ctx.update(chatId, {
          messageCount: 0,
          lastMessageAt: null,
        });
      }

      logger.info('Messages cleared for chat', { chatId });
      return true;
    } catch (error) {
      logger.error('Failed to clear messages for chat', {
        chatId,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }
}
