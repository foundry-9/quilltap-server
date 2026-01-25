/**
 * User Sync API Keys Repository
 *
 * Backend-agnostic repository for UserSyncApiKey entities.
 * Works with SQLite through the database abstraction layer.
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
import { UserOwnedBaseRepository, CreateOptions } from './base.repository';
import { QueryFilter } from '../interfaces';

// Number of bcrypt rounds for hashing
const BCRYPT_ROUNDS = 12;

/**
 * User Sync API Keys Repository
 * Implements CRUD operations for user sync API keys
 */
export class UserSyncApiKeysRepository extends UserOwnedBaseRepository<UserSyncApiKey> {
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
    return { plaintextKey, keyPrefix, keyHash };
  }

  /**
   * Verify a plaintext API key against a stored hash
   */
  async verifyApiKey(plaintextKey: string, keyHash: string): Promise<boolean> {
    try {
      const isValid = await bcrypt.compare(plaintextKey, keyHash);
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
    try {
      const key = await this._findById(id);

      if (!key) {
        return null;
      }
      return key;
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
    try {
      const keys = await this.findByFilter({ userId } as QueryFilter, { sort: { createdAt: -1 } });
      return keys;
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
    try {
      const keys = await this.findByFilter(
        { userId, isActive: true } as QueryFilter,
        { sort: { createdAt: -1 } }
      );
      return keys;
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
    try {
      const keys = await this._findAll();
      return keys;
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
    try {
      const keys = await this.findByFilter({ isActive: true } as QueryFilter);
      return keys;
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
    try {
      const key = await this._create(data, options);

      logger.info('User sync API key created successfully', {
        context: 'user-sync-api-keys-repo',
        keyId: key.id,
        userId: data.userId,
        name: data.name,
        keyPrefix: data.keyPrefix,
      });

      return key;
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
    try {
      // Generate the key
      const { plaintextKey, keyPrefix, keyHash } = await this.generateApiKey();

      const keyData: Omit<UserSyncApiKey, 'id' | 'createdAt' | 'updatedAt'> = {
        userId,
        name,
        keyPrefix,
        keyHash,
        isActive: true,
        lastUsedAt: null,
      };

      const key = await this._create(keyData);

      logger.info('User sync API key created successfully', {
        context: 'user-sync-api-keys-repo',
        keyId: key.id,
        userId,
        name,
        keyPrefix,
      });

      return {
        key,
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
    try {
      const key = await this._update(id, data as Partial<UserSyncApiKey>);

      if (!key) {
        logger.warn('User sync API key not found during update', {
          context: 'user-sync-api-keys-repo',
          keyId: id,
        });
        return null;
      }

      logger.info('User sync API key updated successfully', {
        context: 'user-sync-api-keys-repo',
        keyId: id,
      });

      return key;
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
    try {
      await this._update(id, { lastUsedAt: this.getCurrentTimestamp() } as Partial<UserSyncApiKey>);
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
    try {
      const result = await this._delete(id);

      if (!result) {
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
    try {
      const deletedCount = await this.deleteMany({ userId } as QueryFilter);

      logger.info('Deleted user sync API keys for user', {
        context: 'user-sync-api-keys-repo',
        userId,
        deletedCount,
      });

      return deletedCount;
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
