/**
 * MongoDB User Sync API Keys Repository
 *
 * Handles CRUD operations for UserSyncApiKey entities in MongoDB.
 * Manages API keys for authenticating sync requests from remote instances.
 */

import crypto from 'crypto';
import bcrypt from 'bcrypt';
import { logger } from '@/lib/logger';
import {
  UserSyncApiKey,
  UserSyncApiKeySchema,
  CreateUserSyncApiKey,
  CreateApiKeyResponse,
  API_KEY_PREFIX,
  API_KEY_RANDOM_LENGTH,
} from '@/lib/sync/user-api-keys';
import { MongoBaseRepository, CreateOptions } from './base.repository';

// Number of bcrypt rounds for hashing
const BCRYPT_ROUNDS = 12;

/**
 * MongoDB User Sync API Keys Repository
 * Implements CRUD operations for user sync API keys
 */
export class UserSyncApiKeysRepository extends MongoBaseRepository<UserSyncApiKey> {
  constructor() {
    super('user_sync_api_keys', UserSyncApiKeySchema);
  }

  /**
   * Generate a new API key
   * Returns the plaintext key and its components for storage
   */
  private async generateApiKey(): Promise<{ plaintextKey: string; keyPrefix: string; keyHash: string }> {
    // Generate random bytes and convert to hex
    const randomBytes = crypto.randomBytes(API_KEY_RANDOM_LENGTH / 2);
    const randomHex = randomBytes.toString('hex');

    // Create the full plaintext key
    const plaintextKey = `${API_KEY_PREFIX}${randomHex}`;

    // Extract prefix for display (first 8 chars of the random part)
    const keyPrefix = randomHex.substring(0, 8);

    // Hash the full key with bcrypt
    const keyHash = await bcrypt.hash(plaintextKey, BCRYPT_ROUNDS);

    logger.debug('Generated new API key', {
      context: 'user-sync-api-keys-repo',
      keyPrefix,
    });

    return { plaintextKey, keyPrefix, keyHash };
  }

  /**
   * Verify a plaintext API key against a stored hash
   */
  async verifyApiKey(plaintextKey: string, keyHash: string): Promise<boolean> {
    try {
      const isValid = await bcrypt.compare(plaintextKey, keyHash);

      logger.debug('API key verification result', {
        context: 'user-sync-api-keys-repo',
        isValid,
      });

      return isValid;
    } catch (error) {
      logger.error('Error verifying API key', {
        context: 'user-sync-api-keys-repo',
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  /**
   * Find an API key by ID
   */
  async findById(id: string): Promise<UserSyncApiKey | null> {
    const collection = await this.getCollection();

    logger.debug('Finding user sync API key by ID', {
      context: 'user-sync-api-keys-repo',
      keyId: id,
    });

    try {
      const key = await collection.findOne({ id });

      if (!key) {
        logger.debug('User sync API key not found', {
          context: 'user-sync-api-keys-repo',
          keyId: id,
        });
        return null;
      }

      const { _id, ...keyData } = key as any;

      const validationResult = this.validateSafe(keyData);
      if (!validationResult.success) {
        logger.warn('User sync API key validation failed', {
          context: 'user-sync-api-keys-repo',
          keyId: id,
          error: validationResult.error,
        });
        return null;
      }

      logger.debug('User sync API key found by ID', {
        context: 'user-sync-api-keys-repo',
        keyId: id,
      });

      return validationResult.data || null;
    } catch (error) {
      logger.error('Error finding user sync API key by ID', {
        context: 'user-sync-api-keys-repo',
        keyId: id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Find all API keys for a user
   */
  async findByUserId(userId: string): Promise<UserSyncApiKey[]> {
    const collection = await this.getCollection();

    logger.debug('Finding user sync API keys by user ID', {
      context: 'user-sync-api-keys-repo',
      userId,
    });

    try {
      const keys = await collection.find({ userId }).sort({ createdAt: -1 }).toArray();

      logger.debug('Retrieved user sync API keys by user ID', {
        context: 'user-sync-api-keys-repo',
        userId,
        count: keys.length,
      });

      const validatedKeys: UserSyncApiKey[] = [];
      for (const key of keys) {
        const { _id, ...keyData } = key as any;
        const validationResult = this.validateSafe(keyData);
        if (validationResult.success && validationResult.data) {
          validatedKeys.push(validationResult.data);
        } else {
          logger.warn('Skipping invalid user sync API key during findByUserId', {
            context: 'user-sync-api-keys-repo',
            userId,
            error: validationResult.error,
          });
        }
      }

      return validatedKeys;
    } catch (error) {
      logger.error('Error finding user sync API keys by user ID', {
        context: 'user-sync-api-keys-repo',
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Find all active API keys for a user
   */
  async findActiveByUserId(userId: string): Promise<UserSyncApiKey[]> {
    const collection = await this.getCollection();

    logger.debug('Finding active user sync API keys by user ID', {
      context: 'user-sync-api-keys-repo',
      userId,
    });

    try {
      const keys = await collection.find({ userId, isActive: true }).sort({ createdAt: -1 }).toArray();

      logger.debug('Retrieved active user sync API keys by user ID', {
        context: 'user-sync-api-keys-repo',
        userId,
        count: keys.length,
      });

      const validatedKeys: UserSyncApiKey[] = [];
      for (const key of keys) {
        const { _id, ...keyData } = key as any;
        const validationResult = this.validateSafe(keyData);
        if (validationResult.success && validationResult.data) {
          validatedKeys.push(validationResult.data);
        } else {
          logger.warn('Skipping invalid user sync API key during findActiveByUserId', {
            context: 'user-sync-api-keys-repo',
            userId,
            error: validationResult.error,
          });
        }
      }

      return validatedKeys;
    } catch (error) {
      logger.error('Error finding active user sync API keys by user ID', {
        context: 'user-sync-api-keys-repo',
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Find all API keys
   */
  async findAll(): Promise<UserSyncApiKey[]> {
    const collection = await this.getCollection();

    logger.debug('Finding all user sync API keys', {
      context: 'user-sync-api-keys-repo',
    });

    try {
      const keys = await collection.find({}).sort({ createdAt: -1 }).toArray();

      logger.debug('Retrieved all user sync API keys', {
        context: 'user-sync-api-keys-repo',
        count: keys.length,
      });

      const validatedKeys: UserSyncApiKey[] = [];
      for (const key of keys) {
        const { _id, ...keyData } = key as any;
        const validationResult = this.validateSafe(keyData);
        if (validationResult.success && validationResult.data) {
          validatedKeys.push(validationResult.data);
        } else {
          logger.warn('Skipping invalid user sync API key during findAll', {
            context: 'user-sync-api-keys-repo',
            error: validationResult.error,
          });
        }
      }

      return validatedKeys;
    } catch (error) {
      logger.error('Error finding all user sync API keys', {
        context: 'user-sync-api-keys-repo',
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Find all active API keys (for auth validation)
   * Used when checking if a Bearer token matches any valid key
   */
  async findAllActive(): Promise<UserSyncApiKey[]> {
    const collection = await this.getCollection();

    logger.debug('Finding all active user sync API keys', {
      context: 'user-sync-api-keys-repo',
    });

    try {
      const keys = await collection.find({ isActive: true }).toArray();

      logger.debug('Retrieved all active user sync API keys', {
        context: 'user-sync-api-keys-repo',
        count: keys.length,
      });

      const validatedKeys: UserSyncApiKey[] = [];
      for (const key of keys) {
        const { _id, ...keyData } = key as any;
        const validationResult = this.validateSafe(keyData);
        if (validationResult.success && validationResult.data) {
          validatedKeys.push(validationResult.data);
        }
      }

      return validatedKeys;
    } catch (error) {
      logger.error('Error finding all active user sync API keys', {
        context: 'user-sync-api-keys-repo',
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Create a new API key entity (implements abstract method)
   * Note: For normal API key creation, use createApiKey() which returns the plaintext key
   */
  async create(
    data: Omit<UserSyncApiKey, 'id' | 'createdAt' | 'updatedAt'>,
    options?: CreateOptions
  ): Promise<UserSyncApiKey> {
    const collection = await this.getCollection();
    const id = options?.id || this.generateId();
    const now = this.getCurrentTimestamp();
    const createdAt = options?.createdAt || now;

    logger.debug('Creating user sync API key via standard create', {
      context: 'user-sync-api-keys-repo',
      userId: data.userId,
      name: data.name,
    });

    try {
      const key: UserSyncApiKey = {
        ...data,
        id,
        createdAt,
        updatedAt: now,
      };

      const validated = this.validate(key);

      await collection.insertOne(validated as any);

      logger.info('User sync API key created successfully', {
        context: 'user-sync-api-keys-repo',
        keyId: id,
        userId: data.userId,
        name: data.name,
        keyPrefix: data.keyPrefix,
      });

      return validated;
    } catch (error) {
      logger.error('Error creating user sync API key', {
        context: 'user-sync-api-keys-repo',
        userId: data.userId,
        name: data.name,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Create a new API key for a user
   * Returns both the stored key data and the plaintext key (only shown once)
   */
  async createApiKey(userId: string, name: string): Promise<CreateApiKeyResponse> {
    const collection = await this.getCollection();
    const id = this.generateId();
    const now = this.getCurrentTimestamp();

    logger.debug('Creating new user sync API key', {
      context: 'user-sync-api-keys-repo',
      userId,
      name,
    });

    try {
      // Generate the key
      const { plaintextKey, keyPrefix, keyHash } = await this.generateApiKey();

      const key: UserSyncApiKey = {
        id,
        userId,
        name,
        keyPrefix,
        keyHash,
        isActive: true,
        lastUsedAt: null,
        createdAt: now,
        updatedAt: now,
      };

      const validated = this.validate(key);

      await collection.insertOne(validated as any);

      logger.info('User sync API key created successfully', {
        context: 'user-sync-api-keys-repo',
        keyId: id,
        userId,
        name,
        keyPrefix,
      });

      return {
        key: validated,
        plaintextKey,
      };
    } catch (error) {
      logger.error('Error creating user sync API key', {
        context: 'user-sync-api-keys-repo',
        userId,
        name,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Update an API key's name or active status
   */
  async update(id: string, data: { name?: string; isActive?: boolean }): Promise<UserSyncApiKey | null> {
    const collection = await this.getCollection();
    const now = this.getCurrentTimestamp();

    logger.debug('Updating user sync API key', {
      context: 'user-sync-api-keys-repo',
      keyId: id,
    });

    try {
      const updateData: any = {
        ...data,
        updatedAt: now,
      };

      const result = await collection.findOneAndUpdate(
        { id },
        { $set: updateData },
        { returnDocument: 'after' }
      );

      if (!result) {
        logger.warn('User sync API key not found during update', {
          context: 'user-sync-api-keys-repo',
          keyId: id,
        });
        return null;
      }

      const { _id, ...keyData } = result as any;

      const validationResult = this.validateSafe(keyData);
      if (!validationResult.success) {
        logger.warn('Updated user sync API key validation failed', {
          context: 'user-sync-api-keys-repo',
          keyId: id,
          error: validationResult.error,
        });
        return null;
      }

      logger.info('User sync API key updated successfully', {
        context: 'user-sync-api-keys-repo',
        keyId: id,
      });

      return validationResult.data || null;
    } catch (error) {
      logger.error('Error updating user sync API key', {
        context: 'user-sync-api-keys-repo',
        keyId: id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Update last used timestamp for an API key
   */
  async updateLastUsed(id: string): Promise<void> {
    const collection = await this.getCollection();
    const now = this.getCurrentTimestamp();

    logger.debug('Updating last used timestamp for API key', {
      context: 'user-sync-api-keys-repo',
      keyId: id,
    });

    try {
      await collection.updateOne(
        { id },
        { $set: { lastUsedAt: now, updatedAt: now } }
      );

      logger.debug('Updated last used timestamp for API key', {
        context: 'user-sync-api-keys-repo',
        keyId: id,
      });
    } catch (error) {
      logger.error('Error updating last used timestamp for API key', {
        context: 'user-sync-api-keys-repo',
        keyId: id,
        error: error instanceof Error ? error.message : String(error),
      });
      // Don't throw - this is a non-critical update
    }
  }

  /**
   * Delete an API key
   */
  async delete(id: string): Promise<boolean> {
    const collection = await this.getCollection();

    logger.debug('Deleting user sync API key', {
      context: 'user-sync-api-keys-repo',
      keyId: id,
    });

    try {
      const result = await collection.deleteOne({ id });

      if (result.deletedCount === 0) {
        logger.warn('User sync API key not found during delete', {
          context: 'user-sync-api-keys-repo',
          keyId: id,
        });
        return false;
      }

      logger.info('User sync API key deleted successfully', {
        context: 'user-sync-api-keys-repo',
        keyId: id,
      });

      return true;
    } catch (error) {
      logger.error('Error deleting user sync API key', {
        context: 'user-sync-api-keys-repo',
        keyId: id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Delete all API keys for a user
   */
  async deleteByUserId(userId: string): Promise<number> {
    const collection = await this.getCollection();

    logger.debug('Deleting all user sync API keys for user', {
      context: 'user-sync-api-keys-repo',
      userId,
    });

    try {
      const result = await collection.deleteMany({ userId });

      logger.info('Deleted user sync API keys for user', {
        context: 'user-sync-api-keys-repo',
        userId,
        deletedCount: result.deletedCount,
      });

      return result.deletedCount;
    } catch (error) {
      logger.error('Error deleting user sync API keys for user', {
        context: 'user-sync-api-keys-repo',
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}
