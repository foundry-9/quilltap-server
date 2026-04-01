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
import { TypedQueryFilter, UpdateSpec } from '../interfaces';

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
    return this.safeQuery(
      async () => {
        const users = await this.findAll();
        if (users.length === 0) {
          return null;
        }
        return users[0];
      },
      'Error getting current user',
      {},
      null
    );
  }

  /**
   * Find a user by ID
   */
  async findById(id: string): Promise<User | null> {
    return this.safeQuery(
      () => this._findById(id),
      'Error finding user by ID',
      { userId: id }
    );
  }

  /**
   * Find a user by email
   */
  async findByEmail(email: string): Promise<User | null> {
    return this.safeQuery(
      async () => {
        const user = await this.findOneByFilter({ email });

        if (!user) {
          return null;
        }
        return user;
      },
      'Error finding user by email',
      { email }
    );
  }

  /**
   * Find a user by username
   */
  async findByUsername(username: string): Promise<User | null> {
    return this.safeQuery(
      async () => {
        const user = await this.findOneByFilter({ username });

        if (!user) {
          return null;
        }
        return user;
      },
      'Error finding user by username',
      { username }
    );
  }

  /**
   * Find all users
   */
  async findAll(): Promise<User[]> {
    return this.safeQuery(
      () => this._findAll(),
      'Error finding all users',
      {}
    );
  }

  /**
   * Create a new user
   */
  async create(
    data: Omit<User, 'id' | 'createdAt' | 'updatedAt'>,
    options?: CreateOptions
  ): Promise<User> {
    return this.safeQuery(
      async () => {
        const user = await this._create(data, options);

        logger.info('User created successfully', {
          userId: user.id,
          username: data.username,
        });

        return user;
      },
      'Error creating user',
      { username: data.username }
    );
  }

  /**
   * Update a user
   */
  async update(id: string, data: Partial<User>): Promise<User | null> {
    return this.safeQuery(
      async () => {
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
      },
      'Error updating user',
      { userId: id }
    );
  }

  /**
   * Delete a user
   */
  async delete(id: string): Promise<boolean> {
    return this.safeQuery(
      async () => {
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
      },
      'Error deleting user',
      { userId: id }
    );
  }

  /**
   * Migrate a user from an old ID to a new ID
   * Updates the user record and all related records that reference the user.
   * Runs within a transaction so all updates succeed or all roll back.
   */
  async migrateUserId(oldId: string, newId: string): Promise<void> {
    return this.safeQuery(
      async () => {
        const { withTransaction } = await import('../manager');

        await withTransaction(async (getCollection) => {
          // Tables that have a userId column referencing users
          // Note: table names must match actual SQLite table names from the schema
          const tablesWithUserId = [
            'chat_settings',
            'chats',
            'characters',
            'api_keys',
            'connection_profiles',
            'embedding_profiles',
            'prompt_templates',
            'files',
            'projects',
          ];

          // Update the userId foreign key in each related table
          for (const table of tablesWithUserId) {
            try {
              const collection = getCollection(table);
              const result = await collection.updateMany(
                { userId: oldId } as TypedQueryFilter<any>,
                { $set: { userId: newId } } as UpdateSpec<unknown>
              );
              logger.debug('Migrated userId references in table', {
                context: 'UsersRepository.migrateUserId',
                table,
                modifiedCount: result.modifiedCount,
              });
            } catch (tableError) {
              // Table might not exist yet or might not have userId column — log and continue
              logger.warn('Could not migrate userId in table', {
                context: 'UsersRepository.migrateUserId',
                table,
                error: tableError instanceof Error ? tableError.message : String(tableError),
              });
            }
          }

          // Finally, update the user's own primary key
          const usersCollection = getCollection('users');
          await usersCollection.updateMany(
            { id: oldId } as TypedQueryFilter<User>,
            { $set: { id: newId } } as UpdateSpec<unknown>
          );
        });

        logger.info('User ID migration completed', {
          context: 'UsersRepository.migrateUserId',
          oldId,
          newId,
        });
      },
      'Error migrating user ID',
      { oldId, newId }
    );
  }

  // ============================================================================
  // GENERAL SETTINGS COMPOUND OPERATIONS
  // ============================================================================

  /**
   * Get general settings (user + chat settings combined)
   * Returns a compound object with version, user, chatSettings, and timestamps
   */
  async getGeneralSettings(userId: string): Promise<GeneralSettings | null> {
    return this.safeQuery(
      async () => {
        // Get the chat settings repository from the database manager
        const db = await (await import('../manager')).getDatabaseAsync();
        const chatSettingsCollection = db.getCollection<ChatSettings>('chat_settings');

        // Fetch user and chat settings in parallel
        const [user, chatSettingsDocs] = await Promise.all([
          this.findById(userId),
          chatSettingsCollection.find({ userId } as TypedQueryFilter<ChatSettings>),
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
      },
      'Error getting general settings',
      { userId }
    );
  }

  /**
   * Update general settings (user + chat settings)
   * Updates both collections atomically
   */
  async updateGeneralSettings(
    userId: string,
    data: Partial<GeneralSettings>
  ): Promise<GeneralSettings | null> {
    return this.safeQuery(
      async () => {
        // Get the chat settings repository from the database manager
        const db = await (await import('../manager')).getDatabaseAsync();
        const chatSettingsCollection = db.getCollection<ChatSettings>('chatSettings');

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
            { userId } as TypedQueryFilter<ChatSettings>,
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
      },
      'Error updating general settings',
      { userId }
    );
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
