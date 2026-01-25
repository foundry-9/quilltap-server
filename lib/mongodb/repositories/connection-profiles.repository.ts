/**
 * MongoDB Connection Profiles Repository
 *
 * Handles CRUD operations for ConnectionProfile and ApiKey entities in MongoDB.
 * Provides methods for managing connection profiles, API keys, and their relationships.
 * Uses two collections: 'connection_profiles' and 'api_keys'
 */

import { Collection } from 'mongodb';
import {
  ConnectionProfile,
  ConnectionProfileSchema,
  ApiKey,
  ApiKeySchema,
} from '@/lib/schemas/types';
import { logger } from '@/lib/logger';
import { MongoBaseRepository, CreateOptions } from './base.repository';

/**
 * Connection Profiles Repository
 * Manages both ConnectionProfile and ApiKey entities
 */
export class ConnectionProfilesRepository extends MongoBaseRepository<ConnectionProfile> {
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
    try {
      const collection = await this.getCollection();
      const doc = await collection.findOne({ id });

      if (!doc) {
        return null;
      }

      const validated = this.validate(doc);
      return validated;
    } catch (error) {
      logger.error('Error finding connection profile by ID', {
        profileId: id,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Find all connection profiles
   */
  async findAll(): Promise<ConnectionProfile[]> {
    try {
      const collection = await this.getCollection();
      const docs = await collection.find({}).toArray();
      const validated = docs
        .map((doc) => this.validateSafe(doc))
        .filter((result) => result.success)
        .map((result) => result.data!);
      return validated;
    } catch (error) {
      logger.error('Error finding all connection profiles', {
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Find connection profiles by user ID
   */
  async findByUserId(userId: string): Promise<ConnectionProfile[]> {
    try {
      const collection = await this.getCollection();
      const docs = await collection.find({ userId }).toArray();
      const validated = docs
        .map((doc) => this.validateSafe(doc))
        .filter((result) => result.success)
        .map((result) => result.data!);
      return validated;
    } catch (error) {
      logger.error('Error finding connection profiles by user ID', {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Find connection profiles with a specific tag
   */
  async findByTag(tagId: string): Promise<ConnectionProfile[]> {
    try {
      const collection = await this.getCollection();
      const docs = await collection.find({ tags: tagId }).toArray();
      const validated = docs
        .map((doc) => this.validateSafe(doc))
        .filter((result) => result.success)
        .map((result) => result.data!);
      return validated;
    } catch (error) {
      logger.error('Error finding connection profiles by tag', {
        tagId,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Find default connection profile for user
   */
  async findDefault(userId: string): Promise<ConnectionProfile | null> {
    try {
      const collection = await this.getCollection();
      const doc = await collection.findOne({ userId, isDefault: true });

      if (!doc) {
        return null;
      }

      const validated = this.validate(doc);
      return validated;
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
      const id = options?.id || this.generateId();
      const now = this.getCurrentTimestamp();
      const createdAt = options?.createdAt || now;
      const profile: ConnectionProfile = {
        ...data,
        id,
        createdAt,
        updatedAt: now,
      };

      const validated = this.validate(profile);

      const collection = await this.getCollection();
      const result = await collection.insertOne(validated as any);

      logger.info('Connection profile created successfully', {
        profileId: id,
        userId: data.userId,
        provider: data.provider,
        insertedId: result.insertedId.toString(),
      });

      return validated;
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
      const existing = await this.findById(id);
      if (!existing) {
        logger.warn('Connection profile not found for update', { profileId: id });
        return null;
      }

      const now = this.getCurrentTimestamp();
      const updated: ConnectionProfile = {
        ...existing,
        ...data,
        id: existing.id, // Preserve ID
        createdAt: existing.createdAt, // Preserve creation timestamp
        updatedAt: now,
      };

      const validated = this.validate(updated);

      const collection = await this.getCollection();
      const result = await collection.updateOne(
        { id },
        { $set: validated as any }
      );

      logger.info('Connection profile updated successfully', {
        profileId: id,
        matchedCount: result.matchedCount,
        modifiedCount: result.modifiedCount,
      });

      return validated;
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
      const collection = await this.getCollection();
      const result = await collection.deleteOne({ id });

      if (result.deletedCount === 0) {
        logger.warn('Connection profile not found for deletion', { profileId: id });
        return false;
      }

      logger.info('Connection profile deleted successfully', {
        profileId: id,
        deletedCount: result.deletedCount,
      });

      return true;
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
    try {
      const profile = await this.findById(profileId);
      if (!profile) {
        logger.warn('Connection profile not found for tag addition', { profileId });
        return null;
      }

      if (!profile.tags.includes(tagId)) {
        profile.tags.push(tagId);
        return await this.update(profileId, { tags: profile.tags });
      }
      return profile;
    } catch (error) {
      logger.error('Error adding tag to connection profile', {
        profileId,
        tagId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Remove a tag from a connection profile
   */
  async removeTag(profileId: string, tagId: string): Promise<ConnectionProfile | null> {
    try {
      const profile = await this.findById(profileId);
      if (!profile) {
        logger.warn('Connection profile not found for tag removal', { profileId });
        return null;
      }

      const initialLength = profile.tags.length;
      profile.tags = profile.tags.filter((id) => id !== tagId);

      if (profile.tags.length < initialLength) {
        return await this.update(profileId, { tags: profile.tags });
      }
      return profile;
    } catch (error) {
      logger.error('Error removing tag from connection profile', {
        profileId,
        tagId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  // ============================================================================
  // TOKEN USAGE TRACKING
  // ============================================================================

  /**
   * Increment token usage counters for a connection profile
   * Uses atomic $inc operations for thread safety
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
        { id: profileId },
        {
          $inc: {
            totalTokens: promptTokens + completionTokens,
            totalPromptTokens: promptTokens,
            totalCompletionTokens: completionTokens,
            messageCount: 1,
          },
          $set: { updatedAt: now },
        }
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
      });
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
  private async getApiKeysCollection(): Promise<Collection> {
    try {
      const db = await this.getCollection();
      const mongoDb = db.db;
      return mongoDb.collection('api_keys');
    } catch (error) {
      logger.error('Failed to get MongoDB API keys collection', {
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
      const docs = await collection.find({ userId }).toArray();
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
      const doc = await collection.findOne({ id });

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
      const doc = await collection.findOne({ id, userId });

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
      const result = await collection.insertOne(validated as any);

      logger.info('API key created successfully', {
        keyId: id,
        label: data.label,
        provider: data.provider,
        insertedId: result.insertedId.toString(),
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
        { id },
        { $set: validated as any }
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
      const result = await collection.deleteOne({ id });

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
