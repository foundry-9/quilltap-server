/**
 * MongoDB Characters Repository
 *
 * Handles CRUD operations and advanced queries for Character entities.
 * Each character is stored as a document in the 'characters' MongoDB collection.
 */

import { Character, CharacterInput, CharacterSchema, PhysicalDescription, CharacterSystemPrompt } from '@/lib/schemas/types';
import { MongoBaseRepository, CreateOptions } from './base.repository';
import { logger } from '@/lib/logger';

export class CharactersRepository extends MongoBaseRepository<Character> {
  constructor() {
    super('characters', CharacterSchema);
  }

  /**
   * Find a character by ID
   * @param id The character ID
   * @returns Promise<Character | null> The character if found, null otherwise
   */
  async findById(id: string): Promise<Character | null> {
    try {
      const collection = await this.getCollection();
      const result = await collection.findOne({ id });

      if (!result) {
        logger.debug('Character not found', { characterId: id });
        return null;
      }

      return this.validate(result);
    } catch (error) {
      logger.error('Error finding character by ID', {
        characterId: id,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Find all characters
   * @returns Promise<Character[]> Array of all characters
   */
  async findAll(): Promise<Character[]> {
    try {
      const collection = await this.getCollection();
      const results = await collection.find({}).toArray();

      return results
        .map((doc) => {
          const validation = this.validateSafe(doc);
          if (validation.success && validation.data) {
            return validation.data;
          }
          return null;
        })
        .filter((char): char is Character => char !== null);
    } catch (error) {
      logger.error('Error finding all characters', {
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Find characters by user ID
   * @param userId The user ID
   * @returns Promise<Character[]> Array of characters belonging to the user
   */
  async findByUserId(userId: string): Promise<Character[]> {
    try {
      const collection = await this.getCollection();
      const results = await collection.find({ userId }).toArray();

      return results
        .map((doc) => {
          const validation = this.validateSafe(doc);
          if (validation.success && validation.data) {
            return validation.data;
          }
          return null;
        })
        .filter((char): char is Character => char !== null);
    } catch (error) {
      logger.error('Error finding characters by user ID', {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Find user-controlled characters by user ID
   * @param userId The user ID
   * @returns Promise<Character[]> Array of user-controlled characters
   */
  async findUserControlled(userId: string): Promise<Character[]> {
    try {
      const collection = await this.getCollection();
      const results = await collection.find({
        userId,
        controlledBy: 'user',
      }).toArray();

      return results
        .map((doc) => {
          const validation = this.validateSafe(doc);
          if (validation.success && validation.data) {
            return validation.data;
          }
          return null;
        })
        .filter((char): char is Character => char !== null);
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
      const collection = await this.getCollection();
      // Include characters with no controlledBy field (defaults to llm)
      const results = await collection.find({
        userId,
        $or: [
          { controlledBy: 'llm' },
          { controlledBy: { $exists: false } },
        ],
      }).toArray();

      return results
        .map((doc) => {
          const validation = this.validateSafe(doc);
          if (validation.success && validation.data) {
            return validation.data;
          }
          return null;
        })
        .filter((char): char is Character => char !== null);
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
    if (ids.length === 0) {
      return [];
    }

    try {
      const collection = await this.getCollection();
      const results = await collection.find({ id: { $in: ids } }).toArray();

      const characters = results
        .map((doc) => {
          const validation = this.validateSafe(doc);
          if (validation.success && validation.data) {
            return validation.data;
          }
          return null;
        })
        .filter((char): char is Character => char !== null);

      logger.debug('Found characters by IDs', { requestedCount: ids.length, foundCount: characters.length });
      return characters;
    } catch (error) {
      logger.error('Error finding characters by IDs', {
        idCount: ids.length,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Find characters that use a specific image as their default
   * @param imageId The image file ID
   * @returns Promise<Character[]> Array of characters using this image as default
   */
  async findByDefaultImageId(imageId: string): Promise<Character[]> {
    try {
      const collection = await this.getCollection();
      const results = await collection.find({ defaultImageId: imageId }).toArray();

      return results
        .map((doc) => {
          const validation = this.validateSafe(doc);
          if (validation.success && validation.data) {
            return validation.data;
          }
          return null;
        })
        .filter((char): char is Character => char !== null);
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
      const collection = await this.getCollection();
      const results = await collection.find({
        'avatarOverrides.imageId': imageId,
      }).toArray();

      return results
        .map((doc) => {
          const validation = this.validateSafe(doc);
          if (validation.success && validation.data) {
            return validation.data;
          }
          return null;
        })
        .filter((char): char is Character => char !== null);
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
    try {
      const collection = await this.getCollection();
      const results = await collection.find({ tags: { $in: [tagId] } }).toArray();

      return results
        .map((doc) => {
          const validation = this.validateSafe(doc);
          if (validation.success && validation.data) {
            return validation.data;
          }
          return null;
        })
        .filter((char): char is Character => char !== null);
    } catch (error) {
      logger.error('Error finding characters by tag', {
        tagId,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
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
      const id = options?.id || this.generateId();
      const now = this.getCurrentTimestamp();
      const createdAt = options?.createdAt || now;

      // Use schema.parse to apply defaults for fields like talkativeness, isFavorite, etc.
      const characterInput = {
        ...data,
        id,
        createdAt,
        updatedAt: now,
      };

      const validated = this.validate(characterInput);
      const collection = await this.getCollection();
      await collection.insertOne(validated as any);

      logger.info('Character created', { characterId: id, userId: data.userId, name: data.name });
      return validated;
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
      const existing = await this.findById(id);
      if (!existing) {
        logger.warn('Character not found for update', { characterId: id });
        return null;
      }

      const now = this.getCurrentTimestamp();
      const updated: Character = {
        ...existing,
        ...data,
        id: existing.id, // Preserve ID
        createdAt: existing.createdAt, // Preserve creation timestamp
        updatedAt: now,
      };

      const validated = this.validate(updated);
      const collection = await this.getCollection();

      await collection.updateOne({ id }, { $set: validated as any });

      return validated;
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
      const collection = await this.getCollection();
      const result = await collection.deleteOne({ id });

      if (result.deletedCount === 0) {
        logger.warn('Character not found for deletion', { characterId: id });
        return false;
      }

      logger.info('Character deleted', { characterId: id });
      return true;
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
    logger.debug('Adding tag to character', { characterId, tagId });
    try {
      const character = await this.findById(characterId);
      if (!character) {
        logger.warn('Character not found for tag addition', { characterId });
        return null;
      }

      if (!character.tags.includes(tagId)) {
        character.tags.push(tagId);
        logger.debug('Tag added to character tags array', { characterId, tagId });
        return await this.update(characterId, { tags: character.tags });
      }

      logger.debug('Tag already exists on character', { characterId, tagId });
      return character;
    } catch (error) {
      logger.error('Error adding tag to character', {
        characterId,
        tagId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Remove a tag from a character
   * @param characterId The character ID
   * @param tagId The tag ID
   * @returns Promise<Character | null> The updated character if found, null otherwise
   */
  async removeTag(characterId: string, tagId: string): Promise<Character | null> {
    logger.debug('Removing tag from character', { characterId, tagId });
    try {
      const character = await this.findById(characterId);
      if (!character) {
        logger.warn('Character not found for tag removal', { characterId });
        return null;
      }

      const beforeCount = character.tags.length;
      character.tags = character.tags.filter((id) => id !== tagId);
      const afterCount = character.tags.length;

      if (beforeCount !== afterCount) {
        logger.debug('Tag removed from character', { characterId, tagId });
        return await this.update(characterId, { tags: character.tags });
      }

      logger.debug('Tag not found on character', { characterId, tagId });
      return character;
    } catch (error) {
      logger.error('Error removing tag from character', {
        characterId,
        tagId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
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
    logger.debug('Adding persona link to character', { characterId, personaId, isDefault });
    try {
      const character = await this.findById(characterId);
      if (!character) {
        logger.warn('Character not found for persona link addition', { characterId });
        return null;
      }

      const existing = character.personaLinks.find((link) => link.personaId === personaId);
      if (!existing) {
        character.personaLinks.push({ personaId, isDefault });
        logger.debug('Persona link added to character', { characterId, personaId, isDefault });
        return await this.update(characterId, { personaLinks: character.personaLinks });
      }

      logger.debug('Persona link already exists on character', { characterId, personaId });
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
    logger.debug('Removing persona link from character', { characterId, personaId });
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
        logger.debug('Persona link removed from character', { characterId, personaId });
        return await this.update(characterId, { personaLinks: character.personaLinks });
      }

      logger.debug('Persona link not found on character', { characterId, personaId });
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
    logger.debug('Setting favorite status for character', { characterId, isFavorite });
    try {
      const result = await this.update(characterId, { isFavorite });

      if (result) {
        logger.debug('Favorite status updated', { characterId, isFavorite });
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
    logger.debug('Setting controlledBy status for character', { characterId, controlledBy });
    try {
      const result = await this.update(characterId, { controlledBy });

      if (result) {
        logger.debug('ControlledBy status updated', { characterId, controlledBy });
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
    logger.debug('Adding physical description to character', { characterId, descriptionName: data.name });
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

      logger.debug('Physical description added successfully', {
        characterId,
        descriptionId: description.id,
      });
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
    logger.debug('Updating physical description', { characterId, descriptionId });
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

      logger.debug('Physical description updated successfully', { characterId, descriptionId });
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
    logger.debug('Removing physical description from character', { characterId, descriptionId });
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

      logger.debug('Physical description removed successfully', { characterId, descriptionId });
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
    logger.debug('Getting physical description', { characterId, descriptionId });
    try {
      const character = await this.findById(characterId);
      if (!character) {
        logger.warn('Character not found for description retrieval', { characterId });
        return null;
      }

      const descriptions = character.physicalDescriptions || [];
      const description = descriptions.find((d) => d.id === descriptionId) || null;

      logger.debug('Physical description retrieval completed', {
        characterId,
        descriptionId,
        found: description !== null,
      });
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
    logger.debug('Getting all physical descriptions for character', { characterId });
    try {
      const character = await this.findById(characterId);
      if (!character) {
        logger.warn('Character not found for descriptions retrieval', { characterId });
        return [];
      }

      const descriptions = character.physicalDescriptions || [];
      logger.debug('Retrieved physical descriptions', { characterId, count: descriptions.length });
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
    logger.debug('Adding system prompt to character', { characterId, promptName: data.name });
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

      logger.debug('System prompt added successfully', {
        characterId,
        promptId: prompt.id,
      });
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
    logger.debug('Updating system prompt', { characterId, promptId });
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

      logger.debug('System prompt updated successfully', { characterId, promptId });
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
    logger.debug('Deleting system prompt from character', { characterId, promptId });
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

      logger.debug('System prompt deleted successfully', { characterId, promptId });
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
    logger.debug('Setting default system prompt', { characterId, promptId });
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

      logger.debug('Default system prompt set successfully', { characterId, promptId });
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
    logger.debug('Getting system prompt', { characterId, promptId });
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
    logger.debug('Getting all system prompts for character', { characterId });
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
