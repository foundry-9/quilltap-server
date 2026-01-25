/**
 * Characters Repository
 *
 * Backend-agnostic repository for Character entities.
 * Works with both MongoDB and SQLite through the database abstraction layer.
 * Handles CRUD operations and advanced queries for Character entities.
 */

import { Character, CharacterInput, CharacterSchema, PhysicalDescription, CharacterSystemPrompt } from '@/lib/schemas/types';
import { TaggableBaseRepository, CreateOptions } from './base.repository';
import { logger } from '@/lib/logger';
import { QueryFilter } from '../interfaces';

/**
 * Characters Repository
 * Implements CRUD operations for characters with support for tags, personas, favorites, and physical descriptions.
 */
export class CharactersRepository extends TaggableBaseRepository<Character> {
  constructor() {
    super('characters', CharacterSchema);
  }

  /**
   * Find a character by ID
   * @param id The character ID
   * @returns Promise<Character | null> The character if found, null otherwise
   */
  async findById(id: string): Promise<Character | null> {
    return this._findById(id);
  }

  /**
   * Find all characters
   * @returns Promise<Character[]> Array of all characters
   */
  async findAll(): Promise<Character[]> {
    return this._findAll();
  }

  /**
   * Find characters by user ID
   * @param userId The user ID
   * @returns Promise<Character[]> Array of characters belonging to the user
   */
  async findByUserId(userId: string): Promise<Character[]> {
    return super.findByUserId(userId);
  }

  /**
   * Find user-controlled characters by user ID
   * @param userId The user ID
   * @returns Promise<Character[]> Array of user-controlled characters
   */
  async findUserControlled(userId: string): Promise<Character[]> {
    try {
      const results = await this.findByFilter({
        userId,
        controlledBy: 'user',
      } as QueryFilter);
      return results;
    } catch (error) {
      logger.error('Error finding user-controlled characters', {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Find LLM-controlled characters by user ID
   * @param userId The user ID
   * @returns Promise<Character[]> Array of LLM-controlled characters
   */
  async findLLMControlled(userId: string): Promise<Character[]> {
    try {
      // Include characters with no controlledBy field (defaults to llm)
      const results = await this.findByFilter({
        userId,
        $or: [
          { controlledBy: 'llm' },
          { controlledBy: { $exists: false } },
        ],
      } as QueryFilter);
      return results;
    } catch (error) {
      logger.error('Error finding LLM-controlled characters', {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Find multiple characters by their IDs in a single query
   * @param ids Array of character IDs
   * @returns Promise<Character[]> Array of found characters (may be shorter than input if some IDs don't exist)
   */
  async findByIds(ids: string[]): Promise<Character[]> {
    return super.findByIds(ids);
  }

  /**
   * Find characters that use a specific image as their default
   * @param imageId The image file ID
   * @returns Promise<Character[]> Array of characters using this image as default
   */
  async findByDefaultImageId(imageId: string): Promise<Character[]> {
    try {
      const results = await this.findByFilter({
        defaultImageId: imageId,
      } as QueryFilter);
      return results;
    } catch (error) {
      logger.error('Error finding characters by default image ID', {
        imageId,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Find characters that use a specific image in their avatar overrides
   * @param imageId The image file ID
   * @returns Promise<Character[]> Array of characters using this image in overrides
   */
  async findByAvatarOverrideImageId(imageId: string): Promise<Character[]> {
    try {
      const results = await this.findByFilter({
        'avatarOverrides.imageId': imageId,
      } as QueryFilter);
      return results;
    } catch (error) {
      logger.error('Error finding characters by avatar override image ID', {
        imageId,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Find characters with a specific tag
   * @param tagId The tag ID
   * @returns Promise<Character[]> Array of characters with the tag
   */
  async findByTag(tagId: string): Promise<Character[]> {
    return super.findByTag(tagId);
  }

  /**
   * Create a new character
   * @param data The character data (without id, createdAt, updatedAt). Fields with defaults are optional.
   * @param options Optional CreateOptions to specify ID and createdAt (for sync)
   * @returns Promise<Character> The created character with generated id and timestamps
   */
  async create(
    data: Omit<CharacterInput, 'id' | 'createdAt' | 'updatedAt'>,
    options?: CreateOptions
  ): Promise<Character> {
    try {
      // Ensure required defaults for Character from CharacterInput
      const characterData = {
        ...data,
        tags: data.tags ?? [],
        isFavorite: data.isFavorite ?? false,
        personaLinks: data.personaLinks ?? [],
        avatarOverrides: data.avatarOverrides ?? [],
        physicalDescriptions: data.physicalDescriptions ?? [],
        systemPrompts: data.systemPrompts ?? [],
      } as Omit<Character, 'id' | 'createdAt' | 'updatedAt'>;

      const character = await this._create(characterData, options);

      logger.info('Character created', {
        characterId: character.id,
        userId: data.userId,
        name: data.name,
      });

      return character;
    } catch (error) {
      logger.error('Error creating character', {
        userId: data.userId,
        name: data.name,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Update a character
   * @param id The character ID
   * @param data Partial character data to update
   * @returns Promise<Character | null> The updated character if found, null otherwise
   */
  async update(id: string, data: Partial<Character>): Promise<Character | null> {
    try {
      const result = await this._update(id, data);

      if (result) {
      }

      return result;
    } catch (error) {
      logger.error('Error updating character', {
        characterId: id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Delete a character
   * @param id The character ID
   * @returns Promise<boolean> True if character was deleted, false if not found
   */
  async delete(id: string): Promise<boolean> {
    try {
      const result = await this._delete(id);

      if (result) {
        logger.info('Character deleted', { characterId: id });
      }

      return result;
    } catch (error) {
      logger.error('Error deleting character', {
        characterId: id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  // ============================================================================
  // TAG OPERATIONS
  // ============================================================================

  /**
   * Add a tag to a character
   * @param characterId The character ID
   * @param tagId The tag ID
   * @returns Promise<Character | null> The updated character if found, null otherwise
   */
  async addTag(characterId: string, tagId: string): Promise<Character | null> {
    return super.addTag(characterId, tagId);
  }

  /**
   * Remove a tag from a character
   * @param characterId The character ID
   * @param tagId The tag ID
   * @returns Promise<Character | null> The updated character if found, null otherwise
   */
  async removeTag(characterId: string, tagId: string): Promise<Character | null> {
    return super.removeTag(characterId, tagId);
  }

  // ============================================================================
  // PERSONA LINK OPERATIONS
  // ============================================================================

  /**
   * Add a persona link to a character
   * @param characterId The character ID
   * @param personaId The persona ID
   * @param isDefault Whether this persona should be the default
   * @returns Promise<Character | null> The updated character if found, null otherwise
   */
  async addPersona(characterId: string, personaId: string, isDefault = false): Promise<Character | null> {
    try {
      const character = await this.findById(characterId);
      if (!character) {
        logger.warn('Character not found for persona link addition', { characterId });
        return null;
      }

      const existing = character.personaLinks.find((link) => link.personaId === personaId);
      if (!existing) {
        character.personaLinks.push({ personaId, isDefault });
        return await this.update(characterId, { personaLinks: character.personaLinks });
      }
      return character;
    } catch (error) {
      logger.error('Error adding persona link to character', {
        characterId,
        personaId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Remove a persona link from a character
   * @param characterId The character ID
   * @param personaId The persona ID
   * @returns Promise<Character | null> The updated character if found, null otherwise
   */
  async removePersona(characterId: string, personaId: string): Promise<Character | null> {
    try {
      const character = await this.findById(characterId);
      if (!character) {
        logger.warn('Character not found for persona link removal', { characterId });
        return null;
      }

      const beforeCount = character.personaLinks.length;
      character.personaLinks = character.personaLinks.filter((link) => link.personaId !== personaId);
      const afterCount = character.personaLinks.length;

      if (beforeCount !== afterCount) {
        return await this.update(characterId, { personaLinks: character.personaLinks });
      }
      return character;
    } catch (error) {
      logger.error('Error removing persona link from character', {
        characterId,
        personaId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  // ============================================================================
  // FAVORITE OPERATIONS
  // ============================================================================

  /**
   * Set favorite status for a character
   * @param characterId The character ID
   * @param isFavorite Whether the character is marked as favorite
   * @returns Promise<Character | null> The updated character if found, null otherwise
   */
  async setFavorite(characterId: string, isFavorite: boolean): Promise<Character | null> {
    try {
      const result = await this.update(characterId, { isFavorite });

      if (result) {
      }

      return result;
    } catch (error) {
      logger.error('Error setting favorite status', {
        characterId,
        isFavorite,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Set controlled-by status for a character
   * @param characterId The character ID
   * @param controlledBy Who controls the character: 'llm' or 'user'
   * @returns Promise<Character | null> The updated character if found, null otherwise
   */
  async setControlledBy(characterId: string, controlledBy: 'llm' | 'user'): Promise<Character | null> {
    try {
      const result = await this.update(characterId, { controlledBy });

      if (result) {
      }

      return result;
    } catch (error) {
      logger.error('Error setting controlledBy status', {
        characterId,
        controlledBy,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  // ============================================================================
  // PHYSICAL DESCRIPTION OPERATIONS
  // ============================================================================

  /**
   * Add a physical description to a character
   * @param characterId The character ID
   * @param data The physical description data (without id, createdAt, updatedAt)
   * @returns Promise<PhysicalDescription | null> The added description if successful, null if character not found
   */
  async addDescription(
    characterId: string,
    data: Omit<PhysicalDescription, 'id' | 'createdAt' | 'updatedAt'>
  ): Promise<PhysicalDescription | null> {
    try {
      const character = await this.findById(characterId);
      if (!character) {
        logger.warn('Character not found for description addition', { characterId });
        return null;
      }

      const now = this.getCurrentTimestamp();
      const description: PhysicalDescription = {
        ...data,
        id: this.generateId(),
        createdAt: now,
        updatedAt: now,
      };

      character.physicalDescriptions = character.physicalDescriptions || [];
      character.physicalDescriptions.push(description);

      await this.update(characterId, { physicalDescriptions: character.physicalDescriptions });
      return description;
    } catch (error) {
      logger.error('Error adding physical description', {
        characterId,
        descriptionName: data.name,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Update a physical description
   * @param characterId The character ID
   * @param descriptionId The description ID
   * @param data Partial description data to update
   * @returns Promise<PhysicalDescription | null> The updated description if found, null otherwise
   */
  async updateDescription(
    characterId: string,
    descriptionId: string,
    data: Partial<Omit<PhysicalDescription, 'id' | 'createdAt' | 'updatedAt'>>
  ): Promise<PhysicalDescription | null> {
    try {
      const character = await this.findById(characterId);
      if (!character) {
        logger.warn('Character not found for description update', { characterId });
        return null;
      }

      const descriptions = character.physicalDescriptions || [];
      const index = descriptions.findIndex((d) => d.id === descriptionId);
      if (index === -1) {
        logger.warn('Physical description not found', { characterId, descriptionId });
        return null;
      }

      const now = this.getCurrentTimestamp();
      const updated: PhysicalDescription = {
        ...descriptions[index],
        ...data,
        id: descriptions[index].id,
        createdAt: descriptions[index].createdAt,
        updatedAt: now,
      };

      descriptions[index] = updated;
      await this.update(characterId, { physicalDescriptions: descriptions });
      return updated;
    } catch (error) {
      logger.error('Error updating physical description', {
        characterId,
        descriptionId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Remove a physical description from a character
   * @param characterId The character ID
   * @param descriptionId The description ID
   * @returns Promise<boolean> True if description was deleted, false if not found
   */
  async removeDescription(characterId: string, descriptionId: string): Promise<boolean> {
    try {
      const character = await this.findById(characterId);
      if (!character) {
        logger.warn('Character not found for description removal', { characterId });
        return false;
      }

      const descriptions = character.physicalDescriptions || [];
      const filtered = descriptions.filter((d) => d.id !== descriptionId);

      if (filtered.length === descriptions.length) {
        logger.warn('Physical description not found for removal', { characterId, descriptionId });
        return false;
      }

      await this.update(characterId, { physicalDescriptions: filtered });
      return true;
    } catch (error) {
      logger.error('Error removing physical description', {
        characterId,
        descriptionId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Get a single physical description by ID
   * @param characterId The character ID
   * @param descriptionId The description ID
   * @returns Promise<PhysicalDescription | null> The description if found, null otherwise
   */
  async getDescription(characterId: string, descriptionId: string): Promise<PhysicalDescription | null> {
    try {
      const character = await this.findById(characterId);
      if (!character) {
        logger.warn('Character not found for description retrieval', { characterId });
        return null;
      }

      const descriptions = character.physicalDescriptions || [];
      const description = descriptions.find((d) => d.id === descriptionId) || null;
      return description;
    } catch (error) {
      logger.error('Error getting physical description', {
        characterId,
        descriptionId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Get all physical descriptions for a character
   * @param characterId The character ID
   * @returns Promise<PhysicalDescription[]> Array of all descriptions for the character
   */
  async getDescriptions(characterId: string): Promise<PhysicalDescription[]> {
    try {
      const character = await this.findById(characterId);
      if (!character) {
        logger.warn('Character not found for descriptions retrieval', { characterId });
        return [];
      }

      const descriptions = character.physicalDescriptions || [];
      return descriptions;
    } catch (error) {
      logger.error('Error getting physical descriptions', {
        characterId,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  // ============================================================================
  // SYSTEM PROMPT OPERATIONS
  // ============================================================================

  /**
   * Add a system prompt to a character
   * @param characterId The character ID
   * @param data The system prompt data (without id, createdAt, updatedAt)
   * @returns Promise<CharacterSystemPrompt | null> The added prompt if successful
   */
  async addSystemPrompt(
    characterId: string,
    data: Omit<CharacterSystemPrompt, 'id' | 'createdAt' | 'updatedAt'>
  ): Promise<CharacterSystemPrompt | null> {
    try {
      const character = await this.findById(characterId);
      if (!character) {
        logger.warn('Character not found for prompt addition', { characterId });
        return null;
      }

      const now = this.getCurrentTimestamp();
      const prompt: CharacterSystemPrompt = {
        ...data,
        id: this.generateId(),
        createdAt: now,
        updatedAt: now,
      };

      // If this is the first prompt or isDefault is true, ensure only this one is default
      const prompts = character.systemPrompts || [];
      if (data.isDefault || prompts.length === 0) {
        // Unset default on all existing prompts
        prompts.forEach(p => p.isDefault = false);
        prompt.isDefault = true;
      }

      prompts.push(prompt);

      await this.update(characterId, { systemPrompts: prompts });
      return prompt;
    } catch (error) {
      logger.error('Error adding system prompt', {
        characterId,
        promptName: data.name,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Update a system prompt
   */
  async updateSystemPrompt(
    characterId: string,
    promptId: string,
    data: Partial<Omit<CharacterSystemPrompt, 'id' | 'createdAt' | 'updatedAt'>>
  ): Promise<CharacterSystemPrompt | null> {
    try {
      const character = await this.findById(characterId);
      if (!character) {
        logger.warn('Character not found for prompt update', { characterId });
        return null;
      }

      const prompts = character.systemPrompts || [];
      const index = prompts.findIndex(p => p.id === promptId);
      if (index === -1) {
        logger.warn('System prompt not found', { characterId, promptId });
        return null;
      }

      const now = this.getCurrentTimestamp();
      const updated: CharacterSystemPrompt = {
        ...prompts[index],
        ...data,
        id: prompts[index].id,
        createdAt: prompts[index].createdAt,
        updatedAt: now,
      };

      // If setting as default, unset others
      if (data.isDefault) {
        prompts.forEach(p => p.isDefault = false);
        updated.isDefault = true;
      }

      prompts[index] = updated;
      await this.update(characterId, { systemPrompts: prompts });
      return updated;
    } catch (error) {
      logger.error('Error updating system prompt', {
        characterId,
        promptId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Delete a system prompt from a character
   */
  async deleteSystemPrompt(characterId: string, promptId: string): Promise<boolean> {
    try {
      const character = await this.findById(characterId);
      if (!character) {
        logger.warn('Character not found for prompt deletion', { characterId });
        return false;
      }

      const prompts = character.systemPrompts || [];
      const filtered = prompts.filter(p => p.id !== promptId);

      if (filtered.length === prompts.length) {
        logger.warn('System prompt not found for deletion', { characterId, promptId });
        return false;
      }

      // If we deleted the default, set first remaining as default
      if (filtered.length > 0 && !filtered.some(p => p.isDefault)) {
        filtered[0].isDefault = true;
      }

      await this.update(characterId, { systemPrompts: filtered });
      return true;
    } catch (error) {
      logger.error('Error deleting system prompt', {
        characterId,
        promptId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Set a system prompt as default
   */
  async setDefaultSystemPrompt(characterId: string, promptId: string): Promise<Character | null> {
    try {
      const character = await this.findById(characterId);
      if (!character) {
        logger.warn('Character not found for setting default prompt', { characterId });
        return null;
      }

      const prompts = character.systemPrompts || [];
      const targetIndex = prompts.findIndex(p => p.id === promptId);

      if (targetIndex === -1) {
        logger.warn('System prompt not found', { characterId, promptId });
        return null;
      }

      // Unset all defaults, set target as default
      const now = this.getCurrentTimestamp();
      prompts.forEach((p, i) => {
        p.isDefault = i === targetIndex;
        p.updatedAt = now;
      });

      const result = await this.update(characterId, { systemPrompts: prompts });
      return result;
    } catch (error) {
      logger.error('Error setting default system prompt', {
        characterId,
        promptId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Get a single system prompt by ID
   */
  async getSystemPrompt(characterId: string, promptId: string): Promise<CharacterSystemPrompt | null> {
    try {
      const character = await this.findById(characterId);
      if (!character) {
        logger.warn('Character not found for prompt retrieval', { characterId });
        return null;
      }

      const prompts = character.systemPrompts || [];
      return prompts.find(p => p.id === promptId) || null;
    } catch (error) {
      logger.error('Error getting system prompt', {
        characterId,
        promptId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Get all system prompts for a character
   */
  async getSystemPrompts(characterId: string): Promise<CharacterSystemPrompt[]> {
    try {
      const character = await this.findById(characterId);
      if (!character) {
        logger.warn('Character not found for prompts retrieval', { characterId });
        return [];
      }

      return character.systemPrompts || [];
    } catch (error) {
      logger.error('Error getting system prompts', {
        characterId,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }
}
