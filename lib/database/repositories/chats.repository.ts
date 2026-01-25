/**
 * Chats Repository
 *
 * Backend-agnostic repository for Chat metadata and messages.
 * Works with SQLite through the database abstraction layer.
 *
 * Handles CRUD operations for Chat metadata and messages using two collections:
 * - 'chats': stores ChatMetadata documents
 * - 'chat_messages': stores messages as individual rows (SQLite) or embedded arrays (legacy data)
 *
 * Chats use a participant-based model where each chat has an array of
 * ChatParticipant objects. All participants are CHARACTER type (user-controlled
 * characters have controlledBy: 'user'). Each CHARACTER participant has its own
 * connectionProfileId and optional imageProfileId.
 */

import { z } from 'zod';
import { TaggableBaseRepository, CreateOptions } from './base.repository';
import {
  ChatMetadata,
  ChatMetadataBaseSchema,
  ChatMetadataInput,
  ChatEvent,
  ChatEventSchema,
  ChatParticipantBase,
  ChatParticipantBaseInput,
  ChatParticipantBaseSchema,
} from '@/lib/schemas/types';
import { UUIDSchema, TimestampSchema, JsonSchema, RoleEnum } from '@/lib/schemas/common.types';
import { logger } from '@/lib/logger';
import { QueryFilter, DatabaseCollection, SortSpec } from '../interfaces';
import { getDatabaseAsync, getBackendType, ensureCollection } from '../manager';

/**
 * Schema for individual chat message rows in SQLite
 * This schema represents the flattened message format with chatId added
 * for the normalized SQLite storage pattern
 */
const ChatMessageRowSchema = z.object({
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

/**
 * Chats repository with database abstraction layer backend
 */
export class ChatsRepository extends TaggableBaseRepository<ChatMetadata> {
  private messagesCollectionName = 'chat_messages';
  private messagesCollectionInitialized = false;

  constructor() {
    super('chats', ChatMetadataBaseSchema);
  }

  /**
   * Check if using SQLite backend (normalized messages) vs legacy embedded array format
   */
  private isSQLiteBackend(): boolean {
    return getBackendType() === 'sqlite';
  }

  /**
   * Ensure the messages collection is initialized with proper schema (for SQLite JSON column detection)
   */
  private async ensureMessagesCollectionInitialized(): Promise<void> {
    if (this.messagesCollectionInitialized) {
      return;
    }

    try {
      // Ensure collection is initialized with proper schema for JSON column detection
      if (this.isSQLiteBackend()) {
        await ensureCollection(this.messagesCollectionName, ChatMessageRowSchema);
      }
      this.messagesCollectionInitialized = true;
    } catch (error) {
      logger.error('Failed to ensure chat_messages collection', {
        error: error instanceof Error ? error.message : String(error),
      });
      // Don't throw - allow continued operation even if schema setup fails
    }
  }

  /**
   * Get the messages collection
   */
  private async getMessagesCollection(): Promise<DatabaseCollection> {
    try {
      // Ensure collection is initialized with proper schema for JSON column detection
      await this.ensureMessagesCollectionInitialized();

      const db = await getDatabaseAsync();
      return db.getCollection(this.messagesCollectionName);
    } catch (error) {
      logger.error('Failed to get chat messages collection', {
        collection: this.messagesCollectionName,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Find a chat by ID (metadata only)
   */
  async findById(id: string): Promise<ChatMetadata | null> {
    return this._findById(id);
  }

  /**
   * Find all chats
   */
  async findAll(): Promise<ChatMetadata[]> {
    return this._findAll();
  }

  /**
   * Find chats by user ID
   */
  async findByUserId(userId: string): Promise<ChatMetadata[]> {
    return this.findByFilter({ userId } as QueryFilter);
  }

  /**
   * Find chats that include a specific character as a participant
   */
  async findByCharacterId(characterId: string): Promise<ChatMetadata[]> {
    try {
      const chats = await this.findByFilter({
        'participants.characterId': characterId,
      } as QueryFilter);
      return chats;
    } catch (error) {
      logger.error('Failed to find chats by character ID', {
        characterId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Create a new chat
   * @param data The chat data (without id, createdAt, updatedAt). Fields with defaults are optional.
   * @param options Optional CreateOptions to specify ID and createdAt (for sync)
   */
  async create(
    data: Omit<ChatMetadataInput, 'id' | 'createdAt' | 'updatedAt'>,
    options?: CreateOptions
  ): Promise<ChatMetadata> {
    try {
      // Ensure required defaults for ChatMetadata from ChatMetadataInput
      const chatData = {
        ...data,
        tags: data.tags ?? [],
        participants: data.participants ?? [],
        impersonatingParticipantIds: data.impersonatingParticipantIds ?? [],
      } as Omit<ChatMetadata, 'id' | 'createdAt' | 'updatedAt'>;

      const chat = await this._create(chatData, options);

      // Legacy data compatibility: Create empty messages document for backward compat (not needed for SQLite - messages are individual rows)
      if (!this.isSQLiteBackend()) {
        try {
          const messagesCollection = await this.getMessagesCollection();
          const now = this.getCurrentTimestamp();

          const messagesDoc = {
            chatId: chat.id,
            messages: [],
            createdAt: now,
            updatedAt: now,
          };

          await messagesCollection.insertOne(messagesDoc as any);
        } catch (error) {
          logger.warn('Failed to create chat messages collection', {
            chatId: chat.id,
            error: error instanceof Error ? error.message : String(error),
          });
          // Don't fail the chat creation if messages collection creation fails
        }
      }

      logger.info('Chat created successfully', {
        chatId: chat.id,
        userId: data.userId,
        title: data.title,
      });

      return chat;
    } catch (error) {
      logger.error('Failed to create chat', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Update chat metadata
   * Note: updatedAt is NOT automatically set. Only new messages should update updatedAt.
   * To update updatedAt, explicitly include it in the data parameter.
   */
  async update(id: string, data: Partial<ChatMetadata>): Promise<ChatMetadata | null> {
    return this._update(id, data);
  }

  /**
   * Delete a chat (removes both metadata and messages)
   */
  async delete(id: string): Promise<boolean> {
    try {
      const result = await this._delete(id);

      if (!result) {
        return false;
      }

      // Delete messages
      try {
        const messagesCollection = await this.getMessagesCollection();
        if (this.isSQLiteBackend()) {
          // SQLite: Delete all message rows for this chat
          await messagesCollection.deleteMany({ chatId: id } as QueryFilter);
        } else {
          // Legacy data compatibility: Delete the single messages document
          await messagesCollection.deleteOne({ chatId: id } as QueryFilter);
        }
      } catch (error) {
        logger.warn('Failed to delete chat messages', {
          chatId: id,
          error: error instanceof Error ? error.message : String(error),
        });
      }

      logger.info('Chat deleted', { chatId: id });
      return true;
    } catch (error) {
      logger.error('Failed to delete chat', {
        chatId: id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  // ============================================================================
  // TOKEN USAGE TRACKING
  // ============================================================================

  /**
   * Increment token aggregate counters for a chat
   * Uses atomic $inc operations for thread safety
   */
  async incrementTokenAggregates(
    chatId: string,
    promptTokens: number,
    completionTokens: number,
    estimatedCost: number | null,
    priceSource?: string
  ): Promise<void> {
    try {
      const collection = await this.getCollection();
      const now = this.getCurrentTimestamp();

      // Build update operations
      const updateOps: Record<string, unknown> = {
        $inc: {
          totalPromptTokens: promptTokens,
          totalCompletionTokens: completionTokens,
        },
        $set: { updatedAt: now },
      };

      // If we have a cost to add, we need special handling
      if (estimatedCost !== null && estimatedCost > 0) {
        // Update estimatedCostUSD if it exists, or set it if it doesn't
        const existing = await this.findById(chatId);
        if (existing) {
          const currentCost = existing.estimatedCostUSD || 0;
          (updateOps.$set as Record<string, unknown>).estimatedCostUSD = currentCost + estimatedCost;

          // Add priceSource if provided
          if (priceSource) {
            (updateOps.$set as Record<string, unknown>).priceSource = priceSource;
          }
        }
      }

      const result = await collection.updateOne(
        { id: chatId } as QueryFilter,
        updateOps as any
      );

      if (result.matchedCount === 0) {
        logger.warn('Chat not found for token aggregates increment', { chatId });
        return;
      }
    } catch (error) {
      logger.error('Error incrementing token aggregates', {
        chatId,
        promptTokens,
        completionTokens,
        error: error instanceof Error ? error.message : String(error),
      });
      // Don't throw - token tracking failures shouldn't break message flow
    }
  }

  /**
   * Reset token aggregate counters for a chat
   */
  async resetTokenAggregates(chatId: string): Promise<ChatMetadata | null> {
    try {
      return await this.update(chatId, {
        totalPromptTokens: 0,
        totalCompletionTokens: 0,
        estimatedCostUSD: null,
      });
    } catch (error) {
      logger.error('Error resetting token aggregates', {
        chatId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  // ============================================================================
  // PARTICIPANT OPERATIONS
  // ============================================================================

  /**
   * Add a participant to a chat
   * @param chatId The chat ID
   * @param participant The participant data (without id, createdAt, updatedAt). Fields with defaults are optional.
   */
  async addParticipant(
    chatId: string,
    participant: Omit<ChatParticipantBaseInput, 'id' | 'createdAt' | 'updatedAt'>
  ): Promise<ChatMetadata | null> {
    try {
      const chat = await this.findById(chatId);
      if (!chat) {
        return null;
      }

      const now = this.getCurrentTimestamp();
      const participantInput = {
        ...participant,
        id: this.generateId(),
        createdAt: now,
        updatedAt: now,
      };

      // Validate the participant (this applies defaults like hasHistoryAccess)
      const newParticipant = ChatParticipantBaseSchema.parse(participantInput);

      const participants = [...chat.participants, newParticipant];

      // If adding a user-controlled participant, automatically add to impersonating array
      const updateData: Partial<ChatMetadata> = { participants };
      if (newParticipant.controlledBy === 'user') {
        const impersonatingIds = [...(chat.impersonatingParticipantIds || [])];
        if (!impersonatingIds.includes(newParticipant.id)) {
          impersonatingIds.push(newParticipant.id);
        }
        updateData.impersonatingParticipantIds = impersonatingIds;

        // If no active typing participant, set this one
        if (!chat.activeTypingParticipantId) {
          updateData.activeTypingParticipantId = newParticipant.id;
        }
      }

      return await this.update(chatId, updateData);
    } catch (error) {
      logger.error('Failed to add participant to chat', {
        chatId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Update a participant in a chat
   */
  async updateParticipant(
    chatId: string,
    participantId: string,
    data: Partial<Omit<ChatParticipantBase, 'id' | 'createdAt'>>
  ): Promise<ChatMetadata | null> {
    try {
      const chat = await this.findById(chatId);
      if (!chat) {
        return null;
      }

      const participantIndex = chat.participants.findIndex(p => p.id === participantId);
      if (participantIndex === -1) {
        return null;
      }

      const now = this.getCurrentTimestamp();
      const existingParticipant = chat.participants[participantIndex];
      const updatedParticipant: ChatParticipantBase = {
        ...existingParticipant,
        ...data,
        id: existingParticipant.id,
        createdAt: existingParticipant.createdAt,
        updatedAt: now,
      };

      // Validate the updated participant
      ChatParticipantBaseSchema.parse(updatedParticipant);

      const participants = [...chat.participants];
      participants[participantIndex] = updatedParticipant;

      return await this.update(chatId, { participants });
    } catch (error) {
      logger.error('Failed to update participant in chat', {
        chatId,
        participantId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Remove a participant from a chat
   */
  async removeParticipant(chatId: string, participantId: string): Promise<ChatMetadata | null> {
    try {
      const chat = await this.findById(chatId);
      if (!chat) {
        return null;
      }

      const participants = chat.participants.filter(p => p.id !== participantId);

      // Don't allow removing all participants
      if (participants.length === 0) {
        const error = new Error('Cannot remove the last participant from a chat');
        logger.error('Cannot remove last participant', { chatId, participantId });
        throw error;
      }

      return await this.update(chatId, { participants });
    } catch (error) {
      logger.error('Failed to remove participant from chat', {
        chatId,
        participantId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Get all character participants from a chat
   */
  getCharacterParticipants(chat: ChatMetadata): ChatParticipantBase[] {
    return chat.participants.filter(p => p.type === 'CHARACTER');
  }

  /**
   * Get active participants only
   */
  getActiveParticipants(chat: ChatMetadata): ChatParticipantBase[] {
    return chat.participants.filter(p => p.isActive);
  }

  /**
   * Get LLM-controlled participants (controlledBy === 'llm')
   */
  getLLMControlledParticipants(chat: ChatMetadata): ChatParticipantBase[] {
    const participants = chat.participants.filter(p => p.controlledBy === 'llm');
    return participants;
  }

  /**
   * Get user-controlled participants (controlledBy === 'user')
   */
  getUserControlledParticipants(chat: ChatMetadata): ChatParticipantBase[] {
    const participants = chat.participants.filter(p => p.controlledBy === 'user');
    return participants;
  }

  // ============================================================================
  // IMPERSONATION OPERATIONS
  // ============================================================================

  /**
   * Add impersonation for a participant
   * @param chatId The chat ID
   * @param participantId The participant ID to impersonate
   * @returns Updated chat metadata
   */
  async addImpersonation(chatId: string, participantId: string): Promise<ChatMetadata | null> {
    try {
      const chat = await this.findById(chatId);
      if (!chat) {
        return null;
      }

      // Verify participant exists
      const participant = chat.participants.find(p => p.id === participantId);
      if (!participant) {
        return null;
      }

      // Add to impersonating array if not already there
      const impersonatingIds = chat.impersonatingParticipantIds || [];
      if (!impersonatingIds.includes(participantId)) {
        impersonatingIds.push(participantId);
      }

      // Set as active typing participant if none set
      const activeTyping = chat.activeTypingParticipantId || participantId;

      return await this.update(chatId, {
        impersonatingParticipantIds: impersonatingIds,
        activeTypingParticipantId: activeTyping,
      });
    } catch (error) {
      logger.error('Failed to add impersonation', {
        chatId,
        participantId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Remove impersonation for a participant
   * @param chatId The chat ID
   * @param participantId The participant ID to stop impersonating
   * @returns Updated chat metadata
   */
  async removeImpersonation(chatId: string, participantId: string): Promise<ChatMetadata | null> {
    try {
      const chat = await this.findById(chatId);
      if (!chat) {
        return null;
      }

      // Remove from impersonating array
      const impersonatingIds = (chat.impersonatingParticipantIds || []).filter(id => id !== participantId);

      // Clear active typing if it was this participant
      let activeTyping = chat.activeTypingParticipantId;
      if (activeTyping === participantId) {
        activeTyping = impersonatingIds.length > 0 ? impersonatingIds[0] : null;
      }

      return await this.update(chatId, {
        impersonatingParticipantIds: impersonatingIds,
        activeTypingParticipantId: activeTyping,
      });
    } catch (error) {
      logger.error('Failed to remove impersonation', {
        chatId,
        participantId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Get impersonated participant IDs
   * @param chatId The chat ID
   * @returns Array of participant IDs being impersonated
   */
  async getImpersonatedParticipantIds(chatId: string): Promise<string[]> {
    try {
      const chat = await this.findById(chatId);
      if (!chat) {
        return [];
      }

      return chat.impersonatingParticipantIds || [];
    } catch (error) {
      logger.error('Failed to get impersonated participant IDs', {
        chatId,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Set the active typing participant (for multi-character impersonation)
   * @param chatId The chat ID
   * @param participantId The participant ID (or null to clear)
   * @returns Updated chat metadata
   */
  async setActiveTypingParticipant(chatId: string, participantId: string | null): Promise<ChatMetadata | null> {
    try {
      const chat = await this.findById(chatId);
      if (!chat) {
        return null;
      }

      // Verify participant is being impersonated if setting a value
      if (participantId) {
        const impersonatingIds = chat.impersonatingParticipantIds || [];
        if (!impersonatingIds.includes(participantId)) {
          logger.warn('Participant not being impersonated', { chatId, participantId });
          return null;
        }
      }

      return await this.update(chatId, {
        activeTypingParticipantId: participantId,
      });
    } catch (error) {
      logger.error('Failed to set active typing participant', {
        chatId,
        participantId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Update the all-LLM pause turn count
   * @param chatId The chat ID
   * @param count The turn count
   * @returns Updated chat metadata
   */
  async updateAllLLMPauseTurnCount(chatId: string, count: number): Promise<ChatMetadata | null> {
    try {
      return await this.update(chatId, {
        allLLMPauseTurnCount: count,
      });
    } catch (error) {
      logger.error('Failed to update all-LLM pause turn count', {
        chatId,
        count,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  // ============================================================================
  // MESSAGE OPERATIONS
  // ============================================================================

  /**
   * Get all messages for a chat
   */
  async getMessages(chatId: string): Promise<ChatEvent[]> {
    try {
      const messagesCollection = await this.getMessagesCollection();

      if (this.isSQLiteBackend()) {
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
      const messagesCollection = await this.getMessagesCollection();
      const now = this.getCurrentTimestamp();

      if (this.isSQLiteBackend()) {
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

      // Update chat metadata with message count, last message timestamp, and updatedAt
      const chat = await this.findById(chatId);
      if (chat) {
        const messages = await this.getMessages(chatId);
        await this.update(chatId, {
          messageCount: messages.length,
          lastMessageAt: now,
          updatedAt: now,
        });
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
      const messagesCollection = await this.getMessagesCollection();
      const now = this.getCurrentTimestamp();

      if (this.isSQLiteBackend()) {
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

      // Update chat metadata with message count, last message timestamp, and updatedAt
      const chat = await this.findById(chatId);
      if (chat) {
        const allMessages = await this.getMessages(chatId);
        await this.update(chatId, {
          messageCount: allMessages.length,
          lastMessageAt: now,
          updatedAt: now,
        });
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
      const messagesCollection = await this.getMessagesCollection();
      const now = this.getCurrentTimestamp();

      if (this.isSQLiteBackend()) {
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

  // ============================================================================
  // SEARCH AND REPLACE OPERATIONS
  // ============================================================================

  /**
   * Count messages containing specific text in a chat
   * @param chatId The chat ID
   * @param searchText Text to search for
   * @returns Number of messages containing the text
   */
  async countMessagesWithText(chatId: string, searchText: string): Promise<number> {
    try {
      const messages = await this.getMessages(chatId);
      let count = 0;

      for (const msg of messages) {
        if (msg.type === 'message' && msg.content.includes(searchText)) {
          count++;
        }
      }
      return count;
    } catch (error) {
      logger.error('Failed to count messages with text', {
        chatId,
        error: error instanceof Error ? error.message : String(error),
      });
      return 0;
    }
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
    try {
      const messages = await this.getMessages(chatId);
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
    } catch (error) {
      logger.error('Failed to find messages with text', {
        chatId,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
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
    try {
      const messages = await this.getMessages(chatId);
      let updatedCount = 0;
      const messagesCollection = await this.getMessagesCollection();

      if (this.isSQLiteBackend()) {
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
          const now = this.getCurrentTimestamp();

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
    } catch (error) {
      logger.error('Failed to replace text in messages', {
        chatId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Clear all messages from a chat
   */
  async clearMessages(chatId: string): Promise<boolean> {
    try {
      const messagesCollection = await this.getMessagesCollection();
      const now = this.getCurrentTimestamp();

      if (this.isSQLiteBackend()) {
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
      const chat = await this.findById(chatId);
      if (chat) {
        await this.update(chatId, {
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

// Export singleton instance
export const chatsRepository = new ChatsRepository();
