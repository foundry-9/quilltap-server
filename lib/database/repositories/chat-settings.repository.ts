/**
 * Chat Settings Repository
 *
 * Backend-agnostic repository for ChatSettings entities.
 * Works with SQLite through the database abstraction layer.
 */

import { logger } from '@/lib/logger';
import { ChatSettings, ChatSettingsSchema } from '@/lib/schemas/types';
import { AbstractBaseRepository, CreateOptions } from './base.repository';
import { QueryFilter } from '../interfaces';

/**
 * Chat Settings Repository
 * Implements CRUD operations for chat settings with user-scoping.
 * Uses AbstractBaseRepository since we override findByUserId with different return type.
 */
export class ChatSettingsRepository extends AbstractBaseRepository<ChatSettings> {
  constructor() {
    super('chat_settings', ChatSettingsSchema);
  }

  /**
   * Find chat settings by ID
   */
  async findById(id: string): Promise<ChatSettings | null> {
    try {
      const result = await this._findById(id);
      if (result) {
      } else {
      }
      return result;
    } catch (error) {
      logger.error('Error finding chat settings by ID', {
        chatSettingsId: id,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Find chat settings by user ID
   */
  async findByUserId(userId: string): Promise<ChatSettings | null> {
    try {
      const result = await this.findOneByFilter({ userId } as QueryFilter);
      if (result) {
      } else {
      }
      return result;
    } catch (error) {
      logger.error('Error finding chat settings by user ID', {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Find all chat settings
   */
  async findAll(): Promise<ChatSettings[]> {
    try {
      const results = await this._findAll();
      return results;
    } catch (error) {
      logger.error('Error finding all chat settings', {
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Create new chat settings
   * @param data The chat settings data (without id, createdAt, updatedAt)
   * @param options Optional CreateOptions to specify ID and createdAt (for sync)
   * @returns Promise<ChatSettings> The created chat settings with generated id and timestamps
   */
  async create(
    data: Omit<ChatSettings, 'id' | 'createdAt' | 'updatedAt'>,
    options?: CreateOptions
  ): Promise<ChatSettings> {
    try {
      const result = await this._create(data, options);
      logger.info('Chat settings created successfully', {
        chatSettingsId: result.id,
        userId: data.userId,
      });
      return result;
    } catch (error) {
      logger.error('Error creating chat settings', {
        userId: data.userId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Update chat settings
   * @param id The chat settings ID
   * @param data Partial chat settings data to update
   * @returns Promise<ChatSettings | null> The updated chat settings if found, null otherwise
   */
  async update(id: string, data: Partial<ChatSettings>): Promise<ChatSettings | null> {
    try {
      const result = await this._update(id, data);
      if (result) {
      } else {
        logger.warn('Chat settings not found for update', { chatSettingsId: id });
      }
      return result;
    } catch (error) {
      logger.error('Error updating chat settings', {
        chatSettingsId: id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Delete chat settings
   * @param id The chat settings ID
   * @returns Promise<boolean> True if chat settings were deleted, false if not found
   */
  async delete(id: string): Promise<boolean> {
    try {
      const result = await this._delete(id);
      if (result) {
      } else {
        logger.warn('Chat settings not found for deletion', { chatSettingsId: id });
      }
      return result;
    } catch (error) {
      logger.error('Error deleting chat settings', {
        chatSettingsId: id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Create chat settings for a user
   * @param userId The user ID
   * @param data The chat settings data (without id, userId, createdAt, updatedAt)
   * @returns Promise<ChatSettings> The created chat settings
   */
  async createForUser(
    userId: string,
    data: Omit<ChatSettings, 'id' | 'userId' | 'createdAt' | 'updatedAt'>
  ): Promise<ChatSettings> {
    return this.create({ ...data, userId });
  }

  /**
   * Update chat settings for a user (creates if not exists)
   * @param userId The user ID
   * @param data Partial chat settings data to update
   * @returns Promise<ChatSettings | null> The updated/created chat settings
   */
  async updateForUser(userId: string, data: Partial<ChatSettings>): Promise<ChatSettings | null> {
    try {
      // Check if settings exist
      const existing = await this.findByUserId(userId);

      if (!existing) {
        // Create new settings with defaults
        // Default roleplay template will be set by the user or by the first access flow
        // We don't query for templates here to avoid circular dependencies
        const defaultRoleplayTemplateId: string | null = null;

        const defaultSettings: Omit<ChatSettings, 'id' | 'createdAt' | 'updatedAt'> = {
          userId,
          avatarDisplayMode: 'ALWAYS',
          avatarDisplayStyle: 'CIRCULAR',
          tagStyles: {},
          cheapLLMSettings: {
            strategy: 'PROVIDER_CHEAPEST',
            fallbackToLocal: true,
            embeddingProvider: 'OPENAI',
          },
          themePreference: {
            activeThemeId: null,
            colorMode: 'system',
            showNavThemeSelector: false,
          },
          defaultTimestampConfig: {
            mode: 'NONE',
            format: 'FRIENDLY',
            useFictionalTime: false,
            autoPrepend: true,
          },
          memoryCascadePreferences: {
            onMessageDelete: 'ASK_EVERY_TIME',
            onSwipeRegenerate: 'DELETE_MEMORIES',
          },
          tokenDisplaySettings: {
            showPerMessageTokens: false,
            showPerMessageCost: false,
            showChatTotals: false,
            showSystemEvents: false,
          },
          contextCompressionSettings: {
            enabled: true,
            windowSize: 5,
            compressionTargetTokens: 800,
            systemPromptTargetTokens: 1500,
          },
          llmLoggingSettings: {
            enabled: true,
            verboseMode: false,
            retentionDays: 30,
          },
          defaultRoleplayTemplateId,
          ...data,
        };
        return await this.create(defaultSettings);
      }

      // Update existing settings
      return await this.update(existing.id, data);
    } catch (error) {
      logger.error('Error updating chat settings for user', {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}
