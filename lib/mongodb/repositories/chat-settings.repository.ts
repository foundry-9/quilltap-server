/**
 * MongoDB Chat Settings Repository
 *
 * Handles CRUD operations for ChatSettings entities.
 * Each chat settings record is stored as a document in the 'chat_settings' MongoDB collection.
 */

import { ChatSettings, ChatSettingsSchema } from '@/lib/schemas/types';
import { MongoBaseRepository, CreateOptions } from './base.repository';
import { logger } from '@/lib/logger';
import { getMongoDatabase } from '../client';

export class ChatSettingsRepository extends MongoBaseRepository<ChatSettings> {
  constructor() {
    super('chat_settings', ChatSettingsSchema);
    logger.debug('ChatSettingsRepository initialized');
  }

  /**
   * Find chat settings by ID
   * @param id The chat settings ID
   * @returns Promise<ChatSettings | null> The chat settings if found, null otherwise
   */
  async findById(id: string): Promise<ChatSettings | null> {
    logger.debug('Finding chat settings by ID', { chatSettingsId: id });
    try {
      const collection = await this.getCollection();
      const result = await collection.findOne({ id });

      if (!result) {
        logger.debug('Chat settings not found', { chatSettingsId: id });
        return null;
      }

      const validated = this.validate(result);
      logger.debug('Chat settings found and validated', { chatSettingsId: id });
      return validated;
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
   * @param userId The user ID
   * @returns Promise<ChatSettings | null> The chat settings if found, null otherwise
   */
  async findByUserId(userId: string): Promise<ChatSettings | null> {
    logger.debug('Finding chat settings by user ID', { userId });
    try {
      const collection = await this.getCollection();
      const result = await collection.findOne({ userId });

      if (!result) {
        logger.debug('Chat settings not found for user', { userId });
        return null;
      }

      const validated = this.validate(result);
      logger.debug('Chat settings found for user', { userId });
      return validated;
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
   * @returns Promise<ChatSettings[]> Array of all chat settings
   */
  async findAll(): Promise<ChatSettings[]> {
    logger.debug('Finding all chat settings');
    try {
      const collection = await this.getCollection();
      const results = await collection.find({}).toArray();

      const chatSettings = results
        .map((doc) => {
          const validation = this.validateSafe(doc);
          if (validation.success && validation.data) {
            return validation.data;
          }
          return null;
        })
        .filter((settings): settings is ChatSettings => settings !== null);

      logger.debug('Retrieved all chat settings', { count: chatSettings.length });
      return chatSettings;
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
    logger.debug('Creating new chat settings', { userId: data.userId });
    try {
      const id = options?.id || this.generateId();
      const now = this.getCurrentTimestamp();
      const createdAt = options?.createdAt || now;

      const chatSettingsInput = {
        ...data,
        id,
        createdAt,
        updatedAt: now,
      };

      const validated = this.validate(chatSettingsInput);
      const collection = await this.getCollection();
      await collection.insertOne(validated as any);

      logger.info('Chat settings created successfully', { chatSettingsId: id, userId: data.userId });
      return validated;
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
    logger.debug('Updating chat settings', { chatSettingsId: id });
    try {
      const existing = await this.findById(id);
      if (!existing) {
        logger.warn('Chat settings not found for update', { chatSettingsId: id });
        return null;
      }

      const now = this.getCurrentTimestamp();
      const updated: ChatSettings = {
        ...existing,
        ...data,
        id: existing.id, // Preserve ID
        createdAt: existing.createdAt, // Preserve creation timestamp
        updatedAt: now,
      };

      const validated = this.validate(updated);
      const collection = await this.getCollection();

      await collection.updateOne({ id }, { $set: validated as any });

      logger.debug('Chat settings updated successfully', { chatSettingsId: id });
      return validated;
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
    logger.debug('Deleting chat settings', { chatSettingsId: id });
    try {
      const collection = await this.getCollection();
      const result = await collection.deleteOne({ id });

      if (result.deletedCount === 0) {
        logger.warn('Chat settings not found for deletion', { chatSettingsId: id });
        return false;
      }

      logger.debug('Chat settings deleted successfully', { chatSettingsId: id });
      return true;
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
    logger.debug('Creating chat settings for user', { userId });
    return this.create({ ...data, userId });
  }

  /**
   * Update chat settings for a user (creates if not exists)
   * @param userId The user ID
   * @param data Partial chat settings data to update
   * @returns Promise<ChatSettings | null> The updated/created chat settings
   */
  async updateForUser(userId: string, data: Partial<ChatSettings>): Promise<ChatSettings | null> {
    logger.debug('Updating chat settings for user', { userId });
    try {
      // Check if settings exist
      const existing = await this.findByUserId(userId);

      if (!existing) {
        // Create new settings with defaults
        logger.debug('Chat settings not found, creating new settings for user', { userId });

        // Try to get the "Standard" roleplay template ID for default
        let defaultRoleplayTemplateId: string | null = null;
        try {
          const db = await getMongoDatabase();
          const templatesCollection = db.collection('roleplay_templates');
          const standardTemplate = await templatesCollection.findOne({
            name: 'Standard',
            isBuiltIn: true,
          });
          if (standardTemplate) {
            defaultRoleplayTemplateId = (standardTemplate as any).id;
            logger.debug('Setting Standard template as default for new user', {
              userId,
              templateId: defaultRoleplayTemplateId,
            });
          }
        } catch (templateError) {
          logger.warn('Could not load default roleplay template', {
            userId,
            error: templateError instanceof Error ? templateError.message : String(templateError),
          });
        }

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
