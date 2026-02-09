/**
 * Chat Participants Operations
 *
 * Handles participant CRUD within a chat: add, update, remove,
 * and filtered queries (character, active, LLM-controlled, user-controlled).
 */

import {
  ChatMetadata,
  ChatParticipantBase,
  ChatParticipantBaseInput,
  ChatParticipantBaseSchema,
} from '@/lib/schemas/types';
import { logger } from '@/lib/logger';
import { ChatOpsContext } from './chats-ops-context';

export class ChatParticipantsOps {
  constructor(private readonly ctx: ChatOpsContext) {}

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
      const chat = await this.ctx.findById(chatId);
      if (!chat) {
        return null;
      }

      const now = this.ctx.getCurrentTimestamp();
      const participantInput = {
        ...participant,
        id: this.ctx.generateId(),
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

      return await this.ctx.update(chatId, updateData);
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
      const chat = await this.ctx.findById(chatId);
      if (!chat) {
        return null;
      }

      const participantIndex = chat.participants.findIndex(p => p.id === participantId);
      if (participantIndex === -1) {
        return null;
      }

      const now = this.ctx.getCurrentTimestamp();
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

      return await this.ctx.update(chatId, { participants });
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
      const chat = await this.ctx.findById(chatId);
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

      return await this.ctx.update(chatId, { participants });
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
}
