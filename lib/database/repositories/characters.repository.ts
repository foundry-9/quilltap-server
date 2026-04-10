/**
 * Characters Repository
 *
 * Backend-agnostic repository for Character entities.
 * Works with SQLite through the database abstraction layer.
 * Handles CRUD operations and advanced queries for Character entities.
 */

import { Character, CharacterInput, CharacterSchema, PhysicalDescription, ClothingRecord, CharacterSystemPrompt, CharacterScenario } from '@/lib/schemas/types';
import { TaggableBaseRepository, CreateOptions } from './base.repository';
import { logger } from '@/lib/logger';
import { TypedQueryFilter } from '../interfaces';

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
    return this.safeQuery(
      async () => {
        const results = await this.findByFilter({
          userId,
          controlledBy: 'user',
        });
        return results;
      },
      'Error finding user-controlled characters',
      { userId },
      []
    );
  }

  /**
   * Find LLM-controlled characters by user ID
   * @param userId The user ID
   * @returns Promise<Character[]> Array of LLM-controlled characters
   */
  async findLLMControlled(userId: string): Promise<Character[]> {
    return this.safeQuery(
      async () => {
        // Include characters with no controlledBy field (defaults to llm)
        const results = await this.findByFilter({
          userId,
          $or: [
            { controlledBy: 'llm' },
            { controlledBy: { $exists: false } },
          ],
        } as TypedQueryFilter<Character>);
        return results;
      },
      'Error finding LLM-controlled characters',
      { userId },
      []
    );
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
    return this.safeQuery(
      async () => {
        const results = await this.findByFilter({
          defaultImageId: imageId,
        });
        return results;
      },
      'Error finding characters by default image ID',
      { imageId },
      []
    );
  }

  /**
   * Find characters that use a specific image in their avatar overrides
   * @param imageId The image file ID
   * @returns Promise<Character[]> Array of characters using this image in overrides
   */
  async findByAvatarOverrideImageId(imageId: string): Promise<Character[]> {
    return this.safeQuery(
      async () => {
        const results = await this.findByFilter({
          'avatarOverrides.imageId': imageId,
        } as TypedQueryFilter<Character>);
        return results;
      },
      'Error finding characters by avatar override image ID',
      { imageId },
      []
    );
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
    return this.safeQuery(
      async () => {
        // Ensure required defaults for Character from CharacterInput
        const characterData = {
          ...data,
          tags: data.tags ?? [],
          aliases: data.aliases ?? [],
          pronouns: data.pronouns ?? null,
          isFavorite: data.isFavorite ?? false,
          partnerLinks: data.partnerLinks ?? [],
          avatarOverrides: data.avatarOverrides ?? [],
          physicalDescriptions: data.physicalDescriptions ?? [],
          systemPrompts: data.systemPrompts ?? [],
          scenarios: data.scenarios ?? [],
        } as Omit<Character, 'id' | 'createdAt' | 'updatedAt'>;

        const character = await this._create(characterData, options);

        logger.info('Character created', {
          characterId: character.id,
          userId: data.userId,
          name: data.name,
        });

        return character;
      },
      'Error creating character',
      { userId: data.userId, name: data.name }
    );
  }

  /**
   * Update a character
   * @param id The character ID
   * @param data Partial character data to update
   * @returns Promise<Character | null> The updated character if found, null otherwise
   */
  async update(id: string, data: Partial<Character>): Promise<Character | null> {
    return this.safeQuery(
      async () => {
        const result = await this._update(id, data);
        return result;
      },
      'Error updating character',
      { characterId: id }
    );
  }

  /**
   * Delete a character
   * @param id The character ID
   * @returns Promise<boolean> True if character was deleted, false if not found
   */
  async delete(id: string): Promise<boolean> {
    return this.safeQuery(
      async () => {
        const result = await this._delete(id);

        if (result) {
          logger.info('Character deleted', { characterId: id });
        }

        return result;
      },
      'Error deleting character',
      { characterId: id }
    );
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
  // PARTNER LINK OPERATIONS
  // ============================================================================

  /**
   * Add a partner link to a character
   * @param characterId The character ID
   * @param partnerId The partner character ID
   * @param isDefault Whether this partner should be the default
   * @returns Promise<Character | null> The updated character if found, null otherwise
   */
  async addPartnerLink(characterId: string, partnerId: string, isDefault = false): Promise<Character | null> {
    return this.safeQuery(
      async () => {
        const character = await this.findById(characterId);
        if (!character) {
          logger.warn('Character not found for partner link addition', { characterId });
          return null;
        }

        const existing = character.partnerLinks.find((link) => link.partnerId === partnerId);
        if (!existing) {
          character.partnerLinks.push({ partnerId, isDefault });
          return await this.update(characterId, { partnerLinks: character.partnerLinks });
        }
        return character;
      },
      'Error adding partner link to character',
      { characterId, partnerId }
    );
  }

  /**
   * Remove a partner link from a character
   * @param characterId The character ID
   * @param partnerId The partner character ID
   * @returns Promise<Character | null> The updated character if found, null otherwise
   */
  async removePartnerLink(characterId: string, partnerId: string): Promise<Character | null> {
    return this.safeQuery(
      async () => {
        const character = await this.findById(characterId);
        if (!character) {
          logger.warn('Character not found for partner link removal', { characterId });
          return null;
        }

        const beforeCount = character.partnerLinks.length;
        character.partnerLinks = character.partnerLinks.filter((link) => link.partnerId !== partnerId);
        const afterCount = character.partnerLinks.length;

        if (beforeCount !== afterCount) {
          return await this.update(characterId, { partnerLinks: character.partnerLinks });
        }
        return character;
      },
      'Error removing partner link from character',
      { characterId, partnerId }
    );
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
    return this.safeQuery(
      async () => {
        const result = await this.update(characterId, { isFavorite });
        return result;
      },
      'Error setting favorite status',
      { characterId, isFavorite }
    );
  }

  /**
   * Set controlled-by status for a character
   * @param characterId The character ID
   * @param controlledBy Who controls the character: 'llm' or 'user'
   * @returns Promise<Character | null> The updated character if found, null otherwise
   */
  async setControlledBy(characterId: string, controlledBy: 'llm' | 'user'): Promise<Character | null> {
    return this.safeQuery(
      async () => {
        const result = await this.update(characterId, { controlledBy });
        return result;
      },
      'Error setting controlledBy status',
      { characterId, controlledBy }
    );
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
    return this.safeQuery(
      async () => {
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
      },
      'Error adding physical description',
      { characterId, descriptionName: data.name }
    );
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
    return this.safeQuery(
      async () => {
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
      },
      'Error updating physical description',
      { characterId, descriptionId }
    );
  }

  /**
   * Remove a physical description from a character
   * @param characterId The character ID
   * @param descriptionId The description ID
   * @returns Promise<boolean> True if description was deleted, false if not found
   */
  async removeDescription(characterId: string, descriptionId: string): Promise<boolean> {
    return this.safeQuery(
      async () => {
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
      },
      'Error removing physical description',
      { characterId, descriptionId }
    );
  }

  /**
   * Get a single physical description by ID
   * @param characterId The character ID
   * @param descriptionId The description ID
   * @returns Promise<PhysicalDescription | null> The description if found, null otherwise
   */
  async getDescription(characterId: string, descriptionId: string): Promise<PhysicalDescription | null> {
    return this.safeQuery(
      async () => {
        const character = await this.findById(characterId);
        if (!character) {
          logger.warn('Character not found for description retrieval', { characterId });
          return null;
        }

        const descriptions = character.physicalDescriptions || [];
        const description = descriptions.find((d) => d.id === descriptionId) || null;
        return description;
      },
      'Error getting physical description',
      { characterId, descriptionId }
    );
  }

  /**
   * Get all physical descriptions for a character
   * @param characterId The character ID
   * @returns Promise<PhysicalDescription[]> Array of all descriptions for the character
   */
  async getDescriptions(characterId: string): Promise<PhysicalDescription[]> {
    return this.safeQuery(
      async () => {
        const character = await this.findById(characterId);
        if (!character) {
          logger.warn('Character not found for descriptions retrieval', { characterId });
          return [];
        }

        const descriptions = character.physicalDescriptions || [];
        return descriptions;
      },
      'Error getting physical descriptions',
      { characterId },
      []
    );
  }

  // ============================================================================
  // CLOTHING RECORD OPERATIONS
  // ============================================================================

  /**
   * Add a clothing record to a character
   * @param characterId The character ID
   * @param data The clothing record data (without id, createdAt, updatedAt)
   * @returns Promise<ClothingRecord | null> The added record if successful, null if character not found
   */
  async addClothingRecord(
    characterId: string,
    data: Omit<ClothingRecord, 'id' | 'createdAt' | 'updatedAt'>
  ): Promise<ClothingRecord | null> {
    return this.safeQuery(
      async () => {
        const character = await this.findById(characterId);
        if (!character) {
          logger.warn('Character not found for clothing record addition', { characterId });
          return null;
        }

        const now = this.getCurrentTimestamp();
        const record: ClothingRecord = {
          ...data,
          id: this.generateId(),
          createdAt: now,
          updatedAt: now,
        };

        character.clothingRecords = character.clothingRecords || [];
        character.clothingRecords.push(record);

        await this.update(characterId, { clothingRecords: character.clothingRecords });
        return record;
      },
      'Error adding clothing record',
      { characterId, recordName: data.name }
    );
  }

  /**
   * Update a clothing record
   * @param characterId The character ID
   * @param recordId The clothing record ID
   * @param data Partial clothing record data to update
   * @returns Promise<ClothingRecord | null> The updated record if found, null otherwise
   */
  async updateClothingRecord(
    characterId: string,
    recordId: string,
    data: Partial<Omit<ClothingRecord, 'id' | 'createdAt' | 'updatedAt'>>
  ): Promise<ClothingRecord | null> {
    return this.safeQuery(
      async () => {
        const character = await this.findById(characterId);
        if (!character) {
          logger.warn('Character not found for clothing record update', { characterId });
          return null;
        }

        const records = character.clothingRecords || [];
        const index = records.findIndex((r) => r.id === recordId);
        if (index === -1) {
          logger.warn('Clothing record not found', { characterId, recordId });
          return null;
        }

        const now = this.getCurrentTimestamp();
        const updated: ClothingRecord = {
          ...records[index],
          ...data,
          id: records[index].id,
          createdAt: records[index].createdAt,
          updatedAt: now,
        };

        records[index] = updated;
        await this.update(characterId, { clothingRecords: records });
        return updated;
      },
      'Error updating clothing record',
      { characterId, recordId }
    );
  }

  /**
   * Remove a clothing record from a character
   * @param characterId The character ID
   * @param recordId The clothing record ID
   * @returns Promise<boolean> True if record was deleted, false if not found
   */
  async removeClothingRecord(characterId: string, recordId: string): Promise<boolean> {
    return this.safeQuery(
      async () => {
        const character = await this.findById(characterId);
        if (!character) {
          logger.warn('Character not found for clothing record removal', { characterId });
          return false;
        }

        const records = character.clothingRecords || [];
        const filtered = records.filter((r) => r.id !== recordId);

        if (filtered.length === records.length) {
          logger.warn('Clothing record not found for removal', { characterId, recordId });
          return false;
        }

        await this.update(characterId, { clothingRecords: filtered });
        return true;
      },
      'Error removing clothing record',
      { characterId, recordId }
    );
  }

  /**
   * Get a single clothing record by ID
   * @param characterId The character ID
   * @param recordId The clothing record ID
   * @returns Promise<ClothingRecord | null> The record if found, null otherwise
   */
  async getClothingRecord(characterId: string, recordId: string): Promise<ClothingRecord | null> {
    return this.safeQuery(
      async () => {
        const character = await this.findById(characterId);
        if (!character) {
          logger.warn('Character not found for clothing record retrieval', { characterId });
          return null;
        }

        const records = character.clothingRecords || [];
        const record = records.find((r) => r.id === recordId) || null;
        return record;
      },
      'Error getting clothing record',
      { characterId, recordId }
    );
  }

  /**
   * Get all clothing records for a character
   * @param characterId The character ID
   * @returns Promise<ClothingRecord[]> Array of all clothing records for the character
   */
  async getClothingRecords(characterId: string): Promise<ClothingRecord[]> {
    return this.safeQuery(
      async () => {
        const character = await this.findById(characterId);
        if (!character) {
          logger.warn('Character not found for clothing records retrieval', { characterId });
          return [];
        }

        const records = character.clothingRecords || [];
        return records;
      },
      'Error getting clothing records',
      { characterId },
      []
    );
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
    return this.safeQuery(
      async () => {
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
      },
      'Error adding system prompt',
      { characterId, promptName: data.name }
    );
  }

  /**
   * Update a system prompt
   */
  async updateSystemPrompt(
    characterId: string,
    promptId: string,
    data: Partial<Omit<CharacterSystemPrompt, 'id' | 'createdAt' | 'updatedAt'>>
  ): Promise<CharacterSystemPrompt | null> {
    return this.safeQuery(
      async () => {
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
      },
      'Error updating system prompt',
      { characterId, promptId }
    );
  }

  /**
   * Delete a system prompt from a character
   */
  async deleteSystemPrompt(characterId: string, promptId: string): Promise<boolean> {
    return this.safeQuery(
      async () => {
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
      },
      'Error deleting system prompt',
      { characterId, promptId }
    );
  }

  /**
   * Set a system prompt as default
   */
  async setDefaultSystemPrompt(characterId: string, promptId: string): Promise<Character | null> {
    return this.safeQuery(
      async () => {
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
      },
      'Error setting default system prompt',
      { characterId, promptId }
    );
  }

  /**
   * Get a single system prompt by ID
   */
  async getSystemPrompt(characterId: string, promptId: string): Promise<CharacterSystemPrompt | null> {
    return this.safeQuery(
      async () => {
        const character = await this.findById(characterId);
        if (!character) {
          logger.warn('Character not found for prompt retrieval', { characterId });
          return null;
        }

        const prompts = character.systemPrompts || [];
        return prompts.find(p => p.id === promptId) || null;
      },
      'Error getting system prompt',
      { characterId, promptId }
    );
  }

  /**
   * Get all system prompts for a character
   */
  async getSystemPrompts(characterId: string): Promise<CharacterSystemPrompt[]> {
    return this.safeQuery(
      async () => {
        const character = await this.findById(characterId);
        if (!character) {
          logger.warn('Character not found for prompts retrieval', { characterId });
          return [];
        }

        return character.systemPrompts || [];
      },
      'Error getting system prompts',
      { characterId },
      []
    );
  }

  // ============================================================================
  // SCENARIO OPERATIONS
  // ============================================================================

  /**
   * Add a scenario to a character
   * @param characterId The character ID
   * @param data The scenario data (title and content)
   * @returns Promise<CharacterScenario | null> The added scenario if successful, null if character not found
   */
  async addScenario(
    characterId: string,
    data: { title: string; content: string }
  ): Promise<CharacterScenario | null> {
    return this.safeQuery(
      async () => {
        const character = await this.findById(characterId);
        if (!character) {
          logger.warn('Character not found for scenario addition', { characterId });
          return null;
        }

        const now = this.getCurrentTimestamp();
        const scenario: CharacterScenario = {
          id: this.generateId(),
          title: data.title,
          content: data.content,
          createdAt: now,
          updatedAt: now,
        };

        const scenarios = character.scenarios || [];
        scenarios.push(scenario);

        await this.update(characterId, { scenarios });

        return scenario;
      },
      'Error adding scenario',
      { characterId, title: data.title }
    );
  }

  /**
   * Update a scenario on a character
   * @param characterId The character ID
   * @param scenarioId The scenario ID
   * @param data Partial scenario data to update (title and/or content)
   * @returns Promise<CharacterScenario | null> The updated scenario if found, null otherwise
   */
  async updateScenario(
    characterId: string,
    scenarioId: string,
    data: { title?: string; content?: string }
  ): Promise<CharacterScenario | null> {
    return this.safeQuery(
      async () => {
        const character = await this.findById(characterId);
        if (!character) {
          logger.warn('Character not found for scenario update', { characterId });
          return null;
        }

        const scenarios = character.scenarios || [];
        const index = scenarios.findIndex(s => s.id === scenarioId);
        if (index === -1) {
          logger.warn('Scenario not found for update', { characterId, scenarioId });
          return null;
        }

        const now = this.getCurrentTimestamp();
        const updated: CharacterScenario = {
          ...scenarios[index],
          ...data,
          id: scenarios[index].id,
          createdAt: scenarios[index].createdAt,
          updatedAt: now,
        };

        scenarios[index] = updated;
        await this.update(characterId, { scenarios });

        return updated;
      },
      'Error updating scenario',
      { characterId, scenarioId }
    );
  }

  /**
   * Remove a scenario from a character
   * @param characterId The character ID
   * @param scenarioId The scenario ID
   * @returns Promise<boolean> True if scenario was removed, false if not found
   */
  async removeScenario(characterId: string, scenarioId: string): Promise<boolean> {
    return this.safeQuery(
      async () => {
        const character = await this.findById(characterId);
        if (!character) {
          logger.warn('Character not found for scenario removal', { characterId });
          return false;
        }

        const scenarios = character.scenarios || [];
        const filtered = scenarios.filter(s => s.id !== scenarioId);

        if (filtered.length === scenarios.length) {
          logger.warn('Scenario not found for removal', { characterId, scenarioId });
          return false;
        }

        await this.update(characterId, { scenarios: filtered });

        return true;
      },
      'Error removing scenario',
      { characterId, scenarioId }
    );
  }

  /**
   * Get all scenarios for a character
   * @param characterId The character ID
   * @returns Promise<CharacterScenario[]> Array of all scenarios for the character
   */
  async getScenarios(characterId: string): Promise<CharacterScenario[]> {
    return this.safeQuery(
      async () => {
        const character = await this.findById(characterId);
        if (!character) {
          logger.warn('Character not found for scenarios retrieval', { characterId });
          return [];
        }

        return character.scenarios || [];
      },
      'Error getting scenarios',
      { characterId },
      []
    );
  }
}
