/**
 * Character Plugin Data Repository
 *
 * Backend-agnostic repository for per-character, per-plugin metadata.
 * Works with SQLite through the database abstraction layer.
 * Each entry stores arbitrary JSON data for a specific plugin on a specific character.
 */

import { CharacterPluginData, CharacterPluginDataSchema } from '@/lib/schemas/character-plugin-data.types';
import { AbstractBaseRepository, CreateOptions } from './base.repository';
import { TypedQueryFilter } from '../interfaces';
import { logger } from '@/lib/logger';

/**
 * Character Plugin Data Repository
 * Implements CRUD operations for per-character per-plugin metadata.
 */
export class CharacterPluginDataRepository extends AbstractBaseRepository<CharacterPluginData> {
  constructor() {
    super('character_plugin_data', CharacterPluginDataSchema);
  }

  /**
   * Find a plugin data entry by ID
   */
  async findById(id: string): Promise<CharacterPluginData | null> {
    return this._findById(id);
  }

  /**
   * Find all plugin data entries
   */
  async findAll(): Promise<CharacterPluginData[]> {
    return this._findAll();
  }

  /**
   * Find all plugin data for a specific character
   * @param characterId The character ID
   * @returns All plugin data entries for this character
   */
  async findByCharacterId(characterId: string): Promise<CharacterPluginData[]> {
    return this.safeQuery(
      () => this.findByFilter({ characterId } as TypedQueryFilter<CharacterPluginData>),
      'Error finding plugin data by character ID',
      { characterId },
      []
    );
  }

  /**
   * Find plugin data for a specific character and plugin combination
   * @param characterId The character ID
   * @param pluginName The plugin name
   * @returns The plugin data entry if found, null otherwise
   */
  async findByCharacterAndPlugin(characterId: string, pluginName: string): Promise<CharacterPluginData | null> {
    return this.safeQuery(
      () => this.findOneByFilter({
        characterId,
        pluginName,
      } as TypedQueryFilter<CharacterPluginData>),
      'Error finding plugin data by character and plugin',
      { characterId, pluginName },
      null
    );
  }

  /**
   * Find all character data entries for a specific plugin
   * @param pluginName The plugin name
   * @returns All entries for this plugin across all characters
   */
  async findByPluginName(pluginName: string): Promise<CharacterPluginData[]> {
    return this.safeQuery(
      () => this.findByFilter({ pluginName } as TypedQueryFilter<CharacterPluginData>),
      'Error finding plugin data by plugin name',
      { pluginName },
      []
    );
  }

  /**
   * Create a new plugin data entry
   * @param data The plugin data (without id, createdAt, updatedAt)
   * @param options Optional CreateOptions to specify ID and timestamps
   * @returns The created entry
   */
  async create(
    data: Omit<CharacterPluginData, 'id' | 'createdAt' | 'updatedAt'>,
    options?: CreateOptions
  ): Promise<CharacterPluginData> {
    return this.safeQuery(
      async () => {
        const entry = await this._create(data, options);

        logger.info('Character plugin data created', {
          entryId: entry.id,
          characterId: data.characterId,
          pluginName: data.pluginName,
        });

        return entry;
      },
      'Error creating character plugin data',
      { characterId: data.characterId, pluginName: data.pluginName }
    );
  }

  /**
   * Update a plugin data entry
   * @param id The entry ID
   * @param data Partial data to update
   * @returns The updated entry if found, null otherwise
   */
  async update(id: string, data: Partial<CharacterPluginData>): Promise<CharacterPluginData | null> {
    return this.safeQuery(
      async () => {
        const entry = await this._update(id, data);

        if (entry) {
          logger.debug('Character plugin data updated', { entryId: id });
        }

        return entry;
      },
      'Error updating character plugin data',
      { entryId: id }
    );
  }

  /**
   * Delete a plugin data entry
   * @param id The entry ID
   * @returns True if deleted, false if not found
   */
  async delete(id: string): Promise<boolean> {
    return this.safeQuery(
      async () => {
        const result = await this._delete(id);

        if (result) {
          logger.info('Character plugin data deleted', { entryId: id });
        }

        return result;
      },
      'Error deleting character plugin data',
      { entryId: id }
    );
  }

  /**
   * Create or update plugin data for a character/plugin combination.
   * If an entry already exists for the character+plugin pair, it replaces the data.
   * @param characterId The character ID
   * @param pluginName The plugin name
   * @param data The JSON data to store
   * @returns The created or updated entry
   */
  async upsert(
    characterId: string,
    pluginName: string,
    data: unknown
  ): Promise<CharacterPluginData> {
    const existing = await this.findByCharacterAndPlugin(characterId, pluginName);

    if (existing) {
      const updated = await this.update(existing.id, { data });
      if (!updated) {
        throw new Error(`Failed to update plugin data for ${pluginName} on character ${characterId}`);
      }
      logger.debug('Character plugin data upserted (updated)', {
        characterId,
        pluginName,
        entryId: existing.id,
      });
      return updated;
    }

    const created = await this.create({
      characterId,
      pluginName,
      data,
    });
    logger.debug('Character plugin data upserted (created)', {
      characterId,
      pluginName,
      entryId: created.id,
    });
    return created;
  }

  /**
   * Delete plugin data for a specific character and plugin
   * @param characterId The character ID
   * @param pluginName The plugin name
   * @returns True if deleted, false if not found
   */
  async deleteByCharacterAndPlugin(characterId: string, pluginName: string): Promise<boolean> {
    return this.safeQuery(
      async () => {
        const existing = await this.findByCharacterAndPlugin(characterId, pluginName);
        if (!existing) {
          return false;
        }
        return this._delete(existing.id);
      },
      'Error deleting plugin data by character and plugin',
      { characterId, pluginName }
    );
  }

  /**
   * Delete all plugin data for a character (used when character is deleted)
   * @param characterId The character ID
   * @returns Number of entries deleted
   */
  async deleteByCharacterId(characterId: string): Promise<number> {
    return this.safeQuery(
      async () => {
        const count = await this.deleteMany({ characterId } as TypedQueryFilter<CharacterPluginData>);

        if (count > 0) {
          logger.info('Deleted all plugin data for character', {
            characterId,
            deletedCount: count,
          });
        }

        return count;
      },
      'Error deleting plugin data by character ID',
      { characterId }
    );
  }

  /**
   * Delete all data for a specific plugin (used when plugin is uninstalled)
   * @param pluginName The plugin name
   * @returns Number of entries deleted
   */
  async deleteByPlugin(pluginName: string): Promise<number> {
    return this.safeQuery(
      async () => {
        const count = await this.deleteMany({ pluginName } as TypedQueryFilter<CharacterPluginData>);

        if (count > 0) {
          logger.info('Deleted all character data for plugin', {
            pluginName,
            deletedCount: count,
          });
        }

        return count;
      },
      'Error deleting plugin data by plugin name',
      { pluginName }
    );
  }

  /**
   * Get all plugin data for a character as a record keyed by plugin name.
   * Useful for building the pluginData map.
   * @param characterId The character ID
   * @returns Record mapping pluginName to its JSON data
   */
  async getPluginDataMap(characterId: string): Promise<Record<string, unknown>> {
    const entries = await this.findByCharacterId(characterId);
    const map: Record<string, unknown> = {};
    for (const entry of entries) {
      map[entry.pluginName] = entry.data;
    }
    return map;
  }
}
