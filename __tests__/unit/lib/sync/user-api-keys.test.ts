/**
 * Unit Tests for User Sync API Keys
 *
 * Tests validation of user API key schemas and constants.
 */

import {
  UserSyncApiKeySchema,
  CreateUserSyncApiKeySchema,
  API_KEY_PREFIX,
  API_KEY_RANDOM_LENGTH,
} from '@/lib/sync/user-api-keys';

describe('User Sync API Keys', () => {
  // ============================================================================
  // CONSTANTS
  // ============================================================================

  describe('Constants', () => {
    it('should have correct API key prefix', () => {
      expect(API_KEY_PREFIX).toBe('qt_sync_');
    });

    it('should have correct random length', () => {
      expect(API_KEY_RANDOM_LENGTH).toBe(32);
    });
  });

  // ============================================================================
  // USER SYNC API KEY SCHEMA
  // ============================================================================

  describe('UserSyncApiKeySchema', () => {
    const validApiKey = {
      id: '550e8400-e29b-41d4-a716-446655440000',
      userId: '550e8400-e29b-41d4-a716-446655440001',
      name: 'Home Server',
      keyPrefix: '12345678',
      keyHash: '$2b$12$abcdefghijklmnopqrstuvwxyz123456789',
      isActive: true,
      lastUsedAt: '2025-01-01T12:00:00.000Z',
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-01T00:00:00.000Z',
    };

    it('should validate valid API key', () => {
      const result = UserSyncApiKeySchema.safeParse(validApiKey);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual(validApiKey);
      }
    });

    it('should validate with null lastUsedAt', () => {
      const valid = { ...validApiKey, lastUsedAt: null };
      const result = UserSyncApiKeySchema.safeParse(valid);
      expect(result.success).toBe(true);
    });

    it('should validate with omitted lastUsedAt', () => {
      const { lastUsedAt, ...valid } = validApiKey;
      const result = UserSyncApiKeySchema.safeParse(valid);
      expect(result.success).toBe(true);
    });

    it('should fail with missing id', () => {
      const { id, ...invalid } = validApiKey;
      const result = UserSyncApiKeySchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it('should fail with invalid id format', () => {
      const invalid = { ...validApiKey, id: 'not-a-uuid' };
      const result = UserSyncApiKeySchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it('should fail with missing userId', () => {
      const { userId, ...invalid } = validApiKey;
      const result = UserSyncApiKeySchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it('should fail with invalid userId format', () => {
      const invalid = { ...validApiKey, userId: 'not-a-uuid' };
      const result = UserSyncApiKeySchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it('should fail with missing name', () => {
      const { name, ...invalid } = validApiKey;
      const result = UserSyncApiKeySchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it('should fail with empty name', () => {
      const invalid = { ...validApiKey, name: '' };
      const result = UserSyncApiKeySchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it('should fail with name exceeding 100 characters', () => {
      const invalid = { ...validApiKey, name: 'x'.repeat(101) };
      const result = UserSyncApiKeySchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it('should validate with name at max length (100 chars)', () => {
      const valid = { ...validApiKey, name: 'x'.repeat(100) };
      const result = UserSyncApiKeySchema.safeParse(valid);
      expect(result.success).toBe(true);
    });

    it('should fail with missing keyPrefix', () => {
      const { keyPrefix, ...invalid } = validApiKey;
      const result = UserSyncApiKeySchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it('should fail with keyPrefix not 8 characters', () => {
      const invalid = { ...validApiKey, keyPrefix: '1234567' };
      const result = UserSyncApiKeySchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it('should fail with keyPrefix too long', () => {
      const invalid = { ...validApiKey, keyPrefix: '123456789' };
      const result = UserSyncApiKeySchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it('should fail with missing keyHash', () => {
      const { keyHash, ...invalid } = validApiKey;
      const result = UserSyncApiKeySchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it('should apply default isActive of true when omitted', () => {
      const { isActive, ...valid } = validApiKey;
      const result = UserSyncApiKeySchema.safeParse(valid);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.isActive).toBe(true);
      }
    });

    it('should fail with invalid isActive type', () => {
      const invalid = { ...validApiKey, isActive: 'true' };
      const result = UserSyncApiKeySchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it('should fail with missing createdAt', () => {
      const { createdAt, ...invalid } = validApiKey;
      const result = UserSyncApiKeySchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it('should fail with invalid createdAt format', () => {
      const invalid = { ...validApiKey, createdAt: 'not-a-timestamp' };
      const result = UserSyncApiKeySchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it('should fail with missing updatedAt', () => {
      const { updatedAt, ...invalid } = validApiKey;
      const result = UserSyncApiKeySchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it('should fail with invalid updatedAt format', () => {
      const invalid = { ...validApiKey, updatedAt: 'not-a-timestamp' };
      const result = UserSyncApiKeySchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it('should validate with Date objects in timestamp fields', () => {
      const valid = {
        ...validApiKey,
        lastUsedAt: new Date('2025-01-01T12:00:00.000Z'),
        createdAt: new Date('2025-01-01T00:00:00.000Z'),
        updatedAt: new Date('2025-01-01T00:00:00.000Z'),
      };
      const result = UserSyncApiKeySchema.safeParse(valid);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(typeof result.data.createdAt).toBe('string');
        expect(typeof result.data.updatedAt).toBe('string');
      }
    });

    it('should validate inactive API key', () => {
      const valid = { ...validApiKey, isActive: false };
      const result = UserSyncApiKeySchema.safeParse(valid);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.isActive).toBe(false);
      }
    });
  });

  // ============================================================================
  // CREATE USER SYNC API KEY SCHEMA
  // ============================================================================

  describe('CreateUserSyncApiKeySchema', () => {
    const validCreateData = {
      userId: '550e8400-e29b-41d4-a716-446655440001',
      name: 'Home Server',
      keyPrefix: '12345678',
      keyHash: '$2b$12$abcdefghijklmnopqrstuvwxyz123456789',
      isActive: true,
    };

    it('should validate valid create data', () => {
      const result = CreateUserSyncApiKeySchema.safeParse(validCreateData);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual(validCreateData);
      }
    });

    it('should apply default isActive of true', () => {
      const { isActive, ...valid } = validCreateData;
      const result = CreateUserSyncApiKeySchema.safeParse(valid);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.isActive).toBe(true);
      }
    });

    it('should fail with missing userId', () => {
      const { userId, ...invalid } = validCreateData;
      const result = CreateUserSyncApiKeySchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it('should fail with missing name', () => {
      const { name, ...invalid } = validCreateData;
      const result = CreateUserSyncApiKeySchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it('should fail with missing keyPrefix', () => {
      const { keyPrefix, ...invalid } = validCreateData;
      const result = CreateUserSyncApiKeySchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it('should fail with missing keyHash', () => {
      const { keyHash, ...invalid } = validCreateData;
      const result = CreateUserSyncApiKeySchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it('should allow explicit isActive false', () => {
      const valid = { ...validCreateData, isActive: false };
      const result = CreateUserSyncApiKeySchema.safeParse(valid);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.isActive).toBe(false);
      }
    });
  });

  // ============================================================================
  // API KEY FORMAT
  // ============================================================================

  describe('API Key Format', () => {
    it('should generate keys with correct total length', () => {
      // API key format: qt_sync_{32 hex chars} = 8 + 32 = 40 chars
      const expectedLength = API_KEY_PREFIX.length + API_KEY_RANDOM_LENGTH;
      expect(expectedLength).toBe(40);
    });

    it('should have prefix that starts with qt_sync_', () => {
      expect(API_KEY_PREFIX).toMatch(/^qt_sync_$/);
    });

    it('should have even random length for hex encoding', () => {
      // Random bytes are converted to hex, so length should be even
      expect(API_KEY_RANDOM_LENGTH % 2).toBe(0);
    });
  });
});
