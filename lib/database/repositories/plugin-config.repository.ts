/**
 * Plugin Configuration Repository
 *
 * Backend-agnostic repository for plugin configuration entities.
 * Works with both MongoDB and SQLite through the database abstraction layer.
 * Configuration is stored per-user, per-plugin.
 */

import { PluginConfig, PluginConfigSchema } from '@/lib/schemas/types';
import { UserOwnedBaseRepository, CreateOptions } from './base.repository';
import { QueryFilter } from '../interfaces';
import { logger } from '@/lib/logger';

/**
 * Plugin Configuration Repository
 * Implements CRUD operations for plugin configs with user-scoping and plugin-specific queries.
 */
export class PluginConfigRepository extends UserOwnedBaseRepository<PluginConfig> {
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
    return this._findById(id);
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
      const config = await this.findOneByFilter({
        userId,
        pluginName,
      } as QueryFilter);

      if (config) {
        logger.debug('Plugin config found for user/plugin', { userId, pluginName });
      } else {
        logger.debug('Plugin config not found for user/plugin', { userId, pluginName });
      }

      return config;
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
    const configs = await this.findByFilter({ userId } as QueryFilter);
    logger.debug('Retrieved plugin configs for user', { userId, count: configs.length });
    return configs;
  }

  /**
   * Find all plugin configs
   * @returns Promise<PluginConfig[]> Array of all plugin configs
   */
  async findAll(): Promise<PluginConfig[]> {
    logger.debug('Finding all plugin configs');
    const configs = await this._findAll();
    logger.debug('Retrieved all plugin configs', { count: configs.length });
    return configs;
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
      const config = await this._create(data, options);

      logger.info('Plugin config created successfully', {
        pluginConfigId: config.id,
        userId: data.userId,
        pluginName: data.pluginName,
      });

      return config;
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
      const config = await this._update(id, data);

      if (config) {
        logger.info('Plugin config updated successfully', { pluginConfigId: id });
      }

      return config;
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
      const result = await this._delete(id);

      if (result) {
        logger.info('Plugin config deleted successfully', { pluginConfigId: id });
      }

      return result;
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
      logger.debug('Plugin config already exists, returning existing', { userId, pluginName });
      return existing;
    }

    logger.debug('Plugin config does not exist, creating new', { userId, pluginName });
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
      logger.debug('Plugin config exists, merging configuration', { userId, pluginName });
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

    logger.debug('Plugin config does not exist, creating new with configuration', { userId, pluginName });
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
      const count = await this.deleteMany({ pluginName } as QueryFilter);
      logger.debug('Deleted plugin configs', { pluginName, count });
      return count;
    } catch (error) {
      logger.error('Error deleting plugin configs', {
        pluginName,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}
