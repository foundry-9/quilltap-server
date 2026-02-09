/**
 * Chat Impersonation Operations
 *
 * Handles impersonation management: adding/removing impersonation,
 * getting impersonated IDs, setting active typing participant,
 * and updating the all-LLM pause turn count.
 */

import { ChatMetadata } from '@/lib/schemas/types';
import { logger } from '@/lib/logger';
import { ChatOpsContext } from './chats-ops-context';
import { safeQuery } from './safe-query';

export class ChatImpersonationOps {
  constructor(private readonly ctx: ChatOpsContext) {}

  /**
   * Add impersonation for a participant
   * @param chatId The chat ID
   * @param participantId The participant ID to impersonate
   * @returns Updated chat metadata
   */
  async addImpersonation(chatId: string, participantId: string): Promise<ChatMetadata | null> {
    return safeQuery(async () => {
      const chat = await this.ctx.findById(chatId);
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

      return await this.ctx.update(chatId, {
        impersonatingParticipantIds: impersonatingIds,
        activeTypingParticipantId: activeTyping,
      });
    }, 'Failed to add impersonation', { chatId, participantId });
  }

  /**
   * Remove impersonation for a participant
   * @param chatId The chat ID
   * @param participantId The participant ID to stop impersonating
   * @returns Updated chat metadata
   */
  async removeImpersonation(chatId: string, participantId: string): Promise<ChatMetadata | null> {
    return safeQuery(async () => {
      const chat = await this.ctx.findById(chatId);
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

      return await this.ctx.update(chatId, {
        impersonatingParticipantIds: impersonatingIds,
        activeTypingParticipantId: activeTyping,
      });
    }, 'Failed to remove impersonation', { chatId, participantId });
  }

  /**
   * Get impersonated participant IDs
   * @param chatId The chat ID
   * @returns Array of participant IDs being impersonated
   */
  async getImpersonatedParticipantIds(chatId: string): Promise<string[]> {
    return safeQuery(async () => {
      const chat = await this.ctx.findById(chatId);
      if (!chat) {
        return [];
      }

      return chat.impersonatingParticipantIds || [];
    }, 'Failed to get impersonated participant IDs', { chatId }, []);
  }

  /**
   * Set the active typing participant (for multi-character impersonation)
   * @param chatId The chat ID
   * @param participantId The participant ID (or null to clear)
   * @returns Updated chat metadata
   */
  async setActiveTypingParticipant(chatId: string, participantId: string | null): Promise<ChatMetadata | null> {
    return safeQuery(async () => {
      const chat = await this.ctx.findById(chatId);
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

      return await this.ctx.update(chatId, {
        activeTypingParticipantId: participantId,
      });
    }, 'Failed to set active typing participant', { chatId, participantId });
  }

  /**
   * Update the all-LLM pause turn count
   * @param chatId The chat ID
   * @param count The turn count
   * @returns Updated chat metadata
   */
  async updateAllLLMPauseTurnCount(chatId: string, count: number): Promise<ChatMetadata | null> {
    return safeQuery(() => this.ctx.update(chatId, {
      allLLMPauseTurnCount: count,
    }), 'Failed to update all-LLM pause turn count', { chatId, count });
  }
}
