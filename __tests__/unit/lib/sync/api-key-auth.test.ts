/**
 * Unit Tests for Sync API Key Authentication
 *
 * Tests the authentication utilities used for sync requests.
 * Covers API key validation, Bearer token extraction, and dual auth (session/API key).
 */

import { NextRequest } from 'next/server';
import { getRepositories } from '@/lib/repositories/factory';
import { API_KEY_PREFIX } from '@/lib/sync/user-api-keys';
import {
  validateApiKey,
  authenticateSyncRequest,
  getAuthenticatedUserForSync,
} from '@/lib/sync/api-key-auth';

// Mock dependencies
jest.mock('@/lib/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

// Get mock functions from the already-mocked module (see jest.setup.ts)
const mockGetRepositories = getRepositories as jest.MockedFunction<typeof getRepositories>;

describe('Sync API Key Authentication', () => {
  // Test data
  const validApiKeyId = '550e8400-e29b-41d4-a716-446655440000';
  const validUserId = '550e8400-e29b-41d4-a716-446655440001';
  const validKeyPrefix = 'abcd1234';
  const validPlaintextKey = `${API_KEY_PREFIX}${validKeyPrefix}5678901234567890123456789012`;

  // Mock repository functions
  let mockFindAllActive: jest.Mock;
  let mockVerifyApiKey: jest.Mock;
  let mockUpdateLastUsed: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();

    mockFindAllActive = jest.fn();
    mockVerifyApiKey = jest.fn();
    mockUpdateLastUsed = jest.fn();

    mockGetRepositories.mockReturnValue({
      userSyncApiKeys: {
        findAllActive: mockFindAllActive,
        verifyApiKey: mockVerifyApiKey,
        updateLastUsed: mockUpdateLastUsed,
      },
    } as any);
  });

  // ============================================================================
  // API_KEY_PREFIX CONSTANT
  // ============================================================================

  describe('API_KEY_PREFIX constant', () => {
    it('should have the expected prefix value', () => {
      expect(API_KEY_PREFIX).toBe('qt_sync_');
    });
  });

  // ============================================================================
  // validateApiKey
  // ============================================================================

  describe('validateApiKey', () => {
    describe('key format validation', () => {
      it('should reject keys not starting with qt_sync_ prefix', async () => {
        const result = await validateApiKey('invalid_prefix_key12345678901234567890');

        expect(result.authenticated).toBe(false);
        expect(result.error).toBe('Invalid API key format');
        expect(result.userId).toBeUndefined();
        expect(result.keyId).toBeUndefined();
      });

      it('should reject keys with partial prefix', async () => {
        const result = await validateApiKey('qt_syn_key12345678901234567890');

        expect(result.authenticated).toBe(false);
        expect(result.error).toBe('Invalid API key format');
      });

      it('should reject empty keys', async () => {
        const result = await validateApiKey('');

        expect(result.authenticated).toBe(false);
        expect(result.error).toBe('Invalid API key format');
      });

      it('should reject keys with only the prefix', async () => {
        const result = await validateApiKey('qt_sync_');

        // The function first checks format (starts with prefix) - this passes
        // Then tries to validate against active keys
        mockFindAllActive.mockResolvedValue([]);

        const result2 = await validateApiKey('qt_sync_');
        expect(result2.authenticated).toBe(false);
      });
    });

    describe('valid key format but key not found', () => {
      it('should return authenticated=false when no active keys exist', async () => {
        mockFindAllActive.mockResolvedValue([]);

        const result = await validateApiKey(validPlaintextKey);

        expect(result.authenticated).toBe(false);
        expect(result.error).toBe('Invalid or inactive API key');
        expect(result.userId).toBeUndefined();
        expect(result.keyId).toBeUndefined();
      });

      it('should return authenticated=false when key does not match any active key', async () => {
        mockFindAllActive.mockResolvedValue([
          {
            id: validApiKeyId,
            userId: validUserId,
            keyPrefix: validKeyPrefix,
            keyHash: 'some-hash',
            isActive: true,
          },
        ]);
        mockVerifyApiKey.mockResolvedValue(false);

        const result = await validateApiKey(validPlaintextKey);

        expect(result.authenticated).toBe(false);
        expect(result.error).toBe('Invalid or inactive API key');
      });
    });

    describe('successful validation', () => {
      it('should return authenticated=true with userId and keyId when key is valid', async () => {
        mockFindAllActive.mockResolvedValue([
          {
            id: validApiKeyId,
            userId: validUserId,
            keyPrefix: validKeyPrefix,
            keyHash: 'hashed-key',
            isActive: true,
          },
        ]);
        mockVerifyApiKey.mockResolvedValue(true);
        mockUpdateLastUsed.mockResolvedValue(undefined);

        const result = await validateApiKey(validPlaintextKey);

        expect(result.authenticated).toBe(true);
        expect(result.userId).toBe(validUserId);
        expect(result.keyId).toBe(validApiKeyId);
        expect(result.error).toBeUndefined();
      });

      it('should call updateLastUsed on successful validation', async () => {
        mockFindAllActive.mockResolvedValue([
          {
            id: validApiKeyId,
            userId: validUserId,
            keyPrefix: validKeyPrefix,
            keyHash: 'hashed-key',
            isActive: true,
          },
        ]);
        mockVerifyApiKey.mockResolvedValue(true);
        mockUpdateLastUsed.mockResolvedValue(undefined);

        await validateApiKey(validPlaintextKey);

        // Allow the async fire-and-forget to complete
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(mockUpdateLastUsed).toHaveBeenCalledWith(validApiKeyId);
      });

      it('should match the correct key among multiple active keys', async () => {
        const otherKeyId = '550e8400-e29b-41d4-a716-446655440002';
        const otherUserId = '550e8400-e29b-41d4-a716-446655440003';

        mockFindAllActive.mockResolvedValue([
          {
            id: otherKeyId,
            userId: otherUserId,
            keyPrefix: 'other123',
            keyHash: 'other-hash',
            isActive: true,
          },
          {
            id: validApiKeyId,
            userId: validUserId,
            keyPrefix: validKeyPrefix,
            keyHash: 'valid-hash',
            isActive: true,
          },
        ]);
        // First key doesn't match, second does
        mockVerifyApiKey.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
        mockUpdateLastUsed.mockResolvedValue(undefined);

        const result = await validateApiKey(validPlaintextKey);

        expect(result.authenticated).toBe(true);
        expect(result.userId).toBe(validUserId);
        expect(result.keyId).toBe(validApiKeyId);
        expect(mockVerifyApiKey).toHaveBeenCalledTimes(2);
      });
    });

    describe('database error handling', () => {
      it('should handle database errors gracefully when fetching active keys', async () => {
        mockFindAllActive.mockRejectedValue(new Error('Database connection failed'));

        const result = await validateApiKey(validPlaintextKey);

        expect(result.authenticated).toBe(false);
        expect(result.error).toBe('Authentication error');
      });

      it('should handle database errors gracefully when verifying key', async () => {
        mockFindAllActive.mockResolvedValue([
          {
            id: validApiKeyId,
            userId: validUserId,
            keyPrefix: validKeyPrefix,
            keyHash: 'hashed-key',
            isActive: true,
          },
        ]);
        mockVerifyApiKey.mockRejectedValue(new Error('Hash verification failed'));

        const result = await validateApiKey(validPlaintextKey);

        expect(result.authenticated).toBe(false);
        expect(result.error).toBe('Authentication error');
      });

      it('should not fail validation when updateLastUsed fails', async () => {
        mockFindAllActive.mockResolvedValue([
          {
            id: validApiKeyId,
            userId: validUserId,
            keyPrefix: validKeyPrefix,
            keyHash: 'hashed-key',
            isActive: true,
          },
        ]);
        mockVerifyApiKey.mockResolvedValue(true);
        mockUpdateLastUsed.mockRejectedValue(new Error('Update failed'));

        const result = await validateApiKey(validPlaintextKey);

        // Validation should still succeed even if updateLastUsed fails
        expect(result.authenticated).toBe(true);
        expect(result.userId).toBe(validUserId);
      });
    });
  });

  // ============================================================================
  // authenticateSyncRequest
  // ============================================================================

  describe('authenticateSyncRequest', () => {
    /**
     * Helper to create a mock NextRequest with optional Authorization header
     */
    function createMockRequest(authHeader?: string): NextRequest {
      const headers = new Headers();
      if (authHeader !== undefined) {
        headers.set('Authorization', authHeader);
      }
      return {
        headers: {
          get: (name: string) => headers.get(name),
        },
      } as unknown as NextRequest;
    }

    describe('no Authorization header', () => {
      it('should return error when no Authorization header is present', async () => {
        const request = createMockRequest();

        const result = await authenticateSyncRequest(request);

        expect(result.authenticated).toBe(false);
        expect(result.error).toBe('No Bearer token provided');
      });
    });

    describe('invalid Authorization header format', () => {
      it('should return error when header is not Bearer type', async () => {
        const request = createMockRequest('Basic dXNlcjpwYXNz');

        const result = await authenticateSyncRequest(request);

        expect(result.authenticated).toBe(false);
        expect(result.error).toBe('No Bearer token provided');
      });

      it('should return error when header is "Bearer" without a space', async () => {
        const request = createMockRequest('BearerToken123');

        const result = await authenticateSyncRequest(request);

        expect(result.authenticated).toBe(false);
        expect(result.error).toBe('No Bearer token provided');
      });

      it('should return error when Bearer token is empty', async () => {
        const request = createMockRequest('Bearer ');

        const result = await authenticateSyncRequest(request);

        expect(result.authenticated).toBe(false);
        expect(result.error).toBe('No Bearer token provided');
      });

      it('should return error when Bearer token is only whitespace', async () => {
        const request = createMockRequest('Bearer    ');

        const result = await authenticateSyncRequest(request);

        expect(result.authenticated).toBe(false);
        expect(result.error).toBe('No Bearer token provided');
      });
    });

    describe('valid Bearer token format', () => {
      it('should call validateApiKey with extracted token', async () => {
        mockFindAllActive.mockResolvedValue([]);
        const request = createMockRequest(`Bearer ${validPlaintextKey}`);

        const result = await authenticateSyncRequest(request);

        // validateApiKey is called internally
        expect(mockGetRepositories).toHaveBeenCalled();
        expect(result.authenticated).toBe(false);
        expect(result.error).toBe('Invalid or inactive API key');
      });

      it('should return successful auth result for valid Bearer token', async () => {
        mockFindAllActive.mockResolvedValue([
          {
            id: validApiKeyId,
            userId: validUserId,
            keyPrefix: validKeyPrefix,
            keyHash: 'hashed-key',
            isActive: true,
          },
        ]);
        mockVerifyApiKey.mockResolvedValue(true);
        mockUpdateLastUsed.mockResolvedValue(undefined);

        const request = createMockRequest(`Bearer ${validPlaintextKey}`);

        const result = await authenticateSyncRequest(request);

        expect(result.authenticated).toBe(true);
        expect(result.userId).toBe(validUserId);
        expect(result.keyId).toBe(validApiKeyId);
      });

      it('should trim whitespace from Bearer token', async () => {
        mockFindAllActive.mockResolvedValue([
          {
            id: validApiKeyId,
            userId: validUserId,
            keyPrefix: validKeyPrefix,
            keyHash: 'hashed-key',
            isActive: true,
          },
        ]);
        mockVerifyApiKey.mockResolvedValue(true);
        mockUpdateLastUsed.mockResolvedValue(undefined);

        const request = createMockRequest(`Bearer   ${validPlaintextKey}  `);

        const result = await authenticateSyncRequest(request);

        expect(result.authenticated).toBe(true);
      });
    });
  });

  // ============================================================================
  // getAuthenticatedUserForSync
  // ============================================================================

  describe('getAuthenticatedUserForSync', () => {
    /**
     * Helper to create a mock NextRequest with optional Authorization header
     */
    function createMockRequest(authHeader?: string): NextRequest {
      const headers = new Headers();
      if (authHeader !== undefined) {
        headers.set('Authorization', authHeader);
      }
      return {
        headers: {
          get: (name: string) => headers.get(name),
        },
      } as unknown as NextRequest;
    }

    describe('session authentication', () => {
      it('should return session auth when sessionUserId is provided', async () => {
        const sessionUserId = '550e8400-e29b-41d4-a716-446655440005';
        const request = createMockRequest();

        const result = await getAuthenticatedUserForSync(request, sessionUserId);

        expect(result.userId).toBe(sessionUserId);
        expect(result.authMethod).toBe('session');
        expect(result.keyId).toBeUndefined();
      });

      it('should prioritize session auth over API key auth', async () => {
        const sessionUserId = '550e8400-e29b-41d4-a716-446655440005';

        // Set up valid API key auth
        mockFindAllActive.mockResolvedValue([
          {
            id: validApiKeyId,
            userId: validUserId,
            keyPrefix: validKeyPrefix,
            keyHash: 'hashed-key',
            isActive: true,
          },
        ]);
        mockVerifyApiKey.mockResolvedValue(true);
        mockUpdateLastUsed.mockResolvedValue(undefined);

        const request = createMockRequest(`Bearer ${validPlaintextKey}`);

        const result = await getAuthenticatedUserForSync(request, sessionUserId);

        // Should use session auth, not API key auth
        expect(result.userId).toBe(sessionUserId);
        expect(result.authMethod).toBe('session');
        expect(result.keyId).toBeUndefined();

        // API key validation should not be called
        expect(mockFindAllActive).not.toHaveBeenCalled();
      });
    });

    describe('API key authentication fallback', () => {
      it('should fall back to API key auth when no session', async () => {
        mockFindAllActive.mockResolvedValue([
          {
            id: validApiKeyId,
            userId: validUserId,
            keyPrefix: validKeyPrefix,
            keyHash: 'hashed-key',
            isActive: true,
          },
        ]);
        mockVerifyApiKey.mockResolvedValue(true);
        mockUpdateLastUsed.mockResolvedValue(undefined);

        const request = createMockRequest(`Bearer ${validPlaintextKey}`);

        const result = await getAuthenticatedUserForSync(request, null);

        expect(result.userId).toBe(validUserId);
        expect(result.authMethod).toBe('api_key');
        expect(result.keyId).toBe(validApiKeyId);
      });

      it('should return keyId when authenticated via API key', async () => {
        mockFindAllActive.mockResolvedValue([
          {
            id: validApiKeyId,
            userId: validUserId,
            keyPrefix: validKeyPrefix,
            keyHash: 'hashed-key',
            isActive: true,
          },
        ]);
        mockVerifyApiKey.mockResolvedValue(true);
        mockUpdateLastUsed.mockResolvedValue(undefined);

        const request = createMockRequest(`Bearer ${validPlaintextKey}`);

        const result = await getAuthenticatedUserForSync(request, null);

        expect(result.keyId).toBe(validApiKeyId);
      });
    });

    describe('authentication failure', () => {
      it('should return null userId when both session and API key auth fail', async () => {
        mockFindAllActive.mockResolvedValue([]);
        const request = createMockRequest(`Bearer invalid_key`);

        const result = await getAuthenticatedUserForSync(request, null);

        expect(result.userId).toBeNull();
        expect(result.authMethod).toBeNull();
        expect(result.keyId).toBeUndefined();
      });

      it('should return null userId when no session and no Authorization header', async () => {
        const request = createMockRequest();

        const result = await getAuthenticatedUserForSync(request, null);

        expect(result.userId).toBeNull();
        expect(result.authMethod).toBeNull();
      });

      it('should return null userId when no session and invalid API key', async () => {
        mockFindAllActive.mockResolvedValue([
          {
            id: validApiKeyId,
            userId: validUserId,
            keyPrefix: validKeyPrefix,
            keyHash: 'hashed-key',
            isActive: true,
          },
        ]);
        mockVerifyApiKey.mockResolvedValue(false);

        const request = createMockRequest(`Bearer ${validPlaintextKey}`);

        const result = await getAuthenticatedUserForSync(request, null);

        expect(result.userId).toBeNull();
        expect(result.authMethod).toBeNull();
      });
    });
  });

  // ============================================================================
  // Integration scenarios
  // ============================================================================

  describe('Integration scenarios', () => {
    /**
     * Helper to create a mock NextRequest with optional Authorization header
     */
    function createMockRequest(authHeader?: string): NextRequest {
      const headers = new Headers();
      if (authHeader !== undefined) {
        headers.set('Authorization', authHeader);
      }
      return {
        headers: {
          get: (name: string) => headers.get(name),
        },
      } as unknown as NextRequest;
    }

    it('should handle full API key authentication flow', async () => {
      // Simulate a complete authentication flow from request to validated user
      mockFindAllActive.mockResolvedValue([
        {
          id: validApiKeyId,
          userId: validUserId,
          name: 'Home Server',
          keyPrefix: validKeyPrefix,
          keyHash: 'bcrypt-hash-here',
          isActive: true,
          createdAt: '2025-01-01T00:00:00.000Z',
          updatedAt: '2025-01-01T00:00:00.000Z',
        },
      ]);
      mockVerifyApiKey.mockResolvedValue(true);
      mockUpdateLastUsed.mockResolvedValue(undefined);

      const request = createMockRequest(`Bearer ${validPlaintextKey}`);

      // Step 1: Authenticate the request
      const authResult = await authenticateSyncRequest(request);
      expect(authResult.authenticated).toBe(true);

      // Step 2: Get authenticated user for sync
      const userResult = await getAuthenticatedUserForSync(request, null);
      expect(userResult.userId).toBe(validUserId);
      expect(userResult.authMethod).toBe('api_key');
    });

    it('should handle session fallback to API key flow', async () => {
      mockFindAllActive.mockResolvedValue([
        {
          id: validApiKeyId,
          userId: validUserId,
          keyPrefix: validKeyPrefix,
          keyHash: 'hashed-key',
          isActive: true,
        },
      ]);
      mockVerifyApiKey.mockResolvedValue(true);
      mockUpdateLastUsed.mockResolvedValue(undefined);

      const request = createMockRequest(`Bearer ${validPlaintextKey}`);

      // With session - uses session
      const withSession = await getAuthenticatedUserForSync(request, 'session-user-id');
      expect(withSession.authMethod).toBe('session');
      expect(withSession.userId).toBe('session-user-id');

      // Without session - falls back to API key
      const withoutSession = await getAuthenticatedUserForSync(request, null);
      expect(withoutSession.authMethod).toBe('api_key');
      expect(withoutSession.userId).toBe(validUserId);
    });

    it('should handle expired/revoked API keys', async () => {
      // First the key exists and is active
      mockFindAllActive.mockResolvedValueOnce([
        {
          id: validApiKeyId,
          userId: validUserId,
          keyPrefix: validKeyPrefix,
          keyHash: 'hashed-key',
          isActive: true,
        },
      ]);
      mockVerifyApiKey.mockResolvedValueOnce(true);
      mockUpdateLastUsed.mockResolvedValue(undefined);

      const request = createMockRequest(`Bearer ${validPlaintextKey}`);

      const firstResult = await getAuthenticatedUserForSync(request, null);
      expect(firstResult.authMethod).toBe('api_key');
      expect(firstResult.userId).toBe(validUserId);

      // Then the key is revoked (no longer in active keys)
      mockFindAllActive.mockResolvedValueOnce([]);

      const secondResult = await getAuthenticatedUserForSync(request, null);
      expect(secondResult.authMethod).toBeNull();
      expect(secondResult.userId).toBeNull();
    });
  });
});
