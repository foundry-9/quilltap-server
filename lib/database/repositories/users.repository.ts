/**
 * Users Repository
 *
 * Backend-agnostic repository for User entities.
 * Works with SQLite through the database abstraction layer.
 *
 * Handles CRUD operations for User entities.
 * Manages the 'users' collection.
 * Provides compound operations for GeneralSettings (user + chat settings).
 */

import { logger } from '@/lib/logger';
import { User, UserSchema, GeneralSettings, GeneralSettingsSchema, ChatSettings } from '@/lib/schemas/types';
import { AbstractBaseRepository, CreateOptions } from './base.repository';
import { QueryFilter } from '../interfaces';

/**
 * Users Repository
 * Manages users in the 'users' collection
 */
export class UsersRepository extends AbstractBaseRepository<User> {
  constructor() {
    super('users', UserSchema);
  }

  /**
   * Get current user (single-user system compatibility)
   * Returns the first user found, or null if no users exist
   */
  async getCurrentUser(): Promise<User | null> {
    try {
      const users = await this.findAll();
      if (users.length === 0) {
        return null;
      }
      return users[0];
    } catch (error) {
      logger.error('Error getting current user', {
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Find a user by ID
   */
  async findById(id: string): Promise<User | null> {
    try {
      return await this._findById(id);
    } catch (error) {
      logger.error('Error finding user by ID', {
        userId: id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Find a user by email
   */
  async findByEmail(email: string): Promise<User | null> {
    try {
      const user = await this.findOneByFilter({ email } as QueryFilter);

      if (!user) {
        return null;
      }
      return user;
    } catch (error) {
      logger.error('Error finding user by email', {
        email,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Find a user by username
   */
  async findByUsername(username: string): Promise<User | null> {
    try {
      const user = await this.findOneByFilter({ username } as QueryFilter);

      if (!user) {
        return null;
      }
      return user;
    } catch (error) {
      logger.error('Error finding user by username', {
        username,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Find all users
   */
  async findAll(): Promise<User[]> {
    try {
      const users = await this._findAll();
      return users;
    } catch (error) {
      logger.error('Error finding all users', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Create a new user
   */
  async create(
    data: Omit<User, 'id' | 'createdAt' | 'updatedAt'>,
    options?: CreateOptions
  ): Promise<User> {
    try {
      const user = await this._create(data, options);

      logger.info('User created successfully', {
        userId: user.id,
        username: data.username,
      });

      return user;
    } catch (error) {
      logger.error('Error creating user', {
        username: data.username,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Update a user
   */
  async update(id: string, data: Partial<User>): Promise<User | null> {
    try {
      // Remove id and createdAt to prevent accidental overwrites
      const updateData = { ...data };
      delete updateData.id;
      delete updateData.createdAt;

      const user = await this._update(id, updateData);

      if (user) {
        logger.info('User updated successfully', {
          userId: id,
        });
      } else {
        logger.warn('User not found during update', {
          userId: id,
        });
      }

      return user;
    } catch (error) {
      logger.error('Error updating user', {
        userId: id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Delete a user
   */
  async delete(id: string): Promise<boolean> {
    try {
      const result = await this._delete(id);

      if (result) {
        logger.info('User deleted successfully', {
          userId: id,
        });
      } else {
        logger.warn('User not found during delete', {
          userId: id,
        });
      }

      return result;
    } catch (error) {
      logger.error('Error deleting user', {
        userId: id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  // ============================================================================
  // GENERAL SETTINGS COMPOUND OPERATIONS
  // ============================================================================

  /**
   * Get general settings (user + chat settings combined)
   * Returns a compound object with version, user, chatSettings, and timestamps
   */
  async getGeneralSettings(userId: string): Promise<GeneralSettings | null> {
    try {
      // Get the chat settings repository from the database manager
      const db = await (await import('../manager')).getDatabaseAsync();
      const chatSettingsCollection = db.getCollection<ChatSettings>('chat_settings');

      // Fetch user and chat settings in parallel
      const [user, chatSettingsDocs] = await Promise.all([
        this.findById(userId),
        chatSettingsCollection.find({ userId } as QueryFilter),
      ]);

      if (!user) {
        logger.warn('User not found when retrieving general settings', {
          userId,
        });
        return null;
      }

      if (!chatSettingsDocs || chatSettingsDocs.length === 0) {
        logger.warn('Chat settings not found when retrieving general settings', {
          userId,
        });
        return null;
      }

      const chatSettings: ChatSettings = chatSettingsDocs[0];

      // Create the compound general settings object
      const now = new Date().toISOString();
      const generalSettings: GeneralSettings = {
        version: 1,
        user,
        chatSettings,
        createdAt: now,
        updatedAt: now,
      };

      const validationResult = this.validateGeneralSettingsSafe(generalSettings);
      if (!validationResult.success) {
        logger.warn('GeneralSettings validation failed', {
          userId,
          error: validationResult.error,
        });
        return null;
      }
      return validationResult.data || null;
    } catch (error) {
      logger.error('Error getting general settings', {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Update general settings (user + chat settings)
   * Updates both collections atomically
   */
  async updateGeneralSettings(
    userId: string,
    data: Partial<GeneralSettings>
  ): Promise<GeneralSettings | null> {
    try {
      // Get the chat settings repository from the database manager
      const db = await (await import('../manager')).getDatabaseAsync();
      const chatSettingsCollection = db.getCollection('chatSettings');

      // Update user if provided
      if (data.user) {
        const updatedUser = await this.update(userId, data.user);
        if (!updatedUser) {
          logger.error('Failed to update user during general settings update', {
            userId,
          });
          return null;
        }
      }

      // Update chat settings if provided
      if (data.chatSettings) {
        const result = await chatSettingsCollection.updateMany(
          { userId } as QueryFilter,
          {
            $set: {
              ...data.chatSettings,
              updatedAt: this.getCurrentTimestamp(),
            },
          } as any
        );

        if (result.modifiedCount === 0) {
          logger.error('Failed to update chat settings during general settings update', {
            userId,
          });
          return null;
        }
      }

      // Fetch and return the updated general settings
      const generalSettings = await this.getGeneralSettings(userId);

      if (!generalSettings) {
        logger.error('Failed to retrieve updated general settings', {
          userId,
        });
        return null;
      }

      logger.info('General settings updated successfully', {
        userId,
      });

      return generalSettings;
    } catch (error) {
      logger.error('Error updating general settings', {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  // ============================================================================
  // HELPER METHODS
  // ============================================================================

  /**
   * Validate general settings data against schema
   */
  private validateGeneralSettings(data: unknown): GeneralSettings {
    return GeneralSettingsSchema.parse(data) as GeneralSettings;
  }

  /**
   * Safely validate general settings data without throwing
   */
  private validateGeneralSettingsSafe(data: unknown): {
    success: boolean;
    data?: GeneralSettings;
    error?: string;
  } {
    try {
      const validated = this.validateGeneralSettings(data);
      return { success: true, data: validated };
    } catch (error: any) {
      logger.warn('GeneralSettings validation failed', {
        error: error.message,
      });
      return { success: false, error: error.message };
    }
  }
}
