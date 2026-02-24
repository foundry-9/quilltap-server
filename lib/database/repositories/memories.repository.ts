/**
 * Database Abstraction Layer - Memories Repository
 *
 * Backend-agnostic repository for Memory entities.
 * Works with SQLite through the database abstraction layer.
 *
 * Handles CRUD operations and advanced queries for Memory entities.
 * Each memory is stored as a document in the 'memories' collection/table.
 */

import { Memory, MemorySchema } from '@/lib/schemas/types';
import { AbstractBaseRepository, CreateOptions } from './base.repository';
import { logger } from '@/lib/logger';
import { TypedQueryFilter, DatabaseCollection } from '../interfaces';
import { registerBlobColumns } from '../manager';

/** Maximum allowed search query length to prevent ReDoS and excessive memory usage */
const MAX_SEARCH_QUERY_LENGTH = 1000;

/**
 * Memories Repository
 * Implements CRUD operations for memories with character-scoping and advanced search capabilities.
 */
export class MemoriesRepository extends AbstractBaseRepository<Memory> {
  private blobColumnsRegistered = false;

  constructor() {
    super('memories', MemorySchema);
  }

  /**
   * Override getCollection to register blob columns for embedding.
   * The embedding column stores Float32 BLOBs after the normalize-vector-storage migration.
   * Without this registration, BLOB embeddings are not deserialized to number[] and fail
   * Zod validation, causing memories to be silently filtered out.
   */
  protected async getCollection(): Promise<DatabaseCollection<Memory>> {
    if (!this.blobColumnsRegistered) {
      await registerBlobColumns('memories', ['embedding']);
      this.blobColumnsRegistered = true;
    }
    return super.getCollection();
  }

  /**
   * Find a memory by ID
   * @param id The memory ID
   * @returns Promise<Memory | null> The memory if found, null otherwise
   */
  async findById(id: string): Promise<Memory | null> {
    return this._findById(id);
  }

  /**
   * Find all memories
   * @returns Promise<Memory[]> Array of all memories
   */
  async findAll(): Promise<Memory[]> {
    return this._findAll();
  }

  /**
   * Find a specific memory by ID for a character
   * @param characterId The character ID
   * @param memoryId The memory ID
   * @returns Promise<Memory | null> The memory if found and belongs to character, null otherwise
   */
  async findByIdForCharacter(characterId: string, memoryId: string): Promise<Memory | null> {
    return this.safeQuery(
      async () => {
        const memory = await this.findOneByFilter({
          id: memoryId,
          characterId,
        });

        return memory;
      },
      'Error finding memory by ID for character',
      { characterId, memoryId },
      null
    );
  }

  /**
   * Find all memories for a specific character
   * @param characterId The character ID
   * @returns Promise<Memory[]> Array of memories for the character
   */
  async findByCharacterId(characterId: string): Promise<Memory[]> {
    return this.safeQuery(
      async () => {
        const memories = await this.findByFilter({ characterId });
        return memories;
      },
      'Error finding memories by character ID',
      { characterId },
      []
    );
  }

  /**
   * Find memories containing any of the specified keywords
   * @param characterId The character ID
   * @param keywords Array of keywords to search for
   * @returns Promise<Memory[]> Array of memories containing any keyword
   */
  async findByKeywords(characterId: string, keywords: string[]): Promise<Memory[]> {
    return this.safeQuery(
      async () => {
        if (keywords.length === 0) {
          return [];
        }

        const memories = await this.findByFilter({
          characterId,
          keywords: { $in: keywords },
        });
        return memories;
      },
      'Error finding memories by keywords',
      { characterId, keywordCount: keywords.length },
      []
    );
  }

  /**
   * Text search in memory content and summary
   * @param characterId The character ID
   * @param query Search query string
   * @returns Promise<Memory[]> Array of memories matching the search query
   */
  async searchByContent(characterId: string, query: string): Promise<Memory[]> {
    return this.safeQuery(
      async () => {
        if (query.length > MAX_SEARCH_QUERY_LENGTH) {
          logger.warn('Search query exceeds maximum length', {
            characterId,
            queryLength: query.length,
            maxLength: MAX_SEARCH_QUERY_LENGTH,
          });
          return [];
        }
        // Escape special regex characters to treat query as literal text
        const escapedQuery = this.escapeRegex(query);
        const regex = new RegExp(escapedQuery, 'i'); // Case-insensitive regex search

        const memories = await this.findByFilter({
          characterId,
          $or: [{ content: { $regex: regex } }, { summary: { $regex: regex } }],
        });
        return memories;
      },
      'Error searching memories by content',
      { characterId, queryLength: query.length },
      []
    );
  }

  /**
   * Find memories with importance >= minImportance threshold
   * @param characterId The character ID
   * @param minImportance Minimum importance value (0-1)
   * @returns Promise<Memory[]> Array of memories meeting importance threshold
   */
  async findByImportance(characterId: string, minImportance: number): Promise<Memory[]> {
    return this.safeQuery(
      async () => {
        if (minImportance < 0 || minImportance > 1) {
          logger.warn('Invalid importance threshold', { minImportance });
          return [];
        }

        const memories = await this.findByFilter({
          characterId,
          importance: { $gte: minImportance },
        });
        return memories;
      },
      'Error finding memories by importance',
      { characterId, minImportance },
      []
    );
  }

  /**
   * Find memories by source type
   * @param characterId The character ID
   * @param source Source type ('AUTO' or 'MANUAL')
   * @returns Promise<Memory[]> Array of memories with the specified source
   */
  async findBySource(characterId: string, source: 'AUTO' | 'MANUAL'): Promise<Memory[]> {
    return this.safeQuery(
      async () => {
        const memories = await this.findByFilter({
          characterId,
          source,
        });
        return memories;
      },
      'Error finding memories by source',
      { characterId, source },
      []
    );
  }

  /**
   * Find the most recent memories for a character
   * @param characterId The character ID
   * @param limit Maximum number of memories to return (default: 10)
   * @returns Promise<Memory[]> Array of recent memories, sorted by creation date (newest first)
   */
  async findRecent(characterId: string, limit: number = 10): Promise<Memory[]> {
    return this.safeQuery(
      async () => {
        const memories = await this.findByFilter(
          { characterId },
          {
            sort: { createdAt: -1 },
            limit,
          }
        );
        return memories;
      },
      'Error finding recent memories',
      { characterId, limit },
      []
    );
  }

  /**
   * Find the most important memories for a character
   * @param characterId The character ID
   * @param limit Maximum number of memories to return (default: 10)
   * @returns Promise<Memory[]> Array of important memories, sorted by importance (highest first)
   */
  async findMostImportant(characterId: string, limit: number = 10): Promise<Memory[]> {
    return this.safeQuery(
      async () => {
        const memories = await this.findByFilter(
          { characterId },
          {
            sort: { importance: -1 },
            limit,
          }
        );
        return memories;
      },
      'Error finding most important memories',
      { characterId, limit },
      []
    );
  }

  /**
   * Create a new memory
   * @param data The memory data (without id, createdAt, updatedAt)
   * @param options Optional CreateOptions to specify ID and createdAt (for sync)
   * @returns Promise<Memory> The created memory with generated id and timestamps
   */
  async create(
    data: Omit<Memory, 'id' | 'createdAt' | 'updatedAt'>,
    options?: CreateOptions
  ): Promise<Memory> {
    return this.safeQuery(
      async () => {
        const memory = await this._create(data, options);
        return memory;
      },
      'Error creating memory',
      { characterId: data.characterId }
    );
  }

  /**
   * Update a memory
   * @param id The memory ID
   * @param data Partial memory data to update
   * @returns Promise<Memory | null> The updated memory if found, null otherwise
   */
  async update(id: string, data: Partial<Memory>): Promise<Memory | null> {
    return this.safeQuery(
      async () => {
        const memory = await this._update(id, data);
        return memory;
      },
      'Error updating memory',
      { memoryId: id }
    );
  }

  /**
   * Update a specific character's memory
   * @param characterId The character ID
   * @param memoryId The memory ID
   * @param data Partial memory data to update
   * @returns Promise<Memory | null> The updated memory if found, null otherwise
   */
  async updateForCharacter(
    characterId: string,
    memoryId: string,
    data: Partial<Memory>
  ): Promise<Memory | null> {
    return this.safeQuery(
      async () => {
        const memory = await this.findById(memoryId);
        if (!memory) {
          logger.warn('Memory not found for update', { memoryId, characterId });
          return null;
        }

        if (memory.characterId !== characterId) {
          logger.warn('Memory does not belong to character', { characterId, memoryId });
          return null;
        }

        return await this.update(memoryId, data);
      },
      'Error updating memory for character',
      { characterId, memoryId }
    );
  }

  /**
   * Delete a memory
   * @param id The memory ID
   * @returns Promise<boolean> True if memory was deleted, false if not found
   */
  async delete(id: string): Promise<boolean> {
    return this.safeQuery(
      async () => {
        const result = await this._delete(id);
        return result;
      },
      'Error deleting memory',
      { memoryId: id }
    );
  }

  /**
   * Delete a specific character's memory
   * @param characterId The character ID
   * @param memoryId The memory ID
   * @returns Promise<boolean> True if memory was deleted, false if not found or doesn't belong to character
   */
  async deleteForCharacter(characterId: string, memoryId: string): Promise<boolean> {
    return this.safeQuery(
      async () => {
        const memory = await this.findById(memoryId);
        if (!memory) {
          logger.warn('Memory not found for deletion', { memoryId, characterId });
          return false;
        }

        if (memory.characterId !== characterId) {
          logger.warn('Memory does not belong to character', { characterId, memoryId });
          return false;
        }

        return await this.delete(memoryId);
      },
      'Error deleting memory for character',
      { characterId, memoryId }
    );
  }

  /**
   * Delete multiple memories for a character
   * @param characterId The character ID
   * @param memoryIds Array of memory IDs to delete
   * @returns Promise<number> Number of memories successfully deleted
   */
  async bulkDelete(characterId: string, memoryIds: string[]): Promise<number> {
    return this.safeQuery(
      async () => {
        if (memoryIds.length === 0) {
          return 0;
        }

        const deletedCount = await this.deleteMany({
          characterId,
          id: { $in: memoryIds },
        });
        return deletedCount;
      },
      'Error bulk deleting memories for character',
      { characterId, count: memoryIds.length }
    );
  }

  /**
   * Update the lastAccessedAt timestamp for a memory
   * @param characterId The character ID
   * @param memoryId The memory ID
   * @returns Promise<Memory | null> The updated memory if found, null otherwise
   */
  async updateAccessTime(characterId: string, memoryId: string): Promise<Memory | null> {
    return this.safeQuery(
      async () => {
        const memory = await this.findById(memoryId);
        if (!memory) {
          logger.warn('Memory not found for access time update', { memoryId, characterId });
          return null;
        }

        if (memory.characterId !== characterId) {
          logger.warn('Memory does not belong to character', { characterId, memoryId });
          return null;
        }

        const now = this.getCurrentTimestamp();
        return await this.update(memoryId, { lastAccessedAt: now });
      },
      'Error updating memory access time',
      { characterId, memoryId }
    );
  }

  /**
   * Count the number of memories for a character
   * @param characterId The character ID
   * @returns Promise<number> Number of memories for the character
   */
  async countByCharacterId(characterId: string): Promise<number> {
    return this.safeQuery(
      async () => {
        const count = await this.count({ characterId });
        return count;
      },
      'Error counting memories for character',
      { characterId },
      0
    );
  }

  /**
   * Find memories that a character has about another character
   * @param characterId The character who owns the memory
   * @param aboutCharacterId The character the memory is about
   * @returns Promise<Memory[]> Array of memories about the other character
   */
  async findByCharacterAboutCharacter(
    characterId: string,
    aboutCharacterId: string
  ): Promise<Memory[]> {
    return this.safeQuery(
      async () => {
        const memories = await this.findByFilter(
          { characterId, aboutCharacterId },
          {
            sort: { importance: -1, createdAt: -1 },
          }
        );
        return memories;
      },
      'Error finding memories about character',
      { characterId, aboutCharacterId },
      []
    );
  }

  /**
   * Find memories that a character has about any of the specified characters
   * @param characterId The character who owns the memories
   * @param aboutCharacterIds Array of character IDs the memories might be about
   * @returns Promise<Memory[]> Array of memories about the specified characters
   */
  async findByCharacterAboutCharacters(
    characterId: string,
    aboutCharacterIds: string[]
  ): Promise<Memory[]> {
    return this.safeQuery(
      async () => {
        if (aboutCharacterIds.length === 0) {
          return [];
        }

        const memories = await this.findByFilter(
          {
            characterId,
            aboutCharacterId: { $in: aboutCharacterIds },
          },
          {
            sort: { importance: -1, createdAt: -1 },
          }
        );
        return memories;
      },
      'Error finding memories about characters',
      { characterId, aboutCharacterCount: aboutCharacterIds.length },
      []
    );
  }

  /**
   * Find all memories associated with a specific chat
   * @param chatId The chat ID
   * @returns Promise<Memory[]> Array of memories associated with the chat
   */
  async findByChatId(chatId: string): Promise<Memory[]> {
    return this.safeQuery(
      async () => {
        const memories = await this.findByFilter({ chatId });
        return memories;
      },
      'Error finding memories by chat ID',
      { chatId },
      []
    );
  }

  /**
   * Find all memories associated with a specific source message
   * @param sourceMessageId The source message ID
   * @returns Promise<Memory[]> Array of memories created from the message
   */
  async findBySourceMessageId(sourceMessageId: string): Promise<Memory[]> {
    return this.safeQuery(
      async () => {
        const memories = await this.findByFilter({ sourceMessageId });
        return memories;
      },
      'Error finding memories by source message ID',
      { sourceMessageId },
      []
    );
  }

  /**
   * Delete all memories associated with a specific source message
   * @param sourceMessageId The source message ID
   * @returns Promise<number> Number of memories deleted
   */
  async deleteBySourceMessageId(sourceMessageId: string): Promise<number> {
    return this.safeQuery(
      async () => {
        const deletedCount = await this.deleteMany({ sourceMessageId });
        return deletedCount;
      },
      'Error deleting memories by source message ID',
      { sourceMessageId }
    );
  }

  /**
   * Delete all memories associated with multiple source messages (for swipe groups)
   * @param sourceMessageIds Array of source message IDs
   * @returns Promise<number> Number of memories deleted
   */
  async deleteBySourceMessageIds(sourceMessageIds: string[]): Promise<number> {
    return this.safeQuery(
      async () => {
        if (sourceMessageIds.length === 0) {
          return 0;
        }

        const deletedCount = await this.deleteMany({
          sourceMessageId: { $in: sourceMessageIds },
        });
        return deletedCount;
      },
      'Error deleting memories by source message IDs',
      { count: sourceMessageIds.length }
    );
  }

  /**
   * Count memories associated with a specific source message
   * @param sourceMessageId The source message ID
   * @returns Promise<number> Number of memories for the message
   */
  async countBySourceMessageId(sourceMessageId: string): Promise<number> {
    return this.safeQuery(
      async () => {
        const count = await this.count({ sourceMessageId });
        return count;
      },
      'Error counting memories for source message',
      { sourceMessageId },
      0
    );
  }

  /**
   * Count memories associated with multiple source messages (for swipe groups)
   * @param sourceMessageIds Array of source message IDs
   * @returns Promise<number> Total number of memories
   */
  async countBySourceMessageIds(sourceMessageIds: string[]): Promise<number> {
    return this.safeQuery(
      async () => {
        if (sourceMessageIds.length === 0) {
          return 0;
        }

        const count = await this.count({
          sourceMessageId: { $in: sourceMessageIds },
        });
        return count;
      },
      'Error counting memories for source messages',
      { count: sourceMessageIds.length },
      0
    );
  }

  /**
   * Delete all memories associated with a specific chat
   * @param chatId The chat ID
   * @returns Promise<number> Number of memories deleted
   */
  async deleteByChatId(chatId: string): Promise<number> {
    return this.safeQuery(
      async () => {
        const deletedCount = await this.deleteMany({ chatId });
        return deletedCount;
      },
      'Error deleting memories by chat ID',
      { chatId }
    );
  }

  /**
   * Count memories associated with a specific chat
   * @param chatId The chat ID
   * @returns Promise<number> Number of memories for the chat
   */
  async countByChatId(chatId: string): Promise<number> {
    return this.safeQuery(
      async () => {
        const count = await this.count({ chatId });
        return count;
      },
      'Error counting memories for chat',
      { chatId },
      0
    );
  }

  // ============================================================================
  // SEARCH AND REPLACE OPERATIONS
  // ============================================================================

  /**
   * Find all memories for a specific persona
   * @deprecated Use findByAboutCharacterId instead.
   * Characters Not Personas - Phase 7: personaId is migrated to aboutCharacterId.
   * @param personaId The persona ID
   * @returns Promise<Memory[]> Array of memories associated with the persona
   */
  async findByPersonaId(personaId: string): Promise<Memory[]> {
    return this.safeQuery(
      async () => {
        const memories = await this.findByFilter({ personaId });
        return memories;
      },
      'Error finding memories by persona ID',
      { personaId },
      []
    );
  }

  /**
   * Find all memories about a specific character (including former personas)
   * Characters Not Personas - Phase 7: This replaces findByPersonaId.
   * After migration, aboutCharacterId includes both inter-character memories
   * and former persona-related memories.
   * @param aboutCharacterId The character ID this memory is about
   * @returns Promise<Memory[]> Array of memories about the character
   */
  async findByAboutCharacterId(aboutCharacterId: string): Promise<Memory[]> {
    return this.safeQuery(
      async () => {
        // Query both aboutCharacterId (new) and personaId (legacy, for backward compat)
        const memories = await this.findByFilter({
          $or: [
            { aboutCharacterId },
            { personaId: aboutCharacterId }, // Legacy support during migration
          ],
        });
        return memories;
      },
      'Error finding memories by aboutCharacterId',
      { aboutCharacterId },
      []
    );
  }

  /**
   * Count memories containing specific text
   * Searches in content, summary, and keywords fields
   * @param characterId Optional character ID filter
   * @param personaId Optional persona ID filter
   * @param chatId Optional chat ID filter
   * @param searchText Text to search for
   * @returns Number of memories containing the text
   */
  async countMemoriesWithText(
    characterId: string | null,
    personaId: string | null,
    chatId: string | null,
    searchText: string
  ): Promise<number> {
    return this.safeQuery(
      async () => {
        if (searchText.length > MAX_SEARCH_QUERY_LENGTH) {
          logger.warn('Search text exceeds maximum length', {
            characterId,
            queryLength: searchText.length,
            maxLength: MAX_SEARCH_QUERY_LENGTH,
          });
          return 0;
        }
        const regex = new RegExp(this.escapeRegex(searchText), 'i');

        // Build the query filter - search in content, summary, and keywords
        const filter: TypedQueryFilter<Memory> = {
          $or: [
            { content: { $regex: regex } },
            { summary: { $regex: regex } },
            { keywords: { $regex: regex } },
          ],
        };

        if (characterId) filter.characterId = characterId;
        if (personaId) filter.personaId = personaId;
        if (chatId) filter.chatId = chatId;

        const count = await this.count(filter);
        return count;
      },
      'Error counting memories with text',
      { characterId, personaId, chatId },
      0
    );
  }

  /**
   * Find memories containing specific text
   * Searches in content, summary, and keywords fields
   * @param characterId Optional character ID filter
   * @param personaId Optional persona ID filter
   * @param chatId Optional chat ID filter
   * @param searchText Text to search for
   * @returns Array of memories containing the text
   */
  async findMemoriesWithText(
    characterId: string | null,
    personaId: string | null,
    chatId: string | null,
    searchText: string
  ): Promise<Memory[]> {
    return this.safeQuery(
      async () => {
        if (searchText.length > MAX_SEARCH_QUERY_LENGTH) {
          logger.warn('Search text exceeds maximum length', {
            characterId,
            queryLength: searchText.length,
            maxLength: MAX_SEARCH_QUERY_LENGTH,
          });
          return [];
        }
        const regex = new RegExp(this.escapeRegex(searchText), 'i');

        // Build the query filter - search in content, summary, and keywords
        const filter: TypedQueryFilter<Memory> = {
          $or: [
            { content: { $regex: regex } },
            { summary: { $regex: regex } },
            { keywords: { $regex: regex } },
          ],
        };

        if (characterId) filter.characterId = characterId;
        if (personaId) filter.personaId = personaId;
        if (chatId) filter.chatId = chatId;

        const memories = await this.findByFilter(filter);
        return memories;
      },
      'Error finding memories with text',
      { characterId, personaId, chatId },
      []
    );
  }

  /**
   * Replace text in memory content, summary, and keywords for specific memories
   * @param memoryIds Array of memory IDs to update
   * @param searchText Text to find
   * @param replaceText Text to replace with
   * @returns Array of updated memories (for embedding regeneration)
   */
  async replaceInMemories(
    memoryIds: string[],
    searchText: string,
    replaceText: string
  ): Promise<Memory[]> {
    return this.safeQuery(
      async () => {
        if (memoryIds.length === 0) {
          return [];
        }

        const updatedMemories: Memory[] = [];

        for (const memoryId of memoryIds) {
          const memory = await this.findById(memoryId);
          if (!memory) {
            logger.warn('Memory not found for replacement', { memoryId });
            continue;
          }

          let contentChanged = false;
          let newContent = memory.content;
          let newSummary = memory.summary;
          let newKeywords = memory.keywords;

          // Replace in content
          if (memory.content.includes(searchText)) {
            newContent = memory.content.split(searchText).join(replaceText);
            contentChanged = true;
          }

          // Replace in summary
          if (memory.summary.includes(searchText)) {
            newSummary = memory.summary.split(searchText).join(replaceText);
            contentChanged = true;
          }

          // Replace in keywords array
          if (memory.keywords && memory.keywords.length > 0) {
            const updatedKeywords = memory.keywords.map(keyword => {
              if (keyword.includes(searchText)) {
                contentChanged = true;
                return keyword.split(searchText).join(replaceText);
              }
              return keyword;
            });
            newKeywords = updatedKeywords;
          }

          if (contentChanged) {
            const updated = await this.update(memoryId, {
              content: newContent,
              summary: newSummary,
              keywords: newKeywords,
            });

            if (updated) {
              updatedMemories.push(updated);
            }
          }
        }

        logger.info('Replaced text in memories', { updatedCount: updatedMemories.length });
        return updatedMemories;
      },
      'Error replacing text in memories',
      { memoryCount: memoryIds.length }
    );
  }

  /**
   * Text search in memory content and summary for memories about a specific character
   * @param characterId The character who owns the memories
   * @param aboutCharacterId The character the memories are about
   * @param query Search query string
   * @returns Promise<Memory[]> Array of memories matching the search query
   */
  async searchByContentAboutCharacter(
    characterId: string,
    aboutCharacterId: string,
    query: string
  ): Promise<Memory[]> {
    return this.safeQuery(
      async () => {
        // Escape special regex characters to treat query as literal text
        const escapedQuery = this.escapeRegex(query);
        const regex = new RegExp(escapedQuery, 'i');

        const memories = await this.findByFilter({
          characterId,
          aboutCharacterId,
          $or: [{ content: { $regex: regex } }, { summary: { $regex: regex } }],
        });
        return memories;
      },
      'Error searching memories about character by content',
      { characterId, aboutCharacterId, queryLength: query.length },
      []
    );
  }
}
