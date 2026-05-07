/**
 * Database Abstraction Layer - Conversation Chunks Repository
 *
 * Backend-agnostic repository for ConversationChunk entities.
 * Works with SQLite through the database abstraction layer.
 *
 * Handles CRUD operations for conversation chunks used by
 * Project Scriptorium's conversation embedding system.
 * Includes BLOB column handling for vector embeddings.
 */

import {
  ConversationChunk,
  ConversationChunkInput,
  ConversationChunkSchema,
} from '@/lib/schemas/types';
import { AbstractBaseRepository } from './base.repository';
import { logger } from '@/lib/logger';
import { TypedQueryFilter, DatabaseCollection } from '../interfaces';
import { registerBlobColumns } from '../manager';

/**
 * Conversation Chunks Repository
 * Implements CRUD operations for conversation chunks with
 * chat-scoping and embedding storage.
 */
export class ConversationChunksRepository extends AbstractBaseRepository<ConversationChunk> {
  private blobColumnsRegistered = false;

  constructor() {
    super('conversation_chunks', ConversationChunkSchema);
  }

  /**
   * Override getCollection to register blob columns for embedding.
   * The embedding column stores Float32 BLOBs.
   * Without this registration, BLOB embeddings are not deserialized to number[] and fail
   * Zod validation, causing chunks to be silently filtered out.
   */
  protected async getCollection(): Promise<DatabaseCollection<ConversationChunk>> {
    if (!this.blobColumnsRegistered) {
      await registerBlobColumns('conversation_chunks', ['embedding']);
      this.blobColumnsRegistered = true;
    }
    return super.getCollection();
  }

  // ============================================================================
  // Abstract method implementations
  // ============================================================================

  async findById(id: string): Promise<ConversationChunk | null> {
    return this._findById(id);
  }

  async findAll(): Promise<ConversationChunk[]> {
    return this._findAll();
  }

  async create(
    data: Omit<ConversationChunk, 'id' | 'createdAt' | 'updatedAt'>,
    options?: import('./base.repository').CreateOptions
  ): Promise<ConversationChunk> {
    return this._create(data, options);
  }

  async update(id: string, data: Partial<ConversationChunk>): Promise<ConversationChunk | null> {
    return this._update(id, data);
  }

  async delete(id: string): Promise<boolean> {
    return this._delete(id);
  }

  // ============================================================================
  // Custom query methods
  // ============================================================================

  /**
   * Find all chunks for a chat, ordered by interchangeIndex
   * @param chatId The chat ID
   * @returns Promise<ConversationChunk[]> Array of chunks for the chat
   */
  async findByChatId(chatId: string): Promise<ConversationChunk[]> {
    return this.safeQuery(
      async () => {
        const chunks = await this.findByFilter(
          { chatId } as TypedQueryFilter<ConversationChunk>,
          { sort: { interchangeIndex: 1 } }
        );
        return chunks;
      },
      'Error finding chunks by chat ID',
      { chatId },
      []
    );
  }

  /**
   * Find a specific chunk by chat ID and interchange index
   * @param chatId The chat ID
   * @param interchangeIndex The interchange index
   * @returns Promise<ConversationChunk | null> The chunk if found
   */
  async findByInterchangeIndex(
    chatId: string,
    interchangeIndex: number
  ): Promise<ConversationChunk | null> {
    return this.safeQuery(
      async () => {
        return this.findOneByFilter({
          chatId,
          interchangeIndex,
        } as TypedQueryFilter<ConversationChunk>);
      },
      'Error finding chunk by interchange index',
      { chatId, interchangeIndex },
      null
    );
  }

  /**
   * Insert or update a chunk.
   * If an existing chunk is found for the chatId+interchangeIndex, it is updated;
   * otherwise a new one is created with a generated ID.
   *
   * @param input The chunk input data
   * @returns Promise<ConversationChunk> The created or updated chunk
   */
  async upsert(input: ConversationChunkInput): Promise<ConversationChunk> {
    return this.safeQuery(
      async () => {
        const existing = await this.findOneByFilter({
          chatId: input.chatId,
          interchangeIndex: input.interchangeIndex,
        } as TypedQueryFilter<ConversationChunk>);

        if (existing) {

          // Only update content fields — preserve existing embedding
          // Embeddings are managed separately via updateEmbedding()
          const updateData: Partial<ConversationChunk> = {
            content: input.content,
            participantNames: input.participantNames,
            messageIds: input.messageIds,
          };
          // Only overwrite embedding if explicitly provided (non-undefined)
          if (input.embedding !== undefined) {
            updateData.embedding = input.embedding;
          }

          const updated = await this._update(existing.id, updateData);

          if (!updated) {
            throw new Error(`Failed to update chunk ${existing.id}`);
          }
          return updated;
        }

        return this._create(input as Omit<ConversationChunk, 'id' | 'createdAt' | 'updatedAt'>);
      },
      'Error upserting conversation chunk',
      { chatId: input.chatId, interchangeIndex: input.interchangeIndex }
    );
  }

  /**
   * Find all chunks that have embeddings (non-null embedding field)
   * Used by Scriptorium search to find semantically searchable chunks.
   * @returns Promise<ConversationChunk[]> Array of chunks with embeddings
   */
  async findAllWithEmbeddings(): Promise<ConversationChunk[]> {
    return this.safeQuery(
      async () => {
        const allChunks = await this._findAll();
        return allChunks.filter(
          chunk => chunk.embedding != null && chunk.embedding.length > 0
        );
      },
      'Error finding chunks with embeddings',
      {},
      []
    );
  }

  /**
   * Delete all chunks for a chat
   * @param chatId The chat ID
   */
  async deleteAllForChat(chatId: string): Promise<void> {
    await this.safeQuery(
      async () => {
        const count = await this.deleteMany({ chatId } as TypedQueryFilter<ConversationChunk>);
      },
      'Error deleting all chunks for chat',
      { chatId }
    );
  }

  /**
   * Update just the embedding field on a chunk
   * @param id The chunk ID
   * @param embedding The new embedding vector
   */
  async updateEmbedding(id: string, embedding: Float32Array): Promise<void> {
    await this.safeQuery(
      async () => {
        const updated = await this._update(id, {
          embedding,
        } as Partial<ConversationChunk>);

        if (!updated) {
          throw new Error(`Chunk not found for embedding update: ${id}`);
        }
      },
      'Error updating chunk embedding',
      { id }
    );
  }
}
