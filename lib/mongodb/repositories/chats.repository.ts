/**
 * MongoDB Chats Repository
 *
 * Handles CRUD operations for Chat metadata and messages using MongoDB.
 * Uses two collections:
 * - 'chats': stores ChatMetadata documents
 * - 'chat_messages': stores messages as { chatId, messages: ChatEvent[] }
 *
 * Chats use a participant-based model where each chat has an array of
 * ChatParticipant objects. Participants can be either CHARACTER (AI) or
 * PERSONA (user representation). Each CHARACTER participant has its own
 * connectionProfileId and optional imageProfileId.
 */

import { Collection, Filter } from 'mongodb';
import { z } from 'zod';
import { MongoBaseRepository, CreateOptions } from './base.repository';
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
import { logger } from '@/lib/logger';

/**
 * Chats repository with MongoDB backend
 */
export class MongoChatsRepository extends MongoBaseRepository<ChatMetadata> {
  private messagesCollectionName = 'chat_messages';

  constructor() {
    super('chats', ChatMetadataBaseSchema);
  }

  /**
   * Get the messages collection
   */
  private async getMessagesCollection(): Promise<Collection> {
    try {
      const db = await (this as any).getCollection(); // Reuse parent's getCollection pattern
      const dbInstance = (await (this as any).getCollection()).db;
      return dbInstance.collection(this.messagesCollectionName);
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
    try {
      const collection = await (this as any).getCollection();
      const chat = await collection.findOne({ id });

      if (!chat) {
        logger.debug('Chat not found', { chatId: id });
        return null;
      }

      return this.validate(chat);
    } catch (error) {
      logger.error('Failed to find chat by ID', {
        chatId: id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Find all chats
   */
  async findAll(): Promise<ChatMetadata[]> {
    try {
      const collection = await (this as any).getCollection();
      const chats = await collection.find({}).toArray();
      return chats.map((chat: unknown) => this.validate(chat));
    } catch (error) {
      logger.error('Failed to find all chats', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Find chats by user ID
   */
  async findByUserId(userId: string): Promise<ChatMetadata[]> {
    try {
      const collection = await (this as any).getCollection();
      const chats = await collection.find({ userId }).toArray();
      return chats.map((chat: unknown) => this.validate(chat));
    } catch (error) {
      logger.error('Failed to find chats by user ID', {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Find chats that include a specific character as a participant
   */
  async findByCharacterId(characterId: string): Promise<ChatMetadata[]> {
    try {
      const collection = await (this as any).getCollection();
      const chats = await collection.find({
        'participants.type': 'CHARACTER',
        'participants.characterId': characterId,
      }).toArray();
      return chats.map((chat: unknown) => this.validate(chat));
    } catch (error) {
      logger.error('Failed to find chats by character ID', {
        characterId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Find chats that include a specific persona as a participant
   */
  async findByPersonaId(personaId: string): Promise<ChatMetadata[]> {
    try {
      const collection = await (this as any).getCollection();
      const chats = await collection.find({
        'participants.type': 'PERSONA',
        'participants.personaId': personaId,
      }).toArray();
      return chats.map((chat: unknown) => this.validate(chat));
    } catch (error) {
      logger.error('Failed to find chats by persona ID', {
        personaId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Find chats with a specific tag
   */
  async findByTag(tagId: string): Promise<ChatMetadata[]> {
    try {
      const collection = await (this as any).getCollection();
      const chats = await collection.find({ tags: tagId }).toArray();
      return chats.map((chat: unknown) => this.validate(chat));
    } catch (error) {
      logger.error('Failed to find chats by tag', {
        tagId,
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

      const id = options?.id || (this as any).generateId();
      const now = (this as any).getCurrentTimestamp();
      const createdAt = options?.createdAt || now;

      const chatInput = {
        ...data,
        id,
        createdAt,
        updatedAt: now,
      };

      // Parse through schema to apply defaults
      const validated = this.validate(chatInput);
      const collection = await (this as any).getCollection();

      // Insert into chats collection
      await collection.insertOne(validated as any);

      // Create empty messages document
      const messagesDoc = {
        chatId: id,
        messages: [],
        createdAt: now,
        updatedAt: now,
      };

      const messagesCollection = await (this as any).getCollection();
      const msgDb = messagesCollection.db;
      await msgDb.collection(this.messagesCollectionName).insertOne(messagesDoc);

      logger.info('Chat created successfully', {
        chatId: id,
        userId: data.userId,
        title: data.title,
      });

      return validated;
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
    try {
      const collection = await (this as any).getCollection();

      // Prepare update data, excluding id and createdAt
      const { id: _id, createdAt: _createdAt, ...updateFields } = data as Record<string, unknown>;

      // If no fields to update, just return current state
      if (Object.keys(updateFields).length === 0) {
        return this.findById(id);
      }

      const updateData = {
        $set: updateFields,
      };

      const result = await collection.findOneAndUpdate(
        { id } as Filter<ChatMetadata>,
        updateData,
        { returnDocument: 'after' }
      );

      if (!result) {
        logger.debug('Chat not found for update', { chatId: id });
        return null;
      }

      return this.validate(result);
    } catch (error) {
      logger.error('Failed to update chat', {
        chatId: id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Delete a chat (removes both metadata and messages)
   */
  async delete(id: string): Promise<boolean> {
    try {
      const collection = await (this as any).getCollection();
      const result = await collection.deleteOne({ id } as Filter<ChatMetadata>);

      if (result.deletedCount === 0) {
        logger.debug('Chat not found for deletion', { chatId: id });
        return false;
      }

      // Delete messages document
      try {
        const messagesCollection = await (this as any).getCollection();
        const msgDb = messagesCollection.db;
        await msgDb.collection(this.messagesCollectionName).deleteOne({ chatId: id });
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
    estimatedCost: number | null
  ): Promise<void> {
    try {
      logger.debug('Incrementing token aggregates for chat', {
        chatId,
        promptTokens,
        completionTokens,
        estimatedCost,
      });

      const collection = await (this as any).getCollection();
      const now = this.getCurrentTimestamp();

      // Build update operations
      const incOps: Record<string, number> = {
        totalPromptTokens: promptTokens,
        totalCompletionTokens: completionTokens,
      };

      // For estimated cost, we need special handling since we can't $inc with null
      const updateOps: Record<string, unknown> = {
        $inc: incOps,
        $set: { updatedAt: now },
      };

      // If we have a cost to add, we need to handle the case where estimatedCostUSD might be null
      if (estimatedCost !== null && estimatedCost > 0) {
        // Use aggregation pipeline update for conditional cost increment
        const result = await collection.updateOne(
          { id: chatId },
          [
            {
              $set: {
                totalPromptTokens: { $add: ['$totalPromptTokens', promptTokens] },
                totalCompletionTokens: { $add: ['$totalCompletionTokens', completionTokens] },
                estimatedCostUSD: {
                  $add: [
                    { $ifNull: ['$estimatedCostUSD', 0] },
                    estimatedCost,
                  ],
                },
                updatedAt: now,
              },
            },
          ]
        );

        if (result.matchedCount === 0) {
          logger.warn('Chat not found for token aggregates increment', { chatId });
          return;
        }
      } else {
        // No cost to add, just increment tokens
        const result = await collection.updateOne(
          { id: chatId } as Filter<ChatMetadata>,
          updateOps
        );

        if (result.matchedCount === 0) {
          logger.warn('Chat not found for token aggregates increment', { chatId });
          return;
        }
      }

      logger.debug('Token aggregates incremented successfully', {
        chatId,
        promptTokens,
        completionTokens,
        estimatedCost,
      });
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
      logger.debug('Resetting token aggregates for chat', { chatId });

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
  // TAG OPERATIONS
  // ============================================================================

  /**
   * Add a tag to a chat
   */
  async addTag(chatId: string, tagId: string): Promise<ChatMetadata | null> {
    try {
      logger.debug('Adding tag to chat', { chatId, tagId });

      const chat = await this.findById(chatId);
      if (!chat) {
        logger.debug('Chat not found for tag operation', { chatId });
        return null;
      }

      if (!chat.tags.includes(tagId)) {
        const updatedTags = [...chat.tags, tagId];
        return await this.update(chatId, { tags: updatedTags });
      }

      return chat;
    } catch (error) {
      logger.error('Failed to add tag to chat', {
        chatId,
        tagId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Remove a tag from a chat
   */
  async removeTag(chatId: string, tagId: string): Promise<ChatMetadata | null> {
    try {
      logger.debug('Removing tag from chat', { chatId, tagId });

      const chat = await this.findById(chatId);
      if (!chat) {
        logger.debug('Chat not found for tag operation', { chatId });
        return null;
      }

      const updatedTags = chat.tags.filter(tid => tid !== tagId);
      return await this.update(chatId, { tags: updatedTags });
    } catch (error) {
      logger.error('Failed to remove tag from chat', {
        chatId,
        tagId,
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
      logger.debug('Adding participant to chat', {
        chatId,
        type: participant.type,
        characterId: participant.characterId,
        personaId: participant.personaId,
      });

      const chat = await this.findById(chatId);
      if (!chat) {
        logger.debug('Chat not found for participant operation', { chatId });
        return null;
      }

      const now = (this as any).getCurrentTimestamp();
      const participantInput = {
        ...participant,
        id: (this as any).generateId(),
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

        logger.debug('Auto-adding user-controlled participant to impersonation', {
          chatId,
          participantId: newParticipant.id,
          impersonatingCount: impersonatingIds.length,
        });
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
      logger.debug('Updating participant in chat', { chatId, participantId });

      const chat = await this.findById(chatId);
      if (!chat) {
        logger.debug('Chat not found for participant operation', { chatId });
        return null;
      }

      const participantIndex = chat.participants.findIndex(p => p.id === participantId);
      if (participantIndex === -1) {
        logger.debug('Participant not found', { chatId, participantId });
        return null;
      }

      const now = (this as any).getCurrentTimestamp();
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
      logger.debug('Removing participant from chat', { chatId, participantId });

      const chat = await this.findById(chatId);
      if (!chat) {
        logger.debug('Chat not found for participant operation', { chatId });
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
    logger.debug('Getting character participants', {
      chatId: chat.id,
      count: chat.participants.filter(p => p.type === 'CHARACTER').length,
    });
    return chat.participants.filter(p => p.type === 'CHARACTER');
  }

  /**
   * Get all persona participants from a chat
   */
  getPersonaParticipants(chat: ChatMetadata): ChatParticipantBase[] {
    logger.debug('Getting persona participants', {
      chatId: chat.id,
      count: chat.participants.filter(p => p.type === 'PERSONA').length,
    });
    return chat.participants.filter(p => p.type === 'PERSONA');
  }

  /**
   * Get active participants only
   */
  getActiveParticipants(chat: ChatMetadata): ChatParticipantBase[] {
    logger.debug('Getting active participants', {
      chatId: chat.id,
      count: chat.participants.filter(p => p.isActive).length,
    });
    return chat.participants.filter(p => p.isActive);
  }

  /**
   * Get LLM-controlled participants (controlledBy === 'llm')
   */
  getLLMControlledParticipants(chat: ChatMetadata): ChatParticipantBase[] {
    const participants = chat.participants.filter(p => p.controlledBy === 'llm');
    logger.debug('Getting LLM-controlled participants', {
      chatId: chat.id,
      count: participants.length,
    });
    return participants;
  }

  /**
   * Get user-controlled participants (controlledBy === 'user')
   */
  getUserControlledParticipants(chat: ChatMetadata): ChatParticipantBase[] {
    const participants = chat.participants.filter(p => p.controlledBy === 'user');
    logger.debug('Getting user-controlled participants', {
      chatId: chat.id,
      count: participants.length,
    });
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
      logger.debug('Adding impersonation', { chatId, participantId });

      const chat = await this.findById(chatId);
      if (!chat) {
        logger.debug('Chat not found for impersonation', { chatId });
        return null;
      }

      // Verify participant exists
      const participant = chat.participants.find(p => p.id === participantId);
      if (!participant) {
        logger.debug('Participant not found for impersonation', { chatId, participantId });
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
      logger.debug('Removing impersonation', { chatId, participantId });

      const chat = await this.findById(chatId);
      if (!chat) {
        logger.debug('Chat not found for impersonation removal', { chatId });
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
      logger.debug('Getting impersonated participant IDs', { chatId });

      const chat = await this.findById(chatId);
      if (!chat) {
        logger.debug('Chat not found', { chatId });
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
      logger.debug('Setting active typing participant', { chatId, participantId });

      const chat = await this.findById(chatId);
      if (!chat) {
        logger.debug('Chat not found', { chatId });
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
      logger.debug('Updating all-LLM pause turn count', { chatId, count });

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
      const collection = await (this as any).getCollection();
      const msgDb = collection.db;
      const messagesCollection = msgDb.collection(this.messagesCollectionName);

      const messagesDoc = await messagesCollection.findOne({ chatId });

      if (!messagesDoc) {
        return [];
      }

      const messages = (messagesDoc as any).messages || [];
      return messages.map((msg: any) => ChatEventSchema.parse(msg));
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
      logger.debug('Adding message to chat', {
        chatId,
        messageId: message.id,
        type: message.type,
      });

      const validated = ChatEventSchema.parse(message);
      const collection = await (this as any).getCollection();
      const msgDb = collection.db;
      const messagesCollection = msgDb.collection(this.messagesCollectionName);

      const now = (this as any).getCurrentTimestamp();

      // Use updateOne with upsert to handle both creating and updating messages document
      await messagesCollection.updateOne(
        { chatId },
        {
          $push: { messages: validated },
          $set: { updatedAt: now },
        },
        { upsert: true }
      );

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

      logger.debug('Message added to chat', { chatId, messageId: message.id });
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
      logger.debug('Adding messages to chat', {
        chatId,
        count: messages.length,
      });

      const validated = messages.map(msg => ChatEventSchema.parse(msg));
      const collection = await (this as any).getCollection();
      const msgDb = collection.db;
      const messagesCollection = msgDb.collection(this.messagesCollectionName);

      const now = (this as any).getCurrentTimestamp();

      // Use updateOne with upsert to handle both creating and updating messages document
      await messagesCollection.updateOne(
        { chatId },
        {
          $push: { messages: { $each: validated } },
          $set: { updatedAt: now },
        },
        { upsert: true }
      );

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

      logger.debug('Messages added to chat', { chatId, count: validated.length });
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
      logger.debug('Updating message in chat', { chatId, messageId });

      const messages = await this.getMessages(chatId);
      const messageIndex = messages.findIndex(m => m.id === messageId);

      if (messageIndex === -1) {
        logger.debug('Message not found', { chatId, messageId });
        return null;
      }

      // Merge updates with existing message
      const updatedMessage = { ...messages[messageIndex], ...updates };
      const validated = ChatEventSchema.parse(updatedMessage);

      // Replace message in array
      messages[messageIndex] = validated;

      const collection = await (this as any).getCollection();
      const msgDb = collection.db;
      const messagesCollection = msgDb.collection(this.messagesCollectionName);

      const now = (this as any).getCurrentTimestamp();

      // Update entire messages array
      await messagesCollection.updateOne(
        { chatId },
        {
          $set: {
            messages: messages,
            updatedAt: now,
          },
        }
      );

      logger.debug('Message updated in chat', { chatId, messageId });
      return validated;
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
      logger.debug('Counting messages with text', { chatId, searchTextLength: searchText.length });

      const messages = await this.getMessages(chatId);
      let count = 0;

      for (const msg of messages) {
        if (msg.type === 'message' && msg.content.includes(searchText)) {
          count++;
        }
      }

      logger.debug('Counted messages with text', { chatId, count });
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
      logger.debug('Finding messages with text', { chatId, searchTextLength: searchText.length });

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

      logger.debug('Found messages with text', { chatId, matchCount: matches.length });
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
      logger.debug('Replacing text in messages', {
        chatId,
        searchTextLength: searchText.length,
        replaceTextLength: replaceText.length,
      });

      const messages = await this.getMessages(chatId);
      let updatedCount = 0;
      let hasChanges = false;

      // Process each message
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

      if (!hasChanges) {
        logger.debug('No messages needed updating', { chatId });
        return 0;
      }

      // Validate and update messages
      const validated = updatedMessages.map(msg => ChatEventSchema.parse(msg));

      const collection = await (this as any).getCollection();
      const msgDb = collection.db;
      const messagesCollection = msgDb.collection(this.messagesCollectionName);

      const now = (this as any).getCurrentTimestamp();

      await messagesCollection.updateOne(
        { chatId },
        {
          $set: {
            messages: validated,
            updatedAt: now,
          },
        }
      );

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
      logger.debug('Clearing messages for chat', { chatId });

      const collection = await (this as any).getCollection();
      const msgDb = collection.db;
      const messagesCollection = msgDb.collection(this.messagesCollectionName);

      const now = (this as any).getCurrentTimestamp();

      // Clear messages array
      await messagesCollection.updateOne(
        { chatId },
        {
          $set: {
            messages: [],
            updatedAt: now,
          },
        },
        { upsert: true }
      );

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
export const mongoChatsRepository = new MongoChatsRepository();
