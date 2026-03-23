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
  ParticipantStatus,
  isParticipantPresent,
} from '@/lib/schemas/types';
import { logger } from '@/lib/logger';
import { ChatOpsContext } from './chats-ops-context';
import { safeQuery } from './safe-query';

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
    return safeQuery(async () => {
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
    }, 'Failed to add participant to chat', { chatId });
  }

  /**
   * Update a participant in a chat
   */
  async updateParticipant(
    chatId: string,
    participantId: string,
    data: Partial<Omit<ChatParticipantBase, 'id' | 'createdAt'>>
  ): Promise<ChatMetadata | null> {
    return safeQuery(async () => {
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
    }, 'Failed to update participant in chat', { chatId, participantId });
  }

  /**
   * Remove a participant from a chat (soft-delete: sets status='removed', isActive=false and removedAt timestamp)
   * Messages referencing this participant retain their attribution.
   */
  async removeParticipant(chatId: string, participantId: string): Promise<ChatMetadata | null> {
    return safeQuery(async () => {
      const chat = await this.ctx.findById(chatId);
      if (!chat) {
        return null;
      }

      const participantIndex = chat.participants.findIndex(p => p.id === participantId);
      if (participantIndex === -1) {
        logger.warn('Participant not found for removal', { chatId, participantId });
        return null;
      }

      const now = this.ctx.getCurrentTimestamp();
      const participants = [...chat.participants];
      participants[participantIndex] = {
        ...participants[participantIndex],
        status: 'removed',
        isActive: false,
        removedAt: now,
        updatedAt: now,
      };

      // Don't allow removing the last active participant
      const activeCount = participants.filter(p => isParticipantPresent(p.status)).length;
      if (activeCount === 0) {
        const error = new Error('Cannot remove the last participant from a chat');
        logger.error('Cannot remove last participant', { chatId, participantId });
        throw error;
      }

      return await this.ctx.update(chatId, { participants });
    }, 'Failed to remove participant from chat', { chatId, participantId });
  }

  /**
   * Change a participant's status and keep isActive in sync.
   * Records the status change by returning the old status for notification purposes.
   */
  async setParticipantStatus(
    chatId: string,
    participantId: string,
    newStatus: ParticipantStatus
  ): Promise<{ chat: ChatMetadata | null; oldStatus: ParticipantStatus }> {
    return safeQuery(async () => {
      const chat = await this.ctx.findById(chatId);
      if (!chat) {
        return { chat: null, oldStatus: 'active' };
      }

      const participantIndex = chat.participants.findIndex(p => p.id === participantId);
      if (participantIndex === -1) {
        logger.warn('Participant not found for status update', { chatId, participantId });
        return { chat: null, oldStatus: 'active' };
      }

      const now = this.ctx.getCurrentTimestamp();
      const existingParticipant = chat.participants[participantIndex];
      const oldStatus = existingParticipant.status || 'active';

      const participants = [...chat.participants];
      participants[participantIndex] = {
        ...existingParticipant,
        status: newStatus,
        isActive: isParticipantPresent(newStatus),
        removedAt: newStatus === 'removed' ? now : null,
        updatedAt: now,
      };

      const updatedChat = await this.ctx.update(chatId, { participants });
      return { chat: updatedChat, oldStatus };
    }, 'Failed to set participant status', { chatId, participantId, newStatus });
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
    return chat.participants.filter(p => isParticipantPresent(p.status));
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
