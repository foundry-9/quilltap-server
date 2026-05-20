/**
 * Database Abstraction Layer - Conversation Annotations Repository
 *
 * Backend-agnostic repository for ConversationAnnotation entities.
 * Works with SQLite through the database abstraction layer.
 *
 * Handles CRUD operations for conversation annotations used by
 * Project Scriptorium's conversation rendering system.
 */

import {
  ConversationAnnotation,
  ConversationAnnotationInput,
  ConversationAnnotationSchema,
} from '@/lib/schemas/types';
import { AbstractBaseRepository } from './base.repository';
import { logger } from '@/lib/logger';
import { TypedQueryFilter } from '../interfaces';

/**
 * Conversation Annotations Repository
 * Implements CRUD operations for conversation annotations with
 * chat-scoping and unique constraint on chatId+messageIndex+characterName.
 */
export class ConversationAnnotationsRepository extends AbstractBaseRepository<ConversationAnnotation> {
  constructor() {
    super('conversation_annotations', ConversationAnnotationSchema);
  }

  // ============================================================================
  // Abstract method implementations
  // ============================================================================

  async create(
    data: Omit<ConversationAnnotation, 'id' | 'createdAt' | 'updatedAt'>,
    options?: import('./base.repository').CreateOptions
  ): Promise<ConversationAnnotation> {
    return this._create(data, options);
  }

  async update(id: string, data: Partial<ConversationAnnotation>): Promise<ConversationAnnotation | null> {
    return this._update(id, data);
  }

  async delete(id: string): Promise<boolean> {
    return this._delete(id);
  }

  // ============================================================================
  // Custom query methods
  // ============================================================================

  /**
   * Find all annotations for a chat
   * @param chatId The chat ID
   * @returns Promise<ConversationAnnotation[]> Array of annotations for the chat
   */
  async findByChatId(chatId: string): Promise<ConversationAnnotation[]> {
    return this.safeQuery(
      async () => {
        return this.findByFilter({ chatId } as TypedQueryFilter<ConversationAnnotation>);
      },
      'Error finding annotations by chat ID',
      { chatId },
      []
    );
  }

  /**
   * Find a specific annotation by chat ID, message index, and character name
   * @param chatId The chat ID
   * @param messageIndex The message index
   * @param characterName The character name
   * @returns Promise<ConversationAnnotation | null> The annotation if found
   */
  async findByMessageIndex(
    chatId: string,
    messageIndex: number,
    characterName: string
  ): Promise<ConversationAnnotation | null> {
    return this.safeQuery(
      async () => {
        return this.findOneByFilter({
          chatId,
          messageIndex,
          characterName,
        } as TypedQueryFilter<ConversationAnnotation>);
      },
      'Error finding annotation by message index',
      { chatId, messageIndex, characterName },
      null
    );
  }

  /**
   * Insert or update an annotation.
   * Uses the unique constraint on chatId+messageIndex+characterName.
   * If an existing annotation is found, it is updated; otherwise a new one is created.
   *
   * @param input The annotation input data
   * @returns Promise<ConversationAnnotation> The created or updated annotation
   */
  async upsert(input: ConversationAnnotationInput): Promise<ConversationAnnotation> {
    return this.safeQuery(
      async () => {
        const existing = await this.findOneByFilter({
          chatId: input.chatId,
          messageIndex: input.messageIndex,
          characterName: input.characterName,
        } as TypedQueryFilter<ConversationAnnotation>);

        if (existing) {

          const updated = await this._update(existing.id, {
            content: input.content,
            sourceMessageId: input.sourceMessageId,
          } as Partial<ConversationAnnotation>);

          if (!updated) {
            throw new Error(`Failed to update annotation ${existing.id}`);
          }
          return updated;
        }

        return this._create(input as Omit<ConversationAnnotation, 'id' | 'createdAt' | 'updatedAt'>);
      },
      'Error upserting conversation annotation',
      { chatId: input.chatId, messageIndex: input.messageIndex, characterName: input.characterName }
    );
  }

  /**
   * Delete a specific annotation
   * @param chatId The chat ID
   * @param messageIndex The message index
   * @param characterName The character name
   * @returns Promise<boolean> True if the annotation was deleted
   */
  async deleteAnnotation(
    chatId: string,
    messageIndex: number,
    characterName: string
  ): Promise<boolean> {
    return this.safeQuery(
      async () => {
        const existing = await this.findOneByFilter({
          chatId,
          messageIndex,
          characterName,
        } as TypedQueryFilter<ConversationAnnotation>);

        if (!existing) {
          return false;
        }

        return this._delete(existing.id);
      },
      'Error deleting conversation annotation',
      { chatId, messageIndex, characterName },
      false
    );
  }

  /**
   * Delete all annotations for a chat
   * @param chatId The chat ID
   */
  async deleteAllForChat(chatId: string): Promise<void> {
    await this.safeQuery(
      async () => {
        const count = await this.deleteMany({ chatId } as TypedQueryFilter<ConversationAnnotation>);
      },
      'Error deleting all annotations for chat',
      { chatId }
    );
  }
}
