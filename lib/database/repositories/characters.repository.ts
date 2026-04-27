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
import {
  applyDocumentStoreOverlay,
  applyDocumentStoreOverlayOne,
  applyDocumentStoreWriteOverlay,
} from './character-properties-overlay';

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
    const raw = await this._findById(id);
    return applyDocumentStoreOverlayOne(raw);
  }

  /**
   * Find a character by ID without applying the document-store properties overlay.
   * Used by the export path and the sync-back action, where the canonical DB row
   * is required regardless of the `readPropertiesFromDocumentStore` switch.
   */
  async findByIdRaw(id: string): Promise<Character | null> {
    return this._findById(id);
  }

  /**
   * Find all characters
   * @returns Promise<Character[]> Array of all characters
   */
  async findAll(): Promise<Character[]> {
    const raw = await this._findAll();
    return applyDocumentStoreOverlay(raw);
  }

  /**
   * Find all characters without applying the document-store properties overlay.
   * Used by the export path.
   */
  async findAllRaw(): Promise<Character[]> {
    return this._findAll();
  }

  /**
   * Find characters by user ID
   * @param userId The user ID
   * @returns Promise<Character[]> Array of characters belonging to the user
   */
  async findByUserId(userId: string): Promise<Character[]> {
    const raw = await super.findByUserId(userId);
    return applyDocumentStoreOverlay(raw);
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
        return applyDocumentStoreOverlay(results);
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
        return applyDocumentStoreOverlay(results);
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
    const raw = await super.findByIds(ids);
    return applyDocumentStoreOverlay(raw);
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
        return applyDocumentStoreOverlay(results);
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
        return applyDocumentStoreOverlay(results);
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
    const raw = await super.findByTag(tagId);
    return applyDocumentStoreOverlay(raw);
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
   * Update a character. When the character is in vault mode
   * (`readPropertiesFromDocumentStore` on with a linked vault), managed
   * fields in `data` are routed to vault files instead of the DB row;
   * non-managed fields still go to DB. The returned character is overlaid
   * so callers see vault-backed values just like findById would.
   *
   * Use `updateRaw` to bypass the write overlay (e.g. the sync-back action
   * pulling vault values into the DB row).
   */
  async update(id: string, data: Partial<Character>): Promise<Character | null> {
    return this.safeQuery(
      async () => {
        const dbPatch = await applyDocumentStoreWriteOverlay(id, data);
        const hasDbWork = Object.keys(dbPatch).length > 0;
        const result = hasDbWork ? await this._update(id, dbPatch) : await this._findById(id);
        return applyDocumentStoreOverlayOne(result);
      },
      'Error updating character',
      { characterId: id }
    );
  }

  /**
   * Update a character bypassing the document-store write overlay. Writes go
   * directly to the DB row regardless of vault-mode state. Used by the
   * `sync-properties-from-vault` action so vault values can be copied into
   * the canonical DB row.
   */
  async updateRaw(id: string, data: Partial<Character>): Promise<Character | null> {
    return this.safeQuery(
      async () => {
        return await this._update(id, data);
      },
      'Error updating character (raw)',
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
    return this.update(characterId, { isFavorite });
  }

  /**
   * Set controlled-by status for a character
   * @param characterId The character ID
   * @param controlledBy Who controls the character: 'llm' or 'user'
   * @returns Promise<Character | null> The updated character if found, null otherwise
   */
  async setControlledBy(characterId: string, controlledBy: 'llm' | 'user'): Promise<Character | null> {
    return this.update(characterId, { controlledBy });
  }

  // ============================================================================
  // GENERIC SUB-ARRAY HELPERS
  // ============================================================================

  private async addToSubArray<S extends { id: string; createdAt: string; updatedAt: string }>(
    characterId: string,
    getItems: (c: Character) => S[],
    buildItem: (id: string, now: string) => S,
    applyUpdate: (items: S[]) => Partial<Character>,
    errorMsg: string,
    logContext?: Record<string, unknown>,
    onBeforeAdd?: (existingItems: S[], newItem: S) => void
  ): Promise<S | null> {
    return this.safeQuery(
      async () => {
        const character = await this.findById(characterId);
        if (!character) {
          logger.warn(`Character not found: ${errorMsg}`, { characterId });
          return null;
        }
        const id = this.generateId();
        const now = this.getCurrentTimestamp();
        const newItem = buildItem(id, now);
        const items = getItems(character);
        onBeforeAdd?.(items, newItem);
        items.push(newItem);
        await this.update(characterId, applyUpdate(items));
        return newItem;
      },
      errorMsg,
      { characterId, ...logContext }
    );
  }

  private async updateInSubArray<S extends { id: string; createdAt: string; updatedAt: string }>(
    characterId: string,
    itemId: string,
    getItems: (c: Character) => S[],
    buildUpdated: (existing: S, now: string) => S,
    applyUpdate: (items: S[]) => Partial<Character>,
    errorMsg: string,
    logContext?: Record<string, unknown>,
    onAfterBuild?: (items: S[], index: number, updated: S) => void
  ): Promise<S | null> {
    return this.safeQuery(
      async () => {
        const character = await this.findById(characterId);
        if (!character) {
          logger.warn(`Character not found: ${errorMsg}`, { characterId });
          return null;
        }
        const items = getItems(character);
        const index = items.findIndex((i) => i.id === itemId);
        if (index === -1) {
          logger.warn(`Item not found: ${errorMsg}`, { characterId, itemId });
          return null;
        }
        const now = this.getCurrentTimestamp();
        const updated = buildUpdated(items[index], now);
        onAfterBuild?.(items, index, updated);
        items[index] = updated;
        await this.update(characterId, applyUpdate(items));
        return updated;
      },
      errorMsg,
      { characterId, ...logContext }
    );
  }

  private async removeFromSubArray<S extends { id: string }>(
    characterId: string,
    itemId: string,
    getItems: (c: Character) => S[],
    applyUpdate: (items: S[]) => Partial<Character>,
    errorMsg: string,
    onAfterRemove?: (remaining: S[]) => void
  ): Promise<boolean> {
    return this.safeQuery(
      async () => {
        const character = await this.findById(characterId);
        if (!character) {
          logger.warn(`Character not found: ${errorMsg}`, { characterId });
          return false;
        }
        const items = getItems(character);
        const filtered = items.filter((i) => i.id !== itemId);
        if (filtered.length === items.length) {
          logger.warn(`Item not found for removal: ${errorMsg}`, { characterId, itemId });
          return false;
        }
        onAfterRemove?.(filtered);
        await this.update(characterId, applyUpdate(filtered));
        return true;
      },
      errorMsg,
      { characterId, itemId }
    );
  }

  private async getFromSubArray<S extends { id: string }>(
    characterId: string,
    itemId: string,
    getItems: (c: Character) => S[],
    errorMsg: string
  ): Promise<S | null> {
    return this.safeQuery(
      async () => {
        const character = await this.findById(characterId);
        if (!character) {
          logger.warn(`Character not found: ${errorMsg}`, { characterId });
          return null;
        }
        return getItems(character).find((i) => i.id === itemId) ?? null;
      },
      errorMsg,
      { characterId, itemId },
      null
    );
  }

  private async getAllFromSubArray<S>(
    characterId: string,
    getItems: (c: Character) => S[],
    errorMsg: string
  ): Promise<S[]> {
    return this.safeQuery(
      async () => {
        const character = await this.findById(characterId);
        if (!character) {
          logger.warn(`Character not found: ${errorMsg}`, { characterId });
          return [];
        }
        return getItems(character);
      },
      errorMsg,
      { characterId },
      []
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
    return this.addToSubArray<PhysicalDescription>(
      characterId,
      (c) => c.physicalDescriptions ?? [],
      (id, now) => ({ ...data, id, createdAt: now, updatedAt: now }),
      (items) => ({ physicalDescriptions: items }),
      'Error adding physical description',
      { descriptionName: data.name }
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
    return this.updateInSubArray<PhysicalDescription>(
      characterId,
      descriptionId,
      (c) => c.physicalDescriptions ?? [],
      (existing, now) => ({ ...existing, ...data, id: existing.id, createdAt: existing.createdAt, updatedAt: now }),
      (items) => ({ physicalDescriptions: items }),
      'Error updating physical description',
      { descriptionId }
    );
  }

  /**
   * Remove a physical description from a character
   * @param characterId The character ID
   * @param descriptionId The description ID
   * @returns Promise<boolean> True if description was deleted, false if not found
   */
  async removeDescription(characterId: string, descriptionId: string): Promise<boolean> {
    return this.removeFromSubArray<PhysicalDescription>(
      characterId,
      descriptionId,
      (c) => c.physicalDescriptions ?? [],
      (items) => ({ physicalDescriptions: items }),
      'Error removing physical description'
    );
  }

  /**
   * Get a single physical description by ID
   * @param characterId The character ID
   * @param descriptionId The description ID
   * @returns Promise<PhysicalDescription | null> The description if found, null otherwise
   */
  async getDescription(characterId: string, descriptionId: string): Promise<PhysicalDescription | null> {
    return this.getFromSubArray<PhysicalDescription>(
      characterId,
      descriptionId,
      (c) => c.physicalDescriptions ?? [],
      'Error getting physical description'
    );
  }

  /**
   * Get all physical descriptions for a character
   * @param characterId The character ID
   * @returns Promise<PhysicalDescription[]> Array of all descriptions for the character
   */
  async getDescriptions(characterId: string): Promise<PhysicalDescription[]> {
    return this.getAllFromSubArray<PhysicalDescription>(
      characterId,
      (c) => c.physicalDescriptions ?? [],
      'Error getting physical descriptions'
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
    return this.addToSubArray<ClothingRecord>(
      characterId,
      (c) => c.clothingRecords ?? [],
      (id, now) => ({ ...data, id, createdAt: now, updatedAt: now }),
      (items) => ({ clothingRecords: items }),
      'Error adding clothing record',
      { recordName: data.name }
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
    return this.updateInSubArray<ClothingRecord>(
      characterId,
      recordId,
      (c) => c.clothingRecords ?? [],
      (existing, now) => ({ ...existing, ...data, id: existing.id, createdAt: existing.createdAt, updatedAt: now }),
      (items) => ({ clothingRecords: items }),
      'Error updating clothing record',
      { recordId }
    );
  }

  /**
   * Remove a clothing record from a character
   * @param characterId The character ID
   * @param recordId The clothing record ID
   * @returns Promise<boolean> True if record was deleted, false if not found
   */
  async removeClothingRecord(characterId: string, recordId: string): Promise<boolean> {
    return this.removeFromSubArray<ClothingRecord>(
      characterId,
      recordId,
      (c) => c.clothingRecords ?? [],
      (items) => ({ clothingRecords: items }),
      'Error removing clothing record'
    );
  }

  /**
   * Get a single clothing record by ID
   * @param characterId The character ID
   * @param recordId The clothing record ID
   * @returns Promise<ClothingRecord | null> The record if found, null otherwise
   */
  async getClothingRecord(characterId: string, recordId: string): Promise<ClothingRecord | null> {
    return this.getFromSubArray<ClothingRecord>(
      characterId,
      recordId,
      (c) => c.clothingRecords ?? [],
      'Error getting clothing record'
    );
  }

  /**
   * Get all clothing records for a character
   * @param characterId The character ID
   * @returns Promise<ClothingRecord[]> Array of all clothing records for the character
   */
  async getClothingRecords(characterId: string): Promise<ClothingRecord[]> {
    return this.getAllFromSubArray<ClothingRecord>(
      characterId,
      (c) => c.clothingRecords ?? [],
      'Error getting clothing records'
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
    return this.addToSubArray<CharacterSystemPrompt>(
      characterId,
      (c) => c.systemPrompts ?? [],
      (id, now) => ({ ...data, id, createdAt: now, updatedAt: now }),
      (items) => ({ systemPrompts: items }),
      'Error adding system prompt',
      { promptName: data.name },
      (existingItems, newItem) => {
        if (data.isDefault || existingItems.length === 0) {
          existingItems.forEach((p) => { p.isDefault = false; });
          newItem.isDefault = true;
        }
      }
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
    return this.updateInSubArray<CharacterSystemPrompt>(
      characterId,
      promptId,
      (c) => c.systemPrompts ?? [],
      (existing, now) => ({ ...existing, ...data, id: existing.id, createdAt: existing.createdAt, updatedAt: now }),
      (items) => ({ systemPrompts: items }),
      'Error updating system prompt',
      { promptId },
      (items, _index, updated) => {
        if (data.isDefault) {
          items.forEach((p) => { p.isDefault = false; });
          updated.isDefault = true;
        }
      }
    );
  }

  /**
   * Delete a system prompt from a character
   */
  async deleteSystemPrompt(characterId: string, promptId: string): Promise<boolean> {
    return this.removeFromSubArray<CharacterSystemPrompt>(
      characterId,
      promptId,
      (c) => c.systemPrompts ?? [],
      (items) => ({ systemPrompts: items }),
      'Error deleting system prompt',
      (remaining) => {
        if (remaining.length > 0 && !remaining.some((p) => p.isDefault)) {
          remaining[0].isDefault = true;
        }
      }
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

        const prompts = character.systemPrompts ?? [];
        const targetIndex = prompts.findIndex((p) => p.id === promptId);

        if (targetIndex === -1) {
          logger.warn('System prompt not found', { characterId, promptId });
          return null;
        }

        const now = this.getCurrentTimestamp();
        prompts.forEach((p, i) => {
          p.isDefault = i === targetIndex;
          p.updatedAt = now;
        });

        return this.update(characterId, { systemPrompts: prompts });
      },
      'Error setting default system prompt',
      { characterId, promptId }
    );
  }

  /**
   * Get a single system prompt by ID
   */
  async getSystemPrompt(characterId: string, promptId: string): Promise<CharacterSystemPrompt | null> {
    return this.getFromSubArray<CharacterSystemPrompt>(
      characterId,
      promptId,
      (c) => c.systemPrompts ?? [],
      'Error getting system prompt'
    );
  }

  /**
   * Get all system prompts for a character
   */
  async getSystemPrompts(characterId: string): Promise<CharacterSystemPrompt[]> {
    return this.getAllFromSubArray<CharacterSystemPrompt>(
      characterId,
      (c) => c.systemPrompts ?? [],
      'Error getting system prompts'
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
    return this.addToSubArray<CharacterScenario>(
      characterId,
      (c) => c.scenarios ?? [],
      (id, now) => ({ id, title: data.title, content: data.content, createdAt: now, updatedAt: now }),
      (items) => ({ scenarios: items }),
      'Error adding scenario',
      { title: data.title }
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
    return this.updateInSubArray<CharacterScenario>(
      characterId,
      scenarioId,
      (c) => c.scenarios ?? [],
      (existing, now) => ({ ...existing, ...data, id: existing.id, createdAt: existing.createdAt, updatedAt: now }),
      (items) => ({ scenarios: items }),
      'Error updating scenario',
      { scenarioId }
    );
  }

  /**
   * Remove a scenario from a character
   * @param characterId The character ID
   * @param scenarioId The scenario ID
   * @returns Promise<boolean> True if scenario was removed, false if not found
   */
  async removeScenario(characterId: string, scenarioId: string): Promise<boolean> {
    return this.removeFromSubArray<CharacterScenario>(
      characterId,
      scenarioId,
      (c) => c.scenarios ?? [],
      (items) => ({ scenarios: items }),
      'Error removing scenario'
    );
  }

  /**
   * Get all scenarios for a character
   * @param characterId The character ID
   * @returns Promise<CharacterScenario[]> Array of all scenarios for the character
   */
  async getScenarios(characterId: string): Promise<CharacterScenario[]> {
    return this.getAllFromSubArray<CharacterScenario>(
      characterId,
      (c) => c.scenarios ?? [],
      'Error getting scenarios'
    );
  }
}
