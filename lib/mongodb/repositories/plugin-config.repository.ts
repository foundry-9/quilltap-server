/**
 * MongoDB Plugin Configuration Repository
 *
 * Handles CRUD operations for plugin configuration entities.
 * Each plugin config record is stored as a document in the 'plugin_configs' MongoDB collection.
 * Configuration is stored per-user, per-plugin.
 */

import { PluginConfig, PluginConfigSchema } from '@/lib/schemas/types';
import { MongoBaseRepository, CreateOptions } from './base.repository';
import { logger } from '@/lib/logger';

export class PluginConfigRepository extends MongoBaseRepository<PluginConfig> {
  constructor() {
    super('plugin_configs', PluginConfigSchema);
    logger.debug('PluginConfigRepository initialized');
  }

  /**
   * Find plugin config by ID
   * @param id The plugin config ID
   * @returns Promise<PluginConfig | null> The config if found, null otherwise
   */
  async findById(id: string): Promise<PluginConfig | null> {
    logger.debug('Finding plugin config by ID', { pluginConfigId: id });
    try {
      const collection = await this.getCollection();
      const result = await collection.findOne({ id });

      if (!result) {
        logger.debug('Plugin config not found', { pluginConfigId: id });
        return null;
      }

      const validated = this.validate(result);
      logger.debug('Plugin config found and validated', { pluginConfigId: id });
      return validated;
    } catch (error) {
      logger.error('Error finding plugin config by ID', {
        pluginConfigId: id,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Find plugin config by user ID and plugin name
   * @param userId The user ID
   * @param pluginName The plugin name
   * @returns Promise<PluginConfig | null> The config if found, null otherwise
   */
  async findByUserAndPlugin(userId: string, pluginName: string): Promise<PluginConfig | null> {
    logger.debug('Finding plugin config by user and plugin', { userId, pluginName });
    try {
      const collection = await this.getCollection();
      const result = await collection.findOne({ userId, pluginName });

      if (!result) {
        logger.debug('Plugin config not found for user/plugin', { userId, pluginName });
        return null;
      }

      const validated = this.validate(result);
      logger.debug('Plugin config found for user/plugin', { userId, pluginName });
      return validated;
    } catch (error) {
      logger.error('Error finding plugin config by user and plugin', {
        userId,
        pluginName,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Find all plugin configs for a user
   * @param userId The user ID
   * @returns Promise<PluginConfig[]> Array of plugin configs for the user
   */
  async findByUserId(userId: string): Promise<PluginConfig[]> {
    logger.debug('Finding all plugin configs for user', { userId });
    try {
      const collection = await this.getCollection();
      const results = await collection.find({ userId }).toArray();

      const configs = results
        .map((doc) => {
          const validation = this.validateSafe(doc);
          if (validation.success && validation.data) {
            return validation.data;
          }
          return null;
        })
        .filter((config): config is PluginConfig => config !== null);

      logger.debug('Retrieved plugin configs for user', { userId, count: configs.length });
      return configs;
    } catch (error) {
      logger.error('Error finding plugin configs for user', {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Find all plugin configs
   * @returns Promise<PluginConfig[]> Array of all plugin configs
   */
  async findAll(): Promise<PluginConfig[]> {
    logger.debug('Finding all plugin configs');
    try {
      const collection = await this.getCollection();
      const results = await collection.find({}).toArray();

      const configs = results
        .map((doc) => {
          const validation = this.validateSafe(doc);
          if (validation.success && validation.data) {
            return validation.data;
          }
          return null;
        })
        .filter((config): config is PluginConfig => config !== null);

      logger.debug('Retrieved all plugin configs', { count: configs.length });
      return configs;
    } catch (error) {
      logger.error('Error finding all plugin configs', {
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Create new plugin config
   * @param data The plugin config data (without id, createdAt, updatedAt)
   * @param options Optional CreateOptions to specify ID and createdAt (for sync)
   * @returns Promise<PluginConfig> The created plugin config with generated id and timestamps
   */
  async create(
    data: Omit<PluginConfig, 'id' | 'createdAt' | 'updatedAt'>,
    options?: CreateOptions
  ): Promise<PluginConfig> {
    logger.debug('Creating new plugin config', { userId: data.userId, pluginName: data.pluginName });
    try {
      const id = options?.id || this.generateId();
      const now = this.getCurrentTimestamp();
      const createdAt = options?.createdAt || now;

      const configInput = {
        ...data,
        id,
        createdAt,
        updatedAt: now,
      };

      const validated = this.validate(configInput);
      const collection = await this.getCollection();
      await collection.insertOne(validated as any);

      logger.info('Plugin config created successfully', {
        pluginConfigId: id,
        userId: data.userId,
        pluginName: data.pluginName,
      });
      return validated;
    } catch (error) {
      logger.error('Error creating plugin config', {
        userId: data.userId,
        pluginName: data.pluginName,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Update plugin config
   * @param id The plugin config ID
   * @param data Partial plugin config data to update
   * @returns Promise<PluginConfig | null> The updated config if found, null otherwise
   */
  async update(id: string, data: Partial<PluginConfig>): Promise<PluginConfig | null> {
    logger.debug('Updating plugin config', { pluginConfigId: id });
    try {
      const existing = await this.findById(id);
      if (!existing) {
        logger.warn('Plugin config not found for update', { pluginConfigId: id });
        return null;
      }

      const now = this.getCurrentTimestamp();
      const updated: PluginConfig = {
        ...existing,
        ...data,
        id: existing.id, // Preserve ID
        createdAt: existing.createdAt, // Preserve creation timestamp
        updatedAt: now,
      };

      const validated = this.validate(updated);
      const collection = await this.getCollection();

      await collection.updateOne({ id }, { $set: validated as any });

      logger.debug('Plugin config updated successfully', { pluginConfigId: id });
      return validated;
    } catch (error) {
      logger.error('Error updating plugin config', {
        pluginConfigId: id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Delete plugin config
   * @param id The plugin config ID
   * @returns Promise<boolean> True if config was deleted, false if not found
   */
  async delete(id: string): Promise<boolean> {
    logger.debug('Deleting plugin config', { pluginConfigId: id });
    try {
      const collection = await this.getCollection();
      const result = await collection.deleteOne({ id });

      if (result.deletedCount === 0) {
        logger.warn('Plugin config not found for deletion', { pluginConfigId: id });
        return false;
      }

      logger.debug('Plugin config deleted successfully', { pluginConfigId: id });
      return true;
    } catch (error) {
      logger.error('Error deleting plugin config', {
        pluginConfigId: id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Get or create plugin config for a user/plugin combination
   * @param userId The user ID
   * @param pluginName The plugin name
   * @param defaultConfig Default configuration values to use if creating new
   * @returns Promise<PluginConfig> The existing or newly created config
   */
  async getOrCreate(
    userId: string,
    pluginName: string,
    defaultConfig: Record<string, unknown> = {}
  ): Promise<PluginConfig> {
    logger.debug('Getting or creating plugin config', { userId, pluginName });

    const existing = await this.findByUserAndPlugin(userId, pluginName);
    if (existing) {
      return existing;
    }

    return this.create({
      userId,
      pluginName,
      config: defaultConfig,
    });
  }

  /**
   * Update config for a user/plugin combination (creates if not exists)
   * @param userId The user ID
   * @param pluginName The plugin name
   * @param config The configuration values to set
   * @returns Promise<PluginConfig> The updated or created config
   */
  async upsertForUserPlugin(
    userId: string,
    pluginName: string,
    config: Record<string, unknown>
  ): Promise<PluginConfig> {
    logger.debug('Upserting plugin config for user/plugin', { userId, pluginName });

    const existing = await this.findByUserAndPlugin(userId, pluginName);

    if (existing) {
      // Merge the new config with existing config
      const mergedConfig = {
        ...existing.config,
        ...config,
      };
      const updated = await this.update(existing.id, { config: mergedConfig });
      if (!updated) {
        throw new Error(`Failed to update plugin config for ${pluginName}`);
      }
      return updated;
    }

    return this.create({
      userId,
      pluginName,
      config,
    });
  }

  /**
   * Delete all configs for a specific plugin (used when uninstalling)
   * @param pluginName The plugin name
   * @returns Promise<number> Number of configs deleted
   */
  async deleteByPlugin(pluginName: string): Promise<number> {
    logger.debug('Deleting all configs for plugin', { pluginName });
    try {
      const collection = await this.getCollection();
      const result = await collection.deleteMany({ pluginName });

      logger.debug('Deleted plugin configs', { pluginName, count: result.deletedCount });
      return result.deletedCount;
    } catch (error) {
      logger.error('Error deleting plugin configs', {
        pluginName,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}
