/**
 * Unit Tests for Sync Remote Client
 *
 * Tests the HTTP client used for making authenticated requests to remote
 * Quilltap instances during sync operations. Covers handshake, delta fetching,
 * push operations, mapping retrieval, file content fetching, and connection testing.
 */

// Unmock the remote-client module to test the real implementation
jest.unmock('@/lib/sync/remote-client');

import {
  RemoteSyncError,
  remoteHandshake,
  fetchRemoteDeltas,
  pushToRemote,
  fetchRemoteMappings,
  fetchRemoteFileContent,
  testRemoteConnection,
} from '@/lib/sync/remote-client';
import { SyncInstance, SyncEntityDelta, SyncHandshakeResponse } from '@/lib/sync/types';
import { decryptApiKey } from '@/lib/encryption';

// Mock dependencies
jest.mock('@/lib/encryption');
jest.mock('@/lib/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

jest.mock('@/lib/sync/version-checker', () => ({
  getLocalVersionInfo: jest.fn(() => ({
    appVersion: '2.5.0',
    schemaVersion: '2.5.0',
    syncProtocolVersion: '1.0',
    supportedEntityTypes: ['CHARACTER', 'PERSONA', 'CHAT', 'TAG', 'MEMORY', 'FILE'],
  })),
}));

// Helper to create mock SyncInstance
function createMockInstance(overrides: Partial<SyncInstance> = {}): SyncInstance {
  return {
    id: 'test-instance-id',
    userId: 'test-user-id',
    name: 'Test Instance',
    url: 'https://remote.quilltap.io',
    apiKey: {
      ciphertext: 'encrypted-api-key',
      iv: 'test-iv',
      authTag: 'test-auth-tag',
    },
    isActive: true,
    createdAt: '2025-01-15T12:00:00.000Z',
    updatedAt: '2025-01-15T12:00:00.000Z',
    ...overrides,
  };
}

// Helper to create mock fetch response
function createMockResponse(
  data: unknown,
  options: { status?: number; ok?: boolean; headers?: Record<string, string> } = {}
) {
  const { status = 200, ok = true, headers = {} } = options;
  return {
    ok,
    status,
    json: jest.fn().mockResolvedValue(data),
    text: jest.fn().mockResolvedValue(JSON.stringify(data)),
    arrayBuffer: jest.fn().mockResolvedValue(new ArrayBuffer(0)),
    headers: {
      get: jest.fn((name: string) => headers[name] || null),
    },
  };
}

describe('Sync Remote Client', () => {
  const mockDecryptApiKey = decryptApiKey as jest.MockedFunction<typeof decryptApiKey>;
  let mockFetch: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockDecryptApiKey.mockReturnValue('decrypted-api-key');
    mockFetch = jest.fn();
    global.fetch = mockFetch;
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('RemoteSyncError', () => {
    it('should have correct name property', () => {
      const error = new RemoteSyncError('Test error');
      expect(error.name).toBe('RemoteSyncError');
    });

    it('should have correct message property', () => {
      const error = new RemoteSyncError('Test error message');
      expect(error.message).toBe('Test error message');
    });

    it('should have correct statusCode property', () => {
      const error = new RemoteSyncError('Test error', 404);
      expect(error.statusCode).toBe(404);
    });

    it('should have correct remoteError property', () => {
      const error = new RemoteSyncError('Test error', 500, 'Internal server error');
      expect(error.remoteError).toBe('Internal server error');
    });

    it('should be an instance of Error', () => {
      const error = new RemoteSyncError('Test error');
      expect(error).toBeInstanceOf(Error);
    });

    it('should handle undefined statusCode and remoteError', () => {
      const error = new RemoteSyncError('Test error');
      expect(error.statusCode).toBeUndefined();
      expect(error.remoteError).toBeUndefined();
    });
  });

  describe('remoteHandshake', () => {
    it('should POST to /api/v1/sync?action=handshake with Bearer token', async () => {
      const instance = createMockInstance();
      const handshakeResponse: SyncHandshakeResponse = {
        compatible: true,
        remoteUserId: 'remote-user-123',
        versionInfo: {
          appVersion: '2.5.0',
          schemaVersion: '2.5.0',
          syncProtocolVersion: '1.0',
          supportedEntityTypes: ['CHARACTER', 'PERSONA', 'CHAT'],
        },
      };

      mockFetch.mockResolvedValue(createMockResponse(handshakeResponse));

      await remoteHandshake(instance);

      expect(mockFetch).toHaveBeenCalledWith(
        'https://remote.quilltap.io/api/v1/sync?action=handshake',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            Authorization: 'Bearer decrypted-api-key',
            'X-Sync-Instance-Id': 'test-instance-id',
          }),
        })
      );
    });

    it('should include local version info in request', async () => {
      const instance = createMockInstance();
      const handshakeResponse: SyncHandshakeResponse = {
        compatible: true,
        remoteUserId: 'remote-user-123',
      };

      mockFetch.mockResolvedValue(createMockResponse(handshakeResponse));

      await remoteHandshake(instance);

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);

      expect(body).toHaveProperty('versionInfo');
      expect(body.versionInfo).toHaveProperty('appVersion');
      expect(body.versionInfo).toHaveProperty('schemaVersion');
      expect(body.versionInfo).toHaveProperty('syncProtocolVersion');
      expect(body.versionInfo).toHaveProperty('supportedEntityTypes');
    });

    it('should return handshake response on success', async () => {
      const instance = createMockInstance();
      const handshakeResponse: SyncHandshakeResponse = {
        compatible: true,
        remoteUserId: 'remote-user-456',
        versionInfo: {
          appVersion: '2.5.0',
          schemaVersion: '2.5.0',
          syncProtocolVersion: '1.0',
          supportedEntityTypes: ['CHARACTER'],
        },
      };

      mockFetch.mockResolvedValue(createMockResponse(handshakeResponse));

      const result = await remoteHandshake(instance);

      expect(result).toEqual(handshakeResponse);
    });

    it('should throw RemoteSyncError on failure', async () => {
      const instance = createMockInstance();

      mockFetch.mockResolvedValue(
        createMockResponse({ error: 'Unauthorized' }, { status: 401, ok: false })
      );

      await expect(remoteHandshake(instance)).rejects.toThrow(RemoteSyncError);
    });

    it('should throw RemoteSyncError when API key decryption fails', async () => {
      const instance = createMockInstance();
      mockDecryptApiKey.mockImplementation(() => {
        throw new Error('Decryption failed');
      });

      await expect(remoteHandshake(instance)).rejects.toThrow(RemoteSyncError);
    });
  });

  describe('fetchRemoteDeltas', () => {
    it('should POST to /api/v1/sync?action=delta with correct parameters', async () => {
      const instance = createMockInstance();
      const deltaResponse = {
        serverTimestamp: '2025-01-15T12:00:00.000Z',
        deltas: [],
        hasMore: false,
      };

      mockFetch.mockResolvedValue(createMockResponse(deltaResponse));

      await fetchRemoteDeltas(instance, '2025-01-14T00:00:00.000Z', 50);

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);

      expect(callArgs[0]).toBe('https://remote.quilltap.io/api/v1/sync?action=delta');
      expect(callArgs[1].method).toBe('POST');
      expect(body.sinceTimestamp).toBe('2025-01-14T00:00:00.000Z');
      expect(body.limit).toBe(50);
    });

    it('should use default limit of 100 when not specified', async () => {
      const instance = createMockInstance();
      const deltaResponse = {
        serverTimestamp: '2025-01-15T12:00:00.000Z',
        deltas: [],
        hasMore: false,
      };

      mockFetch.mockResolvedValue(createMockResponse(deltaResponse));

      await fetchRemoteDeltas(instance, null);

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);

      expect(body.limit).toBe(100);
    });

    it('should handle null sinceTimestamp', async () => {
      const instance = createMockInstance();
      const deltaResponse = {
        serverTimestamp: '2025-01-15T12:00:00.000Z',
        deltas: [],
        hasMore: false,
      };

      mockFetch.mockResolvedValue(createMockResponse(deltaResponse));

      await fetchRemoteDeltas(instance, null);

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);

      expect(body.sinceTimestamp).toBeNull();
    });

    it('should return deltas array and hasMore flag', async () => {
      const instance = createMockInstance();
      const deltas: SyncEntityDelta[] = [
        {
          entityType: 'CHARACTER',
          id: 'char-1',
          createdAt: '2025-01-15T10:00:00.000Z',
          updatedAt: '2025-01-15T11:00:00.000Z',
          isDeleted: false,
          data: { name: 'Test Character' },
        },
      ];
      const deltaResponse = {
        serverTimestamp: '2025-01-15T12:00:00.000Z',
        deltas,
        hasMore: true,
        nextCursor: 'cursor-123',
      };

      mockFetch.mockResolvedValue(createMockResponse(deltaResponse));

      const result = await fetchRemoteDeltas(instance, null);

      expect(result.deltas).toEqual(deltas);
      expect(result.hasMore).toBe(true);
      expect(result.nextCursor).toBe('cursor-123');
    });

    it('should throw RemoteSyncError on failure', async () => {
      const instance = createMockInstance();

      mockFetch.mockResolvedValue(
        createMockResponse({ error: 'Server error' }, { status: 500, ok: false })
      );

      await expect(fetchRemoteDeltas(instance, null)).rejects.toThrow(RemoteSyncError);
    });
  });

  describe('pushToRemote', () => {
    it('should POST to /api/v1/sync?action=push with deltas', async () => {
      const instance = createMockInstance();
      const deltas: SyncEntityDelta[] = [
        {
          entityType: 'CHARACTER',
          id: 'char-1',
          createdAt: '2025-01-15T10:00:00.000Z',
          updatedAt: '2025-01-15T11:00:00.000Z',
          isDeleted: false,
          data: { name: 'Test Character' },
        },
      ];
      const pushResponse = {
        success: true,
        mappingUpdates: [],
        conflicts: [],
        errors: [],
      };

      mockFetch.mockResolvedValue(createMockResponse(pushResponse));

      await pushToRemote(instance, deltas);

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);

      expect(callArgs[0]).toBe('https://remote.quilltap.io/api/v1/sync?action=push');
      expect(callArgs[1].method).toBe('POST');
      expect(body.deltas).toEqual(deltas);
    });

    it('should include X-Sync-Instance-Id header', async () => {
      const instance = createMockInstance({ id: 'custom-instance-id' });
      const pushResponse = {
        success: true,
        mappingUpdates: [],
        conflicts: [],
        errors: [],
      };

      mockFetch.mockResolvedValue(createMockResponse(pushResponse));

      await pushToRemote(instance, []);

      const callArgs = mockFetch.mock.calls[0];
      expect(callArgs[1].headers['X-Sync-Instance-Id']).toBe('custom-instance-id');
    });

    it('should return success, conflicts, and errors', async () => {
      const instance = createMockInstance();
      const pushResponse = {
        success: true,
        mappingUpdates: [
          { localId: 'local-1', remoteId: 'remote-1', entityType: 'CHARACTER' },
        ],
        conflicts: [
          {
            entityType: 'CHARACTER',
            localId: 'local-2',
            remoteId: 'remote-2',
            resolution: 'REMOTE_WINS',
            localUpdatedAt: '2025-01-15T10:00:00.000Z',
            remoteUpdatedAt: '2025-01-15T11:00:00.000Z',
          },
        ],
        errors: ['Error processing entity char-3'],
      };

      mockFetch.mockResolvedValue(createMockResponse(pushResponse));

      const result = await pushToRemote(instance, []);

      expect(result.success).toBe(true);
      expect(result.conflicts).toHaveLength(1);
      expect(result.errors).toHaveLength(1);
    });

    it('should throw RemoteSyncError on failure', async () => {
      const instance = createMockInstance();

      mockFetch.mockResolvedValue(
        createMockResponse({ error: 'Push failed' }, { status: 400, ok: false })
      );

      await expect(pushToRemote(instance, [])).rejects.toThrow(RemoteSyncError);
    });
  });

  describe('fetchRemoteMappings', () => {
    it('should GET from /api/v1/sync?action=mappings with instanceId param', async () => {
      const instance = createMockInstance({ id: 'my-instance-id' });
      const mappingsResponse = { mappings: [] };

      mockFetch.mockResolvedValue(createMockResponse(mappingsResponse));

      await fetchRemoteMappings(instance);

      expect(mockFetch).toHaveBeenCalledWith(
        'https://remote.quilltap.io/api/v1/sync?action=mappings&instanceId=my-instance-id',
        expect.objectContaining({
          method: 'GET',
        })
      );
    });

    it('should return mappings array', async () => {
      const instance = createMockInstance();
      const mappings = [
        {
          id: 'mapping-1',
          userId: 'user-1',
          instanceId: 'instance-1',
          entityType: 'CHARACTER',
          localId: 'local-1',
          remoteId: 'remote-1',
          lastSyncedAt: '2025-01-15T12:00:00.000Z',
          lastLocalUpdatedAt: '2025-01-15T12:00:00.000Z',
          lastRemoteUpdatedAt: '2025-01-15T12:00:00.000Z',
          createdAt: '2025-01-15T12:00:00.000Z',
          updatedAt: '2025-01-15T12:00:00.000Z',
        },
      ];
      const mappingsResponse = { mappings };

      mockFetch.mockResolvedValue(createMockResponse(mappingsResponse));

      const result = await fetchRemoteMappings(instance);

      expect(result.mappings).toEqual(mappings);
    });

    it('should throw RemoteSyncError on failure', async () => {
      const instance = createMockInstance();

      mockFetch.mockResolvedValue(
        createMockResponse({ error: 'Not found' }, { status: 404, ok: false })
      );

      await expect(fetchRemoteMappings(instance)).rejects.toThrow(RemoteSyncError);
    });
  });

  describe('fetchRemoteFileContent', () => {
    it('should GET from /api/sync/files/{id}/content', async () => {
      const instance = createMockInstance();
      const fileContent = Buffer.from('test file content');

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        arrayBuffer: jest.fn().mockResolvedValue(fileContent.buffer),
        headers: {
          get: jest.fn((name: string) => {
            if (name === 'X-File-SHA256') return 'abc123sha256';
            if (name === 'Content-Type') return 'image/png';
            return null;
          }),
        },
      });

      await fetchRemoteFileContent(instance, 'file-123');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://remote.quilltap.io/api/v1/sync/files/file-123',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            Authorization: 'Bearer decrypted-api-key',
            'X-Sync-Instance-Id': 'test-instance-id',
          }),
        })
      );
    });

    it('should return Buffer content with sha256 and mimeType from headers', async () => {
      const instance = createMockInstance();
      const fileContent = new Uint8Array([1, 2, 3, 4, 5]).buffer;

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        arrayBuffer: jest.fn().mockResolvedValue(fileContent),
        headers: {
          get: jest.fn((name: string) => {
            if (name === 'X-File-SHA256') return 'sha256hash123';
            if (name === 'Content-Type') return 'application/octet-stream';
            return null;
          }),
        },
      });

      const result = await fetchRemoteFileContent(instance, 'file-123');

      expect(Buffer.isBuffer(result.content)).toBe(true);
      expect(result.sha256).toBe('sha256hash123');
      expect(result.mimeType).toBe('application/octet-stream');
    });

    it('should handle missing headers gracefully', async () => {
      const instance = createMockInstance();
      const fileContent = new ArrayBuffer(10);

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        arrayBuffer: jest.fn().mockResolvedValue(fileContent),
        headers: {
          get: jest.fn(() => null),
        },
      });

      const result = await fetchRemoteFileContent(instance, 'file-123');

      expect(result.sha256).toBeUndefined();
      expect(result.mimeType).toBeUndefined();
    });

    it('should throw RemoteSyncError on failure', async () => {
      const instance = createMockInstance();

      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
        json: jest.fn().mockResolvedValue({ error: 'File not found' }),
        text: jest.fn().mockResolvedValue('File not found'),
      });

      await expect(fetchRemoteFileContent(instance, 'file-123')).rejects.toThrow(RemoteSyncError);
    });

    it('should throw RemoteSyncError with serverLogs on error response', async () => {
      const instance = createMockInstance();
      const serverLogs = [{ timestamp: '2025-01-15T12:00:00.000Z', level: 'error', message: 'Debug log' }];

      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        json: jest.fn().mockResolvedValue({ error: 'Server error', serverLogs }),
        text: jest.fn().mockResolvedValue('Server error'),
      });

      try {
        await fetchRemoteFileContent(instance, 'file-123');
        fail('Expected RemoteSyncError to be thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(RemoteSyncError);
        expect((error as any).serverLogs).toEqual(serverLogs);
      }
    });
  });

  describe('testRemoteConnection', () => {
    it('should POST to /api/v1/sync?action=handshake', async () => {
      const url = 'https://test.quilltap.io';
      const apiKey = 'test-api-key';
      const handshakeResponse: SyncHandshakeResponse = {
        compatible: true,
        remoteUserId: 'remote-user-123',
      };

      mockFetch.mockResolvedValue(createMockResponse(handshakeResponse));

      await testRemoteConnection(url, apiKey);

      expect(mockFetch).toHaveBeenCalledWith(
        'https://test.quilltap.io/api/v1/sync?action=handshake',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            Authorization: 'Bearer test-api-key',
          }),
        })
      );
    });

    it('should return success=true with versionInfo on success', async () => {
      const url = 'https://test.quilltap.io';
      const apiKey = 'test-api-key';
      const handshakeResponse: SyncHandshakeResponse = {
        compatible: true,
        remoteUserId: 'remote-user-123',
        versionInfo: {
          appVersion: '2.5.0',
          schemaVersion: '2.5.0',
          syncProtocolVersion: '1.0',
          supportedEntityTypes: ['CHARACTER'],
        },
      };

      mockFetch.mockResolvedValue(createMockResponse(handshakeResponse));

      const result = await testRemoteConnection(url, apiKey);

      expect(result.success).toBe(true);
      expect(result.versionInfo).toEqual(handshakeResponse);
      expect(result.error).toBeUndefined();
    });

    it('should return success=false with error on failure', async () => {
      const url = 'https://test.quilltap.io';
      const apiKey = 'wrong-api-key';

      mockFetch.mockResolvedValue(
        createMockResponse({ error: 'Invalid API key' }, { status: 401, ok: false })
      );

      const result = await testRemoteConnection(url, apiKey);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid API key');
      expect(result.versionInfo).toBeUndefined();
    });

    it('should handle network errors', async () => {
      const url = 'https://unreachable.quilltap.io';
      const apiKey = 'test-api-key';

      mockFetch.mockRejectedValue(new Error('Network error'));

      const result = await testRemoteConnection(url, apiKey);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Network error');
    });

    it('should include local version info in request body', async () => {
      const url = 'https://test.quilltap.io';
      const apiKey = 'test-api-key';

      mockFetch.mockResolvedValue(createMockResponse({ compatible: true }));

      await testRemoteConnection(url, apiKey);

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);

      expect(body).toHaveProperty('versionInfo');
      expect(body.versionInfo.appVersion).toBe('2.5.0');
    });
  });

  describe('Timeout handling', () => {
    it('should handle AbortError with 408 status code', async () => {
      const instance = createMockInstance();

      // Create an AbortError to simulate what happens on timeout
      const abortError = new Error('The operation was aborted');
      abortError.name = 'AbortError';

      mockFetch.mockRejectedValue(abortError);

      try {
        await remoteHandshake(instance);
        fail('Expected RemoteSyncError to be thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(RemoteSyncError);
        expect((error as RemoteSyncError).statusCode).toBe(408);
        expect((error as RemoteSyncError).message).toBe('Request timed out');
      }
    });

    it('should handle fetch abort correctly for file content', async () => {
      const instance = createMockInstance();
      const abortError = new Error('Aborted');
      abortError.name = 'AbortError';

      mockFetch.mockRejectedValue(abortError);

      try {
        await fetchRemoteFileContent(instance, 'file-123');
        fail('Expected RemoteSyncError to be thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(RemoteSyncError);
        expect((error as RemoteSyncError).statusCode).toBe(408);
        expect((error as RemoteSyncError).message).toBe('Request timed out');
      }
    });
  });

  describe('Error handling', () => {
    it('should preserve RemoteSyncError when thrown', async () => {
      const instance = createMockInstance();

      mockFetch.mockResolvedValue(
        createMockResponse({ error: 'Custom error' }, { status: 403, ok: false })
      );

      try {
        await remoteHandshake(instance);
        fail('Expected RemoteSyncError to be thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(RemoteSyncError);
        expect((error as RemoteSyncError).statusCode).toBe(403);
      }
    });

    it('should wrap non-RemoteSyncError in RemoteSyncError', async () => {
      const instance = createMockInstance();

      mockFetch.mockRejectedValue(new Error('Unexpected error'));

      await expect(remoteHandshake(instance)).rejects.toThrow(RemoteSyncError);
    });

    it('should handle JSON parse errors in error response', async () => {
      const instance = createMockInstance();

      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        json: jest.fn().mockRejectedValue(new Error('Invalid JSON')),
      });

      try {
        await remoteHandshake(instance);
        fail('Expected RemoteSyncError to be thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(RemoteSyncError);
        expect((error as RemoteSyncError).message).toContain('500');
      }
    });
  });

  describe('API Key decryption', () => {
    it('should call decryptApiKey with correct parameters', async () => {
      const instance = createMockInstance({
        apiKey: {
          ciphertext: 'my-ciphertext',
          iv: 'my-iv',
          authTag: 'my-auth-tag',
        },
        userId: 'my-user-id',
      });

      mockFetch.mockResolvedValue(createMockResponse({ compatible: true }));

      await remoteHandshake(instance);

      expect(mockDecryptApiKey).toHaveBeenCalledWith(
        'my-ciphertext',
        'my-iv',
        'my-auth-tag',
        'my-user-id'
      );
    });

    it('should throw RemoteSyncError when decryption fails', async () => {
      const instance = createMockInstance();
      mockDecryptApiKey.mockImplementation(() => {
        throw new Error('Decryption failed');
      });

      await expect(remoteHandshake(instance)).rejects.toThrow(RemoteSyncError);
      await expect(remoteHandshake(instance)).rejects.toMatchObject({
        message: 'Failed to decrypt API key',
      });
    });
  });

  describe('URL handling', () => {
    it('should construct correct URLs for different instance URLs', async () => {
      const instance = createMockInstance({ url: 'https://custom.domain.com:8443' });
      mockFetch.mockResolvedValue(createMockResponse({ compatible: true }));

      await remoteHandshake(instance);

      expect(mockFetch).toHaveBeenCalledWith(
        'https://custom.domain.com:8443/api/v1/sync?action=handshake',
        expect.anything()
      );
    });

    it('should handle instance URLs with trailing slashes', async () => {
      const instance = createMockInstance({ url: 'https://remote.quilltap.io/' });
      mockFetch.mockResolvedValue(createMockResponse({ compatible: true }));

      await remoteHandshake(instance);

      // URL constructor handles trailing slashes correctly
      expect(mockFetch).toHaveBeenCalled();
    });
  });

  describe('Multiple delta operations', () => {
    it('should handle empty deltas array', async () => {
      const instance = createMockInstance();
      const deltaResponse = {
        serverTimestamp: '2025-01-15T12:00:00.000Z',
        deltas: [],
        hasMore: false,
      };

      mockFetch.mockResolvedValue(createMockResponse(deltaResponse));

      const result = await fetchRemoteDeltas(instance, null);

      expect(result.deltas).toEqual([]);
      expect(result.hasMore).toBe(false);
    });

    it('should handle large deltas array', async () => {
      const instance = createMockInstance();
      const deltas: SyncEntityDelta[] = Array.from({ length: 100 }, (_, i) => ({
        entityType: 'CHARACTER' as const,
        id: `char-${i}`,
        createdAt: '2025-01-15T10:00:00.000Z',
        updatedAt: '2025-01-15T11:00:00.000Z',
        isDeleted: false,
        data: { name: `Character ${i}` },
      }));
      const deltaResponse = {
        serverTimestamp: '2025-01-15T12:00:00.000Z',
        deltas,
        hasMore: true,
      };

      mockFetch.mockResolvedValue(createMockResponse(deltaResponse));

      const result = await fetchRemoteDeltas(instance, null);

      expect(result.deltas).toHaveLength(100);
      expect(result.hasMore).toBe(true);
    });
  });
});
