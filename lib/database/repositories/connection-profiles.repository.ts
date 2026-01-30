/**
 * Connection Profiles Repository
 *
 * Backend-agnostic repository for ConnectionProfile and ApiKey entities.
 * Works with SQLite through the database abstraction layer.
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
      const profile = await this.findOneByFilter({
        userId,
        isDefault: true,
      } as QueryFilter);

      if (!profile) {
        return null;
      }
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
      const collection = await this.getApiKeysCollection();
      const docs = await collection.find({ userId } as QueryFilter);
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
      const collection = await this.getApiKeysCollection();
      const doc = await collection.findOne({ id } as QueryFilter);

      if (!doc) {
        return null;
      }

      const validated = ApiKeySchema.parse(doc);
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
      const collection = await this.getApiKeysCollection();
      const doc = await collection.findOne({ id, userId } as QueryFilter);

      if (!doc) {
        return null;
      }

      const validated = ApiKeySchema.parse(doc);
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
      const result = await this.updateApiKey(id, { lastUsed: this.getCurrentTimestamp() });

      if (result) {
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
