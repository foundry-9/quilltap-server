/**
 * Database Abstraction Layer - Memories Repository
 *
 * Backend-agnostic repository for Memory entities.
 * Works with both MongoDB and SQLite through the database abstraction layer.
 *
 * Handles CRUD operations and advanced queries for Memory entities.
 * Each memory is stored as a document in the 'memories' collection/table.
 */

import { Memory, MemorySchema } from '@/lib/schemas/types';
import { AbstractBaseRepository, CreateOptions } from './base.repository';
import { logger } from '@/lib/logger';
import { QueryFilter } from '../interfaces';

/**
 * Memories Repository
 * Implements CRUD operations for memories with character-scoping and advanced search capabilities.
 */
export class MemoriesRepository extends AbstractBaseRepository<Memory> {
  constructor() {
    super('memories', MemorySchema);
    logger.debug('MemoriesRepository initialized');
  }

  /**
   * Find a memory by ID
   * @param id The memory ID
   * @returns Promise<Memory | null> The memory if found, null otherwise
   */
  async findById(id: string): Promise<Memory | null> {
    logger.debug('Finding memory by ID', { memoryId: id });
    return this._findById(id);
  }

  /**
   * Find all memories
   * @returns Promise<Memory[]> Array of all memories
   */
  async findAll(): Promise<Memory[]> {
    logger.debug('Finding all memories');
    return this._findAll();
  }

  /**
   * Find a specific memory by ID for a character
   * @param characterId The character ID
   * @param memoryId The memory ID
   * @returns Promise<Memory | null> The memory if found and belongs to character, null otherwise
   */
  async findByIdForCharacter(characterId: string, memoryId: string): Promise<Memory | null> {
    logger.debug('Finding memory by ID for character', { characterId, memoryId });
    try {
      const memory = await this.findOneByFilter({
        id: memoryId,
        characterId,
      } as QueryFilter);

      return memory;
    } catch (error) {
      logger.error('Error finding memory by ID for character', {
        characterId,
        memoryId,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Find all memories for a specific character
   * @param characterId The character ID
   * @returns Promise<Memory[]> Array of memories for the character
   */
  async findByCharacterId(characterId: string): Promise<Memory[]> {
    logger.debug('Finding memories by character ID', { characterId });
    try {
      const memories = await this.findByFilter({ characterId } as QueryFilter);
      logger.debug('Found memories for character', { characterId, count: memories.length });
      return memories;
    } catch (error) {
      logger.error('Error finding memories by character ID', {
        characterId,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Find memories containing any of the specified keywords
   * @param characterId The character ID
   * @param keywords Array of keywords to search for
   * @returns Promise<Memory[]> Array of memories containing any keyword
   */
  async findByKeywords(characterId: string, keywords: string[]): Promise<Memory[]> {
    logger.debug('Finding memories by keywords', { characterId, keywordCount: keywords.length });
    try {
      if (keywords.length === 0) {
        logger.debug('Empty keywords array provided', { characterId });
        return [];
      }

      const memories = await this.findByFilter({
        characterId,
        keywords: { $in: keywords },
      } as QueryFilter);

      logger.debug('Found memories by keywords', { characterId, count: memories.length });
      return memories;
    } catch (error) {
      logger.error('Error finding memories by keywords', {
        characterId,
        keywordCount: keywords.length,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Text search in memory content and summary
   * @param characterId The character ID
   * @param query Search query string
   * @returns Promise<Memory[]> Array of memories matching the search query
   */
  async searchByContent(characterId: string, query: string): Promise<Memory[]> {
    logger.debug('Searching memories by content', { characterId, queryLength: query.length });
    try {
      const regex = new RegExp(query, 'i'); // Case-insensitive regex search

      const memories = await this.findByFilter({
        characterId,
        $or: [{ content: { $regex: regex } }, { summary: { $regex: regex } }],
      } as QueryFilter);

      logger.debug('Found memories by content search', { characterId, count: memories.length });
      return memories;
    } catch (error) {
      logger.error('Error searching memories by content', {
        characterId,
        queryLength: query.length,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Find memories with importance >= minImportance threshold
   * @param characterId The character ID
   * @param minImportance Minimum importance value (0-1)
   * @returns Promise<Memory[]> Array of memories meeting importance threshold
   */
  async findByImportance(characterId: string, minImportance: number): Promise<Memory[]> {
    logger.debug('Finding memories by importance', { characterId, minImportance });
    try {
      if (minImportance < 0 || minImportance > 1) {
        logger.warn('Invalid importance threshold', { minImportance });
        return [];
      }

      const memories = await this.findByFilter({
        characterId,
        importance: { $gte: minImportance },
      } as QueryFilter);

      logger.debug('Found memories by importance', { characterId, count: memories.length });
      return memories;
    } catch (error) {
      logger.error('Error finding memories by importance', {
        characterId,
        minImportance,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Find memories by source type
   * @param characterId The character ID
   * @param source Source type ('AUTO' or 'MANUAL')
   * @returns Promise<Memory[]> Array of memories with the specified source
   */
  async findBySource(characterId: string, source: 'AUTO' | 'MANUAL'): Promise<Memory[]> {
    logger.debug('Finding memories by source', { characterId, source });
    try {
      const memories = await this.findByFilter({
        characterId,
        source,
      } as QueryFilter);

      logger.debug('Found memories by source', { characterId, source, count: memories.length });
      return memories;
    } catch (error) {
      logger.error('Error finding memories by source', {
        characterId,
        source,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Find the most recent memories for a character
   * @param characterId The character ID
   * @param limit Maximum number of memories to return (default: 10)
   * @returns Promise<Memory[]> Array of recent memories, sorted by creation date (newest first)
   */
  async findRecent(characterId: string, limit: number = 10): Promise<Memory[]> {
    logger.debug('Finding recent memories', { characterId, limit });
    try {
      const memories = await this.findByFilter(
        { characterId } as QueryFilter,
        {
          sort: { createdAt: -1 },
          limit,
        }
      );

      logger.debug('Found recent memories', { characterId, count: memories.length, limit });
      return memories;
    } catch (error) {
      logger.error('Error finding recent memories', {
        characterId,
        limit,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Find the most important memories for a character
   * @param characterId The character ID
   * @param limit Maximum number of memories to return (default: 10)
   * @returns Promise<Memory[]> Array of important memories, sorted by importance (highest first)
   */
  async findMostImportant(characterId: string, limit: number = 10): Promise<Memory[]> {
    logger.debug('Finding most important memories', { characterId, limit });
    try {
      const memories = await this.findByFilter(
        { characterId } as QueryFilter,
        {
          sort: { importance: -1 },
          limit,
        }
      );

      logger.debug('Found most important memories', { characterId, count: memories.length, limit });
      return memories;
    } catch (error) {
      logger.error('Error finding most important memories', {
        characterId,
        limit,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
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
    logger.debug('Creating new memory', { characterId: data.characterId });
    try {
      const memory = await this._create(data, options);
      logger.debug('Memory created successfully', { memoryId: memory.id, characterId: data.characterId });
      return memory;
    } catch (error) {
      logger.error('Error creating memory', {
        characterId: data.characterId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Update a memory
   * @param id The memory ID
   * @param data Partial memory data to update
   * @returns Promise<Memory | null> The updated memory if found, null otherwise
   */
  async update(id: string, data: Partial<Memory>): Promise<Memory | null> {
    logger.debug('Updating memory', { memoryId: id });
    try {
      const memory = await this._update(id, data);

      if (memory) {
        logger.debug('Memory updated successfully', { memoryId: id });
      }

      return memory;
    } catch (error) {
      logger.error('Error updating memory', {
        memoryId: id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
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
    logger.debug('Updating memory for character', { characterId, memoryId });
    try {
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
    } catch (error) {
      logger.error('Error updating memory for character', {
        characterId,
        memoryId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Delete a memory
   * @param id The memory ID
   * @returns Promise<boolean> True if memory was deleted, false if not found
   */
  async delete(id: string): Promise<boolean> {
    logger.debug('Deleting memory', { memoryId: id });
    try {
      const result = await this._delete(id);

      if (result) {
        logger.debug('Memory deleted successfully', { memoryId: id });
      }

      return result;
    } catch (error) {
      logger.error('Error deleting memory', {
        memoryId: id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Delete a specific character's memory
   * @param characterId The character ID
   * @param memoryId The memory ID
   * @returns Promise<boolean> True if memory was deleted, false if not found or doesn't belong to character
   */
  async deleteForCharacter(characterId: string, memoryId: string): Promise<boolean> {
    logger.debug('Deleting memory for character', { characterId, memoryId });
    try {
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
    } catch (error) {
      logger.error('Error deleting memory for character', {
        characterId,
        memoryId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Delete multiple memories for a character
   * @param characterId The character ID
   * @param memoryIds Array of memory IDs to delete
   * @returns Promise<number> Number of memories successfully deleted
   */
  async bulkDelete(characterId: string, memoryIds: string[]): Promise<number> {
    logger.debug('Bulk deleting memories for character', { characterId, count: memoryIds.length });
    try {
      if (memoryIds.length === 0) {
        logger.debug('Empty memory IDs array provided', { characterId });
        return 0;
      }

      const deletedCount = await this.deleteMany({
        characterId,
        id: { $in: memoryIds },
      } as QueryFilter);

      logger.debug('Bulk deletion completed', { characterId, deletedCount });
      return deletedCount;
    } catch (error) {
      logger.error('Error bulk deleting memories for character', {
        characterId,
        count: memoryIds.length,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Update the lastAccessedAt timestamp for a memory
   * @param characterId The character ID
   * @param memoryId The memory ID
   * @returns Promise<Memory | null> The updated memory if found, null otherwise
   */
  async updateAccessTime(characterId: string, memoryId: string): Promise<Memory | null> {
    logger.debug('Updating memory access time', { characterId, memoryId });
    try {
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
    } catch (error) {
      logger.error('Error updating memory access time', {
        characterId,
        memoryId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Count the number of memories for a character
   * @param characterId The character ID
   * @returns Promise<number> Number of memories for the character
   */
  async countByCharacterId(characterId: string): Promise<number> {
    logger.debug('Counting memories for character', { characterId });
    try {
      const count = await this.count({ characterId } as QueryFilter);

      logger.debug('Memory count retrieved', { characterId, count });
      return count;
    } catch (error) {
      logger.error('Error counting memories for character', {
        characterId,
        error: error instanceof Error ? error.message : String(error),
      });
      return 0;
    }
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
    logger.debug('Finding memories by character about another character', {
      characterId,
      aboutCharacterId,
    });
    try {
      const memories = await this.findByFilter(
        { characterId, aboutCharacterId } as QueryFilter,
        {
          sort: { importance: -1, createdAt: -1 },
        }
      );

      logger.debug('Found memories about character', {
        characterId,
        aboutCharacterId,
        count: memories.length,
      });
      return memories;
    } catch (error) {
      logger.error('Error finding memories about character', {
        characterId,
        aboutCharacterId,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
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
    logger.debug('Finding memories by character about multiple characters', {
      characterId,
      aboutCharacterCount: aboutCharacterIds.length,
    });
    try {
      if (aboutCharacterIds.length === 0) {
        logger.debug('Empty aboutCharacterIds array provided', { characterId });
        return [];
      }

      const memories = await this.findByFilter(
        {
          characterId,
          aboutCharacterId: { $in: aboutCharacterIds },
        } as QueryFilter,
        {
          sort: { importance: -1, createdAt: -1 },
        }
      );

      logger.debug('Found memories about characters', {
        characterId,
        aboutCharacterCount: aboutCharacterIds.length,
        count: memories.length,
      });
      return memories;
    } catch (error) {
      logger.error('Error finding memories about characters', {
        characterId,
        aboutCharacterCount: aboutCharacterIds.length,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Find all memories associated with a specific chat
   * @param chatId The chat ID
   * @returns Promise<Memory[]> Array of memories associated with the chat
   */
  async findByChatId(chatId: string): Promise<Memory[]> {
    logger.debug('Finding memories by chat ID', { chatId });
    try {
      const memories = await this.findByFilter({ chatId } as QueryFilter);

      logger.debug('Found memories for chat', { chatId, count: memories.length });
      return memories;
    } catch (error) {
      logger.error('Error finding memories by chat ID', {
        chatId,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Find all memories associated with a specific source message
   * @param sourceMessageId The source message ID
   * @returns Promise<Memory[]> Array of memories created from the message
   */
  async findBySourceMessageId(sourceMessageId: string): Promise<Memory[]> {
    logger.debug('Finding memories by source message ID', { sourceMessageId });
    try {
      const memories = await this.findByFilter({ sourceMessageId } as QueryFilter);

      logger.debug('Found memories for source message', { sourceMessageId, count: memories.length });
      return memories;
    } catch (error) {
      logger.error('Error finding memories by source message ID', {
        sourceMessageId,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Delete all memories associated with a specific source message
   * @param sourceMessageId The source message ID
   * @returns Promise<number> Number of memories deleted
   */
  async deleteBySourceMessageId(sourceMessageId: string): Promise<number> {
    logger.debug('Deleting memories by source message ID', { sourceMessageId });
    try {
      const deletedCount = await this.deleteMany({ sourceMessageId } as QueryFilter);

      logger.debug('Deleted memories for source message', {
        sourceMessageId,
        deletedCount,
      });
      return deletedCount;
    } catch (error) {
      logger.error('Error deleting memories by source message ID', {
        sourceMessageId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Delete all memories associated with multiple source messages (for swipe groups)
   * @param sourceMessageIds Array of source message IDs
   * @returns Promise<number> Number of memories deleted
   */
  async deleteBySourceMessageIds(sourceMessageIds: string[]): Promise<number> {
    logger.debug('Deleting memories by source message IDs', {
      count: sourceMessageIds.length,
    });
    try {
      if (sourceMessageIds.length === 0) {
        return 0;
      }

      const deletedCount = await this.deleteMany({
        sourceMessageId: { $in: sourceMessageIds },
      } as QueryFilter);

      logger.debug('Deleted memories for source messages', {
        requestedCount: sourceMessageIds.length,
        deletedCount,
      });
      return deletedCount;
    } catch (error) {
      logger.error('Error deleting memories by source message IDs', {
        count: sourceMessageIds.length,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Count memories associated with a specific source message
   * @param sourceMessageId The source message ID
   * @returns Promise<number> Number of memories for the message
   */
  async countBySourceMessageId(sourceMessageId: string): Promise<number> {
    logger.debug('Counting memories for source message', { sourceMessageId });
    try {
      const count = await this.count({ sourceMessageId } as QueryFilter);

      logger.debug('Memory count for source message', { sourceMessageId, count });
      return count;
    } catch (error) {
      logger.error('Error counting memories for source message', {
        sourceMessageId,
        error: error instanceof Error ? error.message : String(error),
      });
      return 0;
    }
  }

  /**
   * Count memories associated with multiple source messages (for swipe groups)
   * @param sourceMessageIds Array of source message IDs
   * @returns Promise<number> Total number of memories
   */
  async countBySourceMessageIds(sourceMessageIds: string[]): Promise<number> {
    logger.debug('Counting memories for source messages', {
      count: sourceMessageIds.length,
    });
    try {
      if (sourceMessageIds.length === 0) {
        return 0;
      }

      const count = await this.count({
        sourceMessageId: { $in: sourceMessageIds },
      } as QueryFilter);

      logger.debug('Memory count for source messages', {
        requestedCount: sourceMessageIds.length,
        count,
      });
      return count;
    } catch (error) {
      logger.error('Error counting memories for source messages', {
        count: sourceMessageIds.length,
        error: error instanceof Error ? error.message : String(error),
      });
      return 0;
    }
  }

  /**
   * Delete all memories associated with a specific chat
   * @param chatId The chat ID
   * @returns Promise<number> Number of memories deleted
   */
  async deleteByChatId(chatId: string): Promise<number> {
    logger.debug('Deleting memories by chat ID', { chatId });
    try {
      const deletedCount = await this.deleteMany({ chatId } as QueryFilter);

      logger.debug('Deleted memories for chat', { chatId, deletedCount });
      return deletedCount;
    } catch (error) {
      logger.error('Error deleting memories by chat ID', {
        chatId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Count memories associated with a specific chat
   * @param chatId The chat ID
   * @returns Promise<number> Number of memories for the chat
   */
  async countByChatId(chatId: string): Promise<number> {
    logger.debug('Counting memories for chat', { chatId });
    try {
      const count = await this.count({ chatId } as QueryFilter);

      logger.debug('Memory count for chat', { chatId, count });
      return count;
    } catch (error) {
      logger.error('Error counting memories for chat', {
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
   * Find all memories for a specific persona
   * @deprecated Use findByAboutCharacterId instead.
   * Characters Not Personas - Phase 7: personaId is migrated to aboutCharacterId.
   * @param personaId The persona ID
   * @returns Promise<Memory[]> Array of memories associated with the persona
   */
  async findByPersonaId(personaId: string): Promise<Memory[]> {
    logger.debug('Finding memories by persona ID', { personaId });
    try {
      const memories = await this.findByFilter({ personaId } as QueryFilter);

      logger.debug('Found memories for persona', { personaId, count: memories.length });
      return memories;
    } catch (error) {
      logger.error('Error finding memories by persona ID', {
        personaId,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
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
    logger.debug('Finding memories by aboutCharacterId', { aboutCharacterId });
    try {
      // Query both aboutCharacterId (new) and personaId (legacy, for backward compat)
      const memories = await this.findByFilter({
        $or: [
          { aboutCharacterId },
          { personaId: aboutCharacterId }, // Legacy support during migration
        ],
      } as QueryFilter);

      logger.debug('Found memories about character', { aboutCharacterId, count: memories.length });
      return memories;
    } catch (error) {
      logger.error('Error finding memories by aboutCharacterId', {
        aboutCharacterId,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Count memories containing specific text
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
    logger.debug('Counting memories with text', {
      characterId,
      personaId,
      chatId,
      searchTextLength: searchText.length,
    });
    try {
      const regex = new RegExp(searchText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');

      // Build the query filter
      const filter: QueryFilter = {
        $or: [{ content: { $regex: regex } }, { summary: { $regex: regex } }],
      };

      if (characterId) filter.characterId = characterId;
      if (personaId) filter.personaId = personaId;
      if (chatId) filter.chatId = chatId;

      const count = await this.count(filter);

      logger.debug('Counted memories with text', { characterId, personaId, chatId, count });
      return count;
    } catch (error) {
      logger.error('Error counting memories with text', {
        characterId,
        personaId,
        chatId,
        error: error instanceof Error ? error.message : String(error),
      });
      return 0;
    }
  }

  /**
   * Find memories containing specific text
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
    logger.debug('Finding memories with text', {
      characterId,
      personaId,
      chatId,
      searchTextLength: searchText.length,
    });
    try {
      const regex = new RegExp(searchText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');

      // Build the query filter
      const filter: QueryFilter = {
        $or: [{ content: { $regex: regex } }, { summary: { $regex: regex } }],
      };

      if (characterId) filter.characterId = characterId;
      if (personaId) filter.personaId = personaId;
      if (chatId) filter.chatId = chatId;

      const memories = await this.findByFilter(filter);

      logger.debug('Found memories with text', {
        characterId,
        personaId,
        chatId,
        count: memories.length,
      });
      return memories;
    } catch (error) {
      logger.error('Error finding memories with text', {
        characterId,
        personaId,
        chatId,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Replace text in memory content and summary for specific memories
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
    logger.debug('Replacing text in memories', {
      memoryCount: memoryIds.length,
      searchTextLength: searchText.length,
      replaceTextLength: replaceText.length,
    });
    try {
      if (memoryIds.length === 0) {
        logger.debug('Empty memory IDs array provided');
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

        if (contentChanged) {
          const updated = await this.update(memoryId, {
            content: newContent,
            summary: newSummary,
          });

          if (updated) {
            updatedMemories.push(updated);
          }
        }
      }

      logger.info('Replaced text in memories', { updatedCount: updatedMemories.length });
      return updatedMemories;
    } catch (error) {
      logger.error('Error replacing text in memories', {
        memoryCount: memoryIds.length,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
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
    logger.debug('Searching memories about character by content', {
      characterId,
      aboutCharacterId,
      queryLength: query.length,
    });
    try {
      const regex = new RegExp(query, 'i');

      const memories = await this.findByFilter({
        characterId,
        aboutCharacterId,
        $or: [{ content: { $regex: regex } }, { summary: { $regex: regex } }],
      } as QueryFilter);

      logger.debug('Found memories about character by content search', {
        characterId,
        aboutCharacterId,
        count: memories.length,
      });
      return memories;
    } catch (error) {
      logger.error('Error searching memories about character by content', {
        characterId,
        aboutCharacterId,
        queryLength: query.length,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }
}
