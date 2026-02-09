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
 *
 * Operations are split into focused modules via composition:
 * - ChatParticipantsOps: participant add/update/remove/query
 * - ChatImpersonationOps: impersonation management
 * - ChatTokenTrackingOps: token usage aggregates
 * - ChatMessagesOps: message CRUD
 * - ChatSearchReplaceOps: text search and replace in messages
 */

import { TaggableBaseRepository, CreateOptions } from './base.repository';
import {
  ChatMetadata,
  ChatMetadataBaseSchema,
  ChatMetadataInput,
  ChatEvent,
  ChatParticipantBase,
  ChatParticipantBaseInput,
} from '@/lib/schemas/types';
import { logger } from '@/lib/logger';
import { TypedQueryFilter, QueryFilter, DatabaseCollection } from '../interfaces';
import { getDatabaseAsync, getBackendType, ensureCollection } from '../manager';
import { ChatOpsContext } from './chats-ops-context';
import { ChatParticipantsOps } from './chats-participants.ops';
import { ChatImpersonationOps } from './chats-impersonation.ops';
import { ChatTokenTrackingOps } from './chats-tokens.ops';
import { ChatMessagesOps, ChatMessageRowSchema } from './chats-messages.ops';
import { ChatSearchReplaceOps } from './chats-search.ops';

/**
 * Chats repository with database abstraction layer backend
 */
export class ChatsRepository extends TaggableBaseRepository<ChatMetadata> {
  private messagesCollectionName = 'chat_messages';
  private messagesCollectionInitialized = false;

  // Ops modules
  private participantsOps: ChatParticipantsOps;
  private impersonationOps: ChatImpersonationOps;
  private tokensOps: ChatTokenTrackingOps;
  private messagesOps: ChatMessagesOps;
  private searchOps: ChatSearchReplaceOps;

  constructor() {
    super('chats', ChatMetadataBaseSchema);

    // Build the shared context from bound methods
    const ctx: ChatOpsContext = {
      findById: this.findById.bind(this),
      update: this.update.bind(this),
      getCollection: this.getCollection.bind(this),
      getMessagesCollection: this.getMessagesCollection.bind(this),
      isSQLiteBackend: this.isSQLiteBackend.bind(this),
      generateId: this.generateId.bind(this),
      getCurrentTimestamp: this.getCurrentTimestamp.bind(this),
    };

    this.participantsOps = new ChatParticipantsOps(ctx);
    this.impersonationOps = new ChatImpersonationOps(ctx);
    this.tokensOps = new ChatTokenTrackingOps(ctx);
    this.messagesOps = new ChatMessagesOps(ctx);
    this.searchOps = new ChatSearchReplaceOps(ctx, this.messagesOps);
  }

  // ============================================================================
  // PRIVATE HELPERS
  // ============================================================================

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
    return this.safeQuery(
      async () => {
        // Ensure collection is initialized with proper schema for JSON column detection
        await this.ensureMessagesCollectionInitialized();

        const db = await getDatabaseAsync();
        return db.getCollection(this.messagesCollectionName);
      },
      'Failed to get chat messages collection',
      { messagesCollection: this.messagesCollectionName }
    );
  }

  // ============================================================================
  // CRUD OPERATIONS
  // ============================================================================

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
    return this.findByFilter({ userId });
  }

  /**
   * Find chats that include a specific character as a participant
   */
  async findByCharacterId(characterId: string): Promise<ChatMetadata[]> {
    return this.safeQuery(
      async () => {
        const chats = await this.findByFilter({
          'participants.characterId': characterId,
        } as TypedQueryFilter<ChatMetadata>);
        return chats;
      },
      'Failed to find chats by character ID',
      { characterId }
    );
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
    return this.safeQuery(
      async () => {
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
      },
      'Failed to create chat',
      {}
    );
  }

  /**
   * Update chat metadata
   * updatedAt is NOT automatically set — only new messages should update it.
   * To update updatedAt, explicitly include it in the data parameter.
   * Background jobs (danger classification, title update, etc.) must NOT
   * pass updatedAt so the chat's modified timestamp reflects the last message.
   */
  async update(id: string, data: Partial<ChatMetadata>): Promise<ChatMetadata | null> {
    // Preserve existing updatedAt unless the caller explicitly provides it
    if (!('updatedAt' in data)) {
      const existing = await this.findById(id);
      if (existing) {
        return this._update(id, { ...data, updatedAt: existing.updatedAt });
      }
    }
    return this._update(id, data);
  }

  /**
   * Delete a chat (removes both metadata and messages)
   */
  async delete(id: string): Promise<boolean> {
    return this.safeQuery(
      async () => {
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
      },
      'Failed to delete chat',
      { chatId: id }
    );
  }

  // ============================================================================
  // TOKEN USAGE TRACKING (delegated to ChatTokenTrackingOps)
  // ============================================================================

  async incrementTokenAggregates(
    chatId: string,
    promptTokens: number,
    completionTokens: number,
    estimatedCost: number | null,
    priceSource?: string
  ): Promise<void> {
    return this.tokensOps.incrementTokenAggregates(chatId, promptTokens, completionTokens, estimatedCost, priceSource);
  }

  async resetTokenAggregates(chatId: string): Promise<ChatMetadata | null> {
    return this.tokensOps.resetTokenAggregates(chatId);
  }

  // ============================================================================
  // PARTICIPANT OPERATIONS (delegated to ChatParticipantsOps)
  // ============================================================================

  async addParticipant(
    chatId: string,
    participant: Omit<ChatParticipantBaseInput, 'id' | 'createdAt' | 'updatedAt'>
  ): Promise<ChatMetadata | null> {
    return this.participantsOps.addParticipant(chatId, participant);
  }

  async updateParticipant(
    chatId: string,
    participantId: string,
    data: Partial<Omit<ChatParticipantBase, 'id' | 'createdAt'>>
  ): Promise<ChatMetadata | null> {
    return this.participantsOps.updateParticipant(chatId, participantId, data);
  }

  async removeParticipant(chatId: string, participantId: string): Promise<ChatMetadata | null> {
    return this.participantsOps.removeParticipant(chatId, participantId);
  }

  getCharacterParticipants(chat: ChatMetadata): ChatParticipantBase[] {
    return this.participantsOps.getCharacterParticipants(chat);
  }

  getActiveParticipants(chat: ChatMetadata): ChatParticipantBase[] {
    return this.participantsOps.getActiveParticipants(chat);
  }

  getLLMControlledParticipants(chat: ChatMetadata): ChatParticipantBase[] {
    return this.participantsOps.getLLMControlledParticipants(chat);
  }

  getUserControlledParticipants(chat: ChatMetadata): ChatParticipantBase[] {
    return this.participantsOps.getUserControlledParticipants(chat);
  }

  // ============================================================================
  // IMPERSONATION OPERATIONS (delegated to ChatImpersonationOps)
  // ============================================================================

  async addImpersonation(chatId: string, participantId: string): Promise<ChatMetadata | null> {
    return this.impersonationOps.addImpersonation(chatId, participantId);
  }

  async removeImpersonation(chatId: string, participantId: string): Promise<ChatMetadata | null> {
    return this.impersonationOps.removeImpersonation(chatId, participantId);
  }

  async getImpersonatedParticipantIds(chatId: string): Promise<string[]> {
    return this.impersonationOps.getImpersonatedParticipantIds(chatId);
  }

  async setActiveTypingParticipant(chatId: string, participantId: string | null): Promise<ChatMetadata | null> {
    return this.impersonationOps.setActiveTypingParticipant(chatId, participantId);
  }

  async updateAllLLMPauseTurnCount(chatId: string, count: number): Promise<ChatMetadata | null> {
    return this.impersonationOps.updateAllLLMPauseTurnCount(chatId, count);
  }

  // ============================================================================
  // MESSAGE OPERATIONS (delegated to ChatMessagesOps)
  // ============================================================================

  async getMessages(chatId: string): Promise<ChatEvent[]> {
    return this.messagesOps.getMessages(chatId);
  }

  async addMessage(chatId: string, message: ChatEvent): Promise<ChatEvent> {
    return this.messagesOps.addMessage(chatId, message);
  }

  async addMessages(chatId: string, messages: ChatEvent[]): Promise<ChatEvent[]> {
    return this.messagesOps.addMessages(chatId, messages);
  }

  async updateMessage(chatId: string, messageId: string, updates: Partial<ChatEvent>): Promise<ChatEvent | null> {
    return this.messagesOps.updateMessage(chatId, messageId, updates);
  }

  async getMessageCount(chatId: string): Promise<number> {
    return this.messagesOps.getMessageCount(chatId);
  }

  async clearMessages(chatId: string): Promise<boolean> {
    return this.messagesOps.clearMessages(chatId);
  }

  // ============================================================================
  // SEARCH AND REPLACE OPERATIONS (delegated to ChatSearchReplaceOps)
  // ============================================================================

  async countMessagesWithText(chatId: string, searchText: string): Promise<number> {
    return this.searchOps.countMessagesWithText(chatId, searchText);
  }

  async findMessagesWithText(
    chatId: string,
    searchText: string
  ): Promise<Array<{ messageId: string; content: string; chatId: string }>> {
    return this.searchOps.findMessagesWithText(chatId, searchText);
  }

  async replaceInMessages(
    chatId: string,
    searchText: string,
    replaceText: string
  ): Promise<number> {
    return this.searchOps.replaceInMessages(chatId, searchText, replaceText);
  }
}

// Export singleton instance
export const chatsRepository = new ChatsRepository();
