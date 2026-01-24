/**
 * Connection Profiles Repository
 *
 * Backend-agnostic repository for ConnectionProfile and ApiKey entities.
 * Works with both MongoDB and SQLite through the database abstraction layer.
 * Manages connection profiles, API keys, and their relationships.
 */

import { logger } from '@/lib/logger';
import {
  ConnectionProfile,
  ConnectionProfileSchema,
  ApiKey,
  ApiKeySchema,
} from '@/lib/schemas/types';
import { TaggableBaseRepository, CreateOptions } from './base.repository';
import { QueryFilter, UpdateSpec } from '../interfaces';
import { getCollection, ensureCollection } from '../manager';

/**
 * Connection Profiles Repository
 * Manages both ConnectionProfile and ApiKey entities
 */
export class ConnectionProfilesRepository extends TaggableBaseRepository<ConnectionProfile> {
  constructor() {
    super('connection_profiles', ConnectionProfileSchema);
  }

  // ============================================================================
  // CONNECTION PROFILE OPERATIONS
  // ============================================================================

  /**
   * Find a connection profile by ID
   */
  async findById(id: string): Promise<ConnectionProfile | null> {
    return this._findById(id);
  }

  /**
   * Find all connection profiles
   */
  async findAll(): Promise<ConnectionProfile[]> {
    return this._findAll();
  }

  /**
   * Find connection profiles with a specific tag
   */
  async findByTag(tagId: string): Promise<ConnectionProfile[]> {
    return super.findByTag(tagId);
  }

  /**
   * Find default connection profile for user
   */
  async findDefault(userId: string): Promise<ConnectionProfile | null> {
    try {
      logger.debug('Finding default connection profile for user', {
        userId,
        collection: this.collectionName,
      });

      const profile = await this.findOneByFilter({
        userId,
        isDefault: true,
      } as QueryFilter);

      if (!profile) {
        logger.debug('No default connection profile found for user', { userId });
        return null;
      }

      logger.debug('Default connection profile found for user', { userId });
      return profile;
    } catch (error) {
      logger.error('Error finding default connection profile', {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Create a new connection profile
   * @param data The connection profile data (without id, createdAt, updatedAt)
   * @param options Optional CreateOptions to specify ID and createdAt (for sync)
   */
  async create(
    data: Omit<ConnectionProfile, 'id' | 'createdAt' | 'updatedAt'>,
    options?: CreateOptions
  ): Promise<ConnectionProfile> {
    try {
      logger.debug('Creating new connection profile', {
        userId: data.userId,
        name: data.name,
        provider: data.provider,
        collection: this.collectionName,
        usingProvidedId: !!options?.id,
      });

      const profile = await this._create(data, options);

      logger.info('Connection profile created successfully', {
        profileId: profile.id,
        userId: data.userId,
        provider: data.provider,
      });

      return profile;
    } catch (error) {
      logger.error('Error creating connection profile', {
        userId: data.userId,
        name: data.name,
        provider: data.provider,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Update a connection profile
   */
  async update(id: string, data: Partial<ConnectionProfile>): Promise<ConnectionProfile | null> {
    try {
      logger.debug('Updating connection profile', {
        profileId: id,
        collection: this.collectionName,
      });

      const profile = await this._update(id, data);

      if (profile) {
        logger.info('Connection profile updated successfully', { profileId: id });
      }

      return profile;
    } catch (error) {
      logger.error('Error updating connection profile', {
        profileId: id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Delete a connection profile
   */
  async delete(id: string): Promise<boolean> {
    try {
      logger.debug('Deleting connection profile', {
        profileId: id,
        collection: this.collectionName,
      });

      const result = await this._delete(id);

      if (result) {
        logger.info('Connection profile deleted successfully', { profileId: id });
      }

      return result;
    } catch (error) {
      logger.error('Error deleting connection profile', {
        profileId: id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Add a tag to a connection profile
   */
  async addTag(profileId: string, tagId: string): Promise<ConnectionProfile | null> {
    return super.addTag(profileId, tagId);
  }

  /**
   * Remove a tag from a connection profile
   */
  async removeTag(profileId: string, tagId: string): Promise<ConnectionProfile | null> {
    return super.removeTag(profileId, tagId);
  }

  // ============================================================================
  // TOKEN USAGE TRACKING
  // ============================================================================

  /**
   * Increment token usage counters for a connection profile
   * Uses atomic operations for thread safety
   */
  async incrementTokenUsage(
    profileId: string,
    promptTokens: number,
    completionTokens: number
  ): Promise<void> {
    try {
      logger.debug('Incrementing token usage for connection profile', {
        profileId,
        promptTokens,
        completionTokens,
        collection: this.collectionName,
      });

      const collection = await this.getCollection();
      const now = this.getCurrentTimestamp();

      const result = await collection.updateOne(
        { id: profileId } as QueryFilter,
        {
          $inc: {
            totalTokens: promptTokens + completionTokens,
            totalPromptTokens: promptTokens,
            totalCompletionTokens: completionTokens,
            messageCount: 1,
          },
          $set: { updatedAt: now },
        } as UpdateSpec<ConnectionProfile>
      );

      if (result.matchedCount === 0) {
        logger.warn('Connection profile not found for token usage increment', { profileId });
        return;
      }

      logger.debug('Token usage incremented successfully', {
        profileId,
        promptTokens,
        completionTokens,
        modifiedCount: result.modifiedCount,
      });
    } catch (error) {
      logger.error('Error incrementing token usage', {
        profileId,
        promptTokens,
        completionTokens,
        error: error instanceof Error ? error.message : String(error),
      });
      // Don't throw - token tracking failures shouldn't break message flow
    }
  }

  /**
   * Reset token usage counters for a connection profile
   */
  async resetTokenUsage(profileId: string): Promise<ConnectionProfile | null> {
    try {
      logger.debug('Resetting token usage for connection profile', {
        profileId,
        collection: this.collectionName,
      });

      return await this.update(profileId, {
        totalTokens: 0,
        totalPromptTokens: 0,
        totalCompletionTokens: 0,
        messageCount: 0,
      } as Partial<ConnectionProfile>);
    } catch (error) {
      logger.error('Error resetting token usage', {
        profileId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  // ============================================================================
  // API KEY OPERATIONS
  // ============================================================================

  /**
   * Get the API keys collection
   */
  private async getApiKeysCollection() {
    try {
      logger.debug('Retrieved API keys collection', { collection: 'api_keys' });
      // Ensure the API keys collection exists
      await ensureCollection('api_keys', ApiKeySchema);
      // Get the API keys collection from the manager
      return getCollection<ApiKey>('api_keys');
    } catch (error) {
      logger.error('Failed to get API keys collection', {
        collection: 'api_keys',
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Get all API keys for a specific user
   */
  async getApiKeysByUserId(userId: string): Promise<ApiKey[]> {
    try {
      logger.debug('Finding API keys by user ID', { userId, collection: 'api_keys' });

      const collection = await this.getApiKeysCollection();
      const docs = await collection.find({ userId } as QueryFilter);

      logger.debug('Retrieved API keys from database for user', { userId, count: docs.length });

      const validated = docs
        .map((doc) => {
          const result = ApiKeySchema.safeParse(doc);
          if (!result.success) {
            logger.warn('API key validation failed', {
              keyId: (doc as any).id,
              userId,
              error: result.error.message,
            });
            return null;
          }
          return result.data;
        })
        .filter((key) => key !== null) as ApiKey[];

      logger.debug('User API keys validated', {
        userId,
        total: docs.length,
        validated: validated.length,
      });
      return validated;
    } catch (error) {
      logger.error('Error finding API keys by user ID', {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Find API key by ID
   */
  async findApiKeyById(id: string): Promise<ApiKey | null> {
    try {
      logger.debug('Finding API key by ID', {
        keyId: id,
        collection: 'api_keys',
      });

      const collection = await this.getApiKeysCollection();
      const doc = await collection.findOne({ id } as QueryFilter);

      if (!doc) {
        logger.debug('API key not found', { keyId: id });
        return null;
      }

      const validated = ApiKeySchema.parse(doc);
      logger.debug('API key found and validated', { keyId: id });
      return validated;
    } catch (error) {
      logger.error('Error finding API key by ID', {
        keyId: id,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Find API key by ID and verify ownership
   */
  async findApiKeyByIdAndUserId(id: string, userId: string): Promise<ApiKey | null> {
    try {
      logger.debug('Finding API key by ID and user ID', {
        keyId: id,
        userId,
        collection: 'api_keys',
      });

      const collection = await this.getApiKeysCollection();
      const doc = await collection.findOne({ id, userId } as QueryFilter);

      if (!doc) {
        logger.debug('API key not found for user', { keyId: id, userId });
        return null;
      }

      const validated = ApiKeySchema.parse(doc);
      logger.debug('API key found and validated for user', { keyId: id, userId });
      return validated;
    } catch (error) {
      logger.error('Error finding API key by ID and user ID', {
        keyId: id,
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Create a new API key
   */
  async createApiKey(data: Omit<ApiKey, 'id' | 'createdAt' | 'updatedAt'>): Promise<ApiKey> {
    try {
      logger.debug('Creating new API key', {
        label: data.label,
        provider: data.provider,
        collection: 'api_keys',
      });

      const id = this.generateId();
      const now = this.getCurrentTimestamp();

      const apiKey: ApiKey = {
        ...data,
        id,
        createdAt: now,
        updatedAt: now,
      };

      const validated = ApiKeySchema.parse(apiKey);

      const collection = await this.getApiKeysCollection();
      await collection.insertOne(validated);

      logger.info('API key created successfully', {
        keyId: id,
        label: data.label,
        provider: data.provider,
      });

      return validated;
    } catch (error) {
      logger.error('Error creating API key', {
        label: data.label,
        provider: data.provider,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Update an API key
   */
  async updateApiKey(id: string, data: Partial<ApiKey>): Promise<ApiKey | null> {
    try {
      logger.debug('Updating API key', {
        keyId: id,
        collection: 'api_keys',
      });

      const existing = await this.findApiKeyById(id);
      if (!existing) {
        logger.warn('API key not found for update', { keyId: id });
        return null;
      }

      const now = this.getCurrentTimestamp();
      const updated: ApiKey = {
        ...existing,
        ...data,
        id: existing.id, // Preserve ID
        createdAt: existing.createdAt, // Preserve creation timestamp
        updatedAt: now,
      };

      const validated = ApiKeySchema.parse(updated);

      const collection = await this.getApiKeysCollection();
      const result = await collection.updateOne(
        { id } as QueryFilter,
        { $set: validated } as UpdateSpec<ApiKey>
      );

      logger.info('API key updated successfully', {
        keyId: id,
        matchedCount: result.matchedCount,
        modifiedCount: result.modifiedCount,
      });

      return validated;
    } catch (error) {
      logger.error('Error updating API key', {
        keyId: id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Delete an API key
   */
  async deleteApiKey(id: string): Promise<boolean> {
    try {
      logger.debug('Deleting API key', {
        keyId: id,
        collection: 'api_keys',
      });

      const collection = await this.getApiKeysCollection();
      const result = await collection.deleteOne({ id } as QueryFilter);

      if (result.deletedCount === 0) {
        logger.warn('API key not found for deletion', { keyId: id });
        return false;
      }

      logger.info('API key deleted successfully', {
        keyId: id,
        deletedCount: result.deletedCount,
      });

      return true;
    } catch (error) {
      logger.error('Error deleting API key', {
        keyId: id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Update API key last used timestamp
   */
  async recordApiKeyUsage(id: string): Promise<ApiKey | null> {
    try {
      logger.debug('Recording API key usage', {
        keyId: id,
        collection: 'api_keys',
      });

      const result = await this.updateApiKey(id, { lastUsed: this.getCurrentTimestamp() });

      if (result) {
        logger.debug('API key usage recorded', { keyId: id });
      }

      return result;
    } catch (error) {
      logger.error('Error recording API key usage', {
        keyId: id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}
