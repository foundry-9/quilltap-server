/**
 * Unit Tests for Sync Service
 *
 * Tests the core sync service functionality including:
 * - Applying remote deltas to local database
 * - Processing multiple remote deltas
 * - Preparing local deltas for push
 * - Sync operation lifecycle (start/complete)
 * - Cleaning sync data
 */

// Unmock the sync-service module to test the real implementation
jest.unmock('@/lib/sync/sync-service');

import {
  applyRemoteDelta,
  processRemoteDeltas,
  prepareLocalDeltasForPush,
  startSyncOperation,
  completeSyncOperation,
  cleanSyncData,
  FileNeedingContent,
} from '@/lib/sync/sync-service';
import { SyncEntityDelta, SyncConflict, SyncableEntityType, SyncOperation } from '@/lib/sync/types';
import { getRepositories } from '@/lib/mongodb/repositories';
import { s3FileService } from '@/lib/s3/file-service';
import { resolveConflictWithRecord } from '@/lib/sync/conflict-resolver';
import { detectDeltas } from '@/lib/sync/delta-detector';

// Mock dependencies
jest.mock('@/lib/mongodb/repositories');
jest.mock('@/lib/s3/file-service');
jest.mock('@/lib/sync/conflict-resolver');
jest.mock('@/lib/sync/delta-detector');

// Create a comprehensive logger mock that includes child method
jest.mock('@/lib/logger', () => {
  const mockLogger = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    child: jest.fn().mockReturnValue({
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      child: jest.fn().mockReturnThis(),
    }),
  };
  return { logger: mockLogger };
});

const mockedGetRepositories = getRepositories as jest.MockedFunction<typeof getRepositories>;
const mockedS3FileService = s3FileService as jest.Mocked<typeof s3FileService>;
const mockedResolveConflictWithRecord = resolveConflictWithRecord as jest.MockedFunction<
  typeof resolveConflictWithRecord
>;
const mockedDetectDeltas = detectDeltas as jest.MockedFunction<typeof detectDeltas>;

describe('Sync Service', () => {
  const userId = 'user-123';
  const instanceId = 'instance-456';
  const now = new Date('2025-01-15T12:00:00.000Z');
  const earlier = new Date('2025-01-15T11:00:00.000Z');
  const later = new Date('2025-01-15T13:00:00.000Z');

  // Mock repositories
  let mockRepos: {
    tags: any;
    files: any;
    projects: any;
    connections: any;
    personas: any;
    characters: any;
    roleplayTemplates: any;
    promptTemplates: any;
    chats: any;
    memories: any;
    syncMappings: any;
    syncOperations: any;
    syncInstances: any;
  };

  beforeEach(() => {
    jest.clearAllMocks();

    // Initialize mock repositories with all required methods
    mockRepos = {
      tags: {
        findById: jest.fn(),
        createOrUpdate: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      files: {
        findById: jest.fn(),
        createOrUpdate: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      projects: {
        findById: jest.fn(),
        createOrUpdate: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      connections: {
        findById: jest.fn(),
        createOrUpdate: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      personas: {
        findById: jest.fn(),
        createOrUpdate: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      characters: {
        findById: jest.fn(),
        createOrUpdate: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      roleplayTemplates: {
        findById: jest.fn(),
        createOrUpdate: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      promptTemplates: {
        findById: jest.fn(),
        createOrUpdate: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      chats: {
        findById: jest.fn(),
        createOrUpdate: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
        addMessages: jest.fn(),
        clearMessages: jest.fn(),
      },
      memories: {
        findById: jest.fn(),
        createOrUpdate: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      syncMappings: {
        deleteByUserId: jest.fn(),
      },
      syncOperations: {
        create: jest.fn(),
        complete: jest.fn(),
        deleteByUserId: jest.fn(),
      },
      syncInstances: {
        findByUserId: jest.fn(),
        update: jest.fn(),
      },
    };

    mockedGetRepositories.mockReturnValue(mockRepos as any);
  });

  describe('applyRemoteDelta', () => {
    describe('creating new entities', () => {
      it('should create new entity when it does not exist locally', async () => {
        const delta: SyncEntityDelta = {
          entityType: 'CHARACTER',
          id: 'char-1',
          createdAt: earlier.toISOString(),
          updatedAt: now.toISOString(),
          isDeleted: false,
          data: {
            name: 'Test Character',
            description: 'A test character',
          },
        };

        mockRepos.characters.findById.mockResolvedValue(null);
        mockRepos.characters.createOrUpdate.mockResolvedValue({
          id: 'char-1',
          updatedAt: now.toISOString(),
        });

        const result = await applyRemoteDelta(userId, instanceId, delta);

        expect(result.success).toBe(true);
        expect(result.isNewEntity).toBe(true);
        expect(mockRepos.characters.createOrUpdate).toHaveBeenCalledWith(
          'char-1',
          expect.objectContaining({ name: 'Test Character', userId }),
          { createdAt: earlier.toISOString() }
        );
      });

      it('should preserve remote ID and createdAt when creating entity', async () => {
        const originalCreatedAt = '2025-01-01T00:00:00.000Z';
        const delta: SyncEntityDelta = {
          entityType: 'PERSONA',
          id: 'persona-original-id',
          createdAt: originalCreatedAt,
          updatedAt: now.toISOString(),
          isDeleted: false,
          data: {
            name: 'Test Persona',
          },
        };

        mockRepos.personas.findById.mockResolvedValue(null);
        mockRepos.personas.createOrUpdate.mockResolvedValue({
          id: 'persona-original-id',
          updatedAt: now.toISOString(),
        });

        const result = await applyRemoteDelta(userId, instanceId, delta);

        expect(result.success).toBe(true);
        expect(mockRepos.personas.createOrUpdate).toHaveBeenCalledWith(
          'persona-original-id',
          expect.any(Object),
          { createdAt: originalCreatedAt }
        );
      });

      it('should create TAG entity successfully', async () => {
        const delta: SyncEntityDelta = {
          entityType: 'TAG',
          id: 'tag-1',
          createdAt: earlier.toISOString(),
          updatedAt: now.toISOString(),
          isDeleted: false,
          data: { name: 'Test Tag', color: '#FF0000' },
        };

        mockRepos.tags.findById.mockResolvedValue(null);
        mockRepos.tags.createOrUpdate.mockResolvedValue({ id: 'tag-1', updatedAt: now.toISOString() });

        const result = await applyRemoteDelta(userId, instanceId, delta);

        expect(result.success).toBe(true);
        expect(result.isNewEntity).toBe(true);
      });

      it('should create ROLEPLAY_TEMPLATE entity successfully', async () => {
        const delta: SyncEntityDelta = {
          entityType: 'ROLEPLAY_TEMPLATE',
          id: 'rp-1',
          createdAt: earlier.toISOString(),
          updatedAt: now.toISOString(),
          isDeleted: false,
          data: { name: 'Test Template', content: 'Template content' },
        };

        mockRepos.roleplayTemplates.findById.mockResolvedValue(null);
        mockRepos.roleplayTemplates.createOrUpdate.mockResolvedValue({
          id: 'rp-1',
          updatedAt: now.toISOString(),
        });

        const result = await applyRemoteDelta(userId, instanceId, delta);

        expect(result.success).toBe(true);
        expect(result.isNewEntity).toBe(true);
      });

      it('should create PROMPT_TEMPLATE entity successfully', async () => {
        const delta: SyncEntityDelta = {
          entityType: 'PROMPT_TEMPLATE',
          id: 'prompt-1',
          createdAt: earlier.toISOString(),
          updatedAt: now.toISOString(),
          isDeleted: false,
          data: { name: 'Test Prompt', content: 'Prompt content' },
        };

        mockRepos.promptTemplates.findById.mockResolvedValue(null);
        mockRepos.promptTemplates.createOrUpdate.mockResolvedValue({
          id: 'prompt-1',
          updatedAt: now.toISOString(),
        });

        const result = await applyRemoteDelta(userId, instanceId, delta);

        expect(result.success).toBe(true);
        expect(result.isNewEntity).toBe(true);
      });

      it('should create MEMORY entity successfully', async () => {
        const delta: SyncEntityDelta = {
          entityType: 'MEMORY',
          id: 'memory-1',
          createdAt: earlier.toISOString(),
          updatedAt: now.toISOString(),
          isDeleted: false,
          data: { content: 'Memory content', characterId: 'char-1' },
        };

        mockRepos.memories.findById.mockResolvedValue(null);
        mockRepos.memories.createOrUpdate.mockResolvedValue({
          id: 'memory-1',
          updatedAt: now.toISOString(),
        });

        const result = await applyRemoteDelta(userId, instanceId, delta);

        expect(result.success).toBe(true);
        expect(result.isNewEntity).toBe(true);
      });

      it('should create CONNECTION_PROFILE entity and strip _apiKeyLabel', async () => {
        const delta: SyncEntityDelta = {
          entityType: 'CONNECTION_PROFILE',
          id: 'profile-1',
          createdAt: earlier.toISOString(),
          updatedAt: now.toISOString(),
          isDeleted: false,
          data: {
            name: 'Test Profile',
            provider: 'OPENAI',
            modelName: 'gpt-4',
            _apiKeyLabel: 'My API Key', // Should be stripped
          },
        };

        mockRepos.connections.findById.mockResolvedValue(null);
        mockRepos.connections.createOrUpdate.mockResolvedValue({
          id: 'profile-1',
          updatedAt: now.toISOString(),
        });

        const result = await applyRemoteDelta(userId, instanceId, delta);

        expect(result.success).toBe(true);
        expect(result.isNewEntity).toBe(true);
        // Verify apiKeyId is set to null and _apiKeyLabel is stripped
        expect(mockRepos.connections.createOrUpdate).toHaveBeenCalledWith(
          'profile-1',
          expect.objectContaining({
            name: 'Test Profile',
            provider: 'OPENAI',
            modelName: 'gpt-4',
            apiKeyId: null,
            userId,
          }),
          { createdAt: earlier.toISOString() }
        );
        // _apiKeyLabel should not be in the call
        const callArgs = mockRepos.connections.createOrUpdate.mock.calls[0][1];
        expect(callArgs._apiKeyLabel).toBeUndefined();
      });
    });

    describe('deleting entities', () => {
      it('should delete entity when delta.isDeleted is true', async () => {
        const delta: SyncEntityDelta = {
          entityType: 'CHARACTER',
          id: 'char-to-delete',
          createdAt: earlier.toISOString(),
          updatedAt: now.toISOString(),
          isDeleted: true,
          data: null,
        };

        mockRepos.characters.delete.mockResolvedValue(true);

        const result = await applyRemoteDelta(userId, instanceId, delta);

        expect(result.success).toBe(true);
        expect(mockRepos.characters.delete).toHaveBeenCalledWith('char-to-delete');
      });

      it('should delete FILE and its S3 content when delta.isDeleted is true', async () => {
        const delta: SyncEntityDelta = {
          entityType: 'FILE',
          id: 'file-to-delete',
          createdAt: earlier.toISOString(),
          updatedAt: now.toISOString(),
          isDeleted: true,
          data: null,
        };

        mockRepos.files.findById.mockResolvedValue({
          id: 'file-to-delete',
          s3Key: 'users/user-123/attachments/file-to-delete/test.jpg',
        });
        mockedS3FileService.deleteByS3Key = jest.fn().mockResolvedValue(undefined);
        mockRepos.files.delete.mockResolvedValue(true);

        const result = await applyRemoteDelta(userId, instanceId, delta);

        expect(result.success).toBe(true);
        expect(mockedS3FileService.deleteByS3Key).toHaveBeenCalledWith(
          'users/user-123/attachments/file-to-delete/test.jpg'
        );
        expect(mockRepos.files.delete).toHaveBeenCalledWith('file-to-delete');
      });

      it('should still delete file from database even if S3 deletion fails', async () => {
        const delta: SyncEntityDelta = {
          entityType: 'FILE',
          id: 'file-to-delete',
          createdAt: earlier.toISOString(),
          updatedAt: now.toISOString(),
          isDeleted: true,
          data: null,
        };

        mockRepos.files.findById.mockResolvedValue({
          id: 'file-to-delete',
          s3Key: 'users/user-123/attachments/file-to-delete/test.jpg',
        });
        mockedS3FileService.deleteByS3Key = jest.fn().mockRejectedValue(new Error('S3 error'));
        mockRepos.files.delete.mockResolvedValue(true);

        const result = await applyRemoteDelta(userId, instanceId, delta);

        expect(result.success).toBe(true);
        expect(mockRepos.files.delete).toHaveBeenCalledWith('file-to-delete');
      });

      it('should delete PERSONA entity successfully', async () => {
        const delta: SyncEntityDelta = {
          entityType: 'PERSONA',
          id: 'persona-1',
          createdAt: earlier.toISOString(),
          updatedAt: now.toISOString(),
          isDeleted: true,
          data: null,
        };

        mockRepos.personas.delete.mockResolvedValue(true);

        const result = await applyRemoteDelta(userId, instanceId, delta);

        expect(result.success).toBe(true);
        expect(mockRepos.personas.delete).toHaveBeenCalledWith('persona-1');
      });

      it('should delete CHAT entity successfully', async () => {
        const delta: SyncEntityDelta = {
          entityType: 'CHAT',
          id: 'chat-1',
          createdAt: earlier.toISOString(),
          updatedAt: now.toISOString(),
          isDeleted: true,
          data: null,
        };

        mockRepos.chats.delete.mockResolvedValue(true);

        const result = await applyRemoteDelta(userId, instanceId, delta);

        expect(result.success).toBe(true);
        expect(mockRepos.chats.delete).toHaveBeenCalledWith('chat-1');
      });

      it('should delete CONNECTION_PROFILE entity successfully', async () => {
        const delta: SyncEntityDelta = {
          entityType: 'CONNECTION_PROFILE',
          id: 'profile-1',
          createdAt: earlier.toISOString(),
          updatedAt: now.toISOString(),
          isDeleted: true,
          data: null,
        };

        mockRepos.connections.delete.mockResolvedValue(true);

        const result = await applyRemoteDelta(userId, instanceId, delta);

        expect(result.success).toBe(true);
        expect(mockRepos.connections.delete).toHaveBeenCalledWith('profile-1');
      });
    });

    describe('conflict resolution', () => {
      it('should update existing entity when REMOTE_WINS', async () => {
        const delta: SyncEntityDelta = {
          entityType: 'CHARACTER',
          id: 'char-1',
          createdAt: earlier.toISOString(),
          updatedAt: later.toISOString(),
          isDeleted: false,
          data: { name: 'Updated Character' },
        };

        const localEntity = { id: 'char-1', updatedAt: now.toISOString() };
        mockRepos.characters.findById.mockResolvedValue(localEntity);
        mockRepos.characters.update.mockResolvedValue(true);

        mockedResolveConflictWithRecord.mockReturnValue({
          resolution: 'REMOTE_WINS',
          conflict: {
            entityType: 'CHARACTER',
            localId: 'char-1',
            remoteId: 'char-1',
            resolution: 'REMOTE_WINS',
            localUpdatedAt: now.toISOString(),
            remoteUpdatedAt: later.toISOString(),
          },
        });

        const result = await applyRemoteDelta(userId, instanceId, delta);

        expect(result.success).toBe(true);
        expect(result.conflict).toBeDefined();
        expect(result.conflict?.resolution).toBe('REMOTE_WINS');
        expect(mockRepos.characters.update).toHaveBeenCalledWith('char-1', expect.objectContaining({ name: 'Updated Character' }));
      });

      it('should skip update when LOCAL_WINS', async () => {
        const delta: SyncEntityDelta = {
          entityType: 'CHARACTER',
          id: 'char-1',
          createdAt: earlier.toISOString(),
          updatedAt: earlier.toISOString(),
          isDeleted: false,
          data: { name: 'Old Character' },
        };

        const localEntity = { id: 'char-1', updatedAt: later.toISOString() };
        mockRepos.characters.findById.mockResolvedValue(localEntity);

        mockedResolveConflictWithRecord.mockReturnValue({
          resolution: 'LOCAL_WINS',
          conflict: {
            entityType: 'CHARACTER',
            localId: 'char-1',
            remoteId: 'char-1',
            resolution: 'LOCAL_WINS',
            localUpdatedAt: later.toISOString(),
            remoteUpdatedAt: earlier.toISOString(),
          },
        });

        const result = await applyRemoteDelta(userId, instanceId, delta);

        expect(result.success).toBe(true);
        expect(result.conflict?.resolution).toBe('LOCAL_WINS');
        expect(mockRepos.characters.update).not.toHaveBeenCalled();
      });

      it('should use timestamps for conflict resolution', async () => {
        const delta: SyncEntityDelta = {
          entityType: 'PERSONA',
          id: 'persona-1',
          createdAt: earlier.toISOString(),
          updatedAt: later.toISOString(),
          isDeleted: false,
          data: { name: 'Remote Persona' },
        };

        const localEntity = { id: 'persona-1', updatedAt: now.toISOString() };
        mockRepos.personas.findById.mockResolvedValue(localEntity);
        mockRepos.personas.update.mockResolvedValue(true);

        mockedResolveConflictWithRecord.mockReturnValue({
          resolution: 'REMOTE_WINS',
          conflict: {
            entityType: 'PERSONA',
            localId: 'persona-1',
            remoteId: 'persona-1',
            resolution: 'REMOTE_WINS',
            localUpdatedAt: now.toISOString(),
            remoteUpdatedAt: later.toISOString(),
          },
        });

        await applyRemoteDelta(userId, instanceId, delta);

        expect(mockedResolveConflictWithRecord).toHaveBeenCalledWith(
          'PERSONA',
          { id: 'persona-1', updatedAt: now.toISOString() },
          'persona-1',
          later.toISOString()
        );
      });
    });

    describe('error handling', () => {
      it('should return error when delta has no data and is not deleted', async () => {
        const delta: SyncEntityDelta = {
          entityType: 'CHARACTER',
          id: 'char-1',
          createdAt: earlier.toISOString(),
          updatedAt: now.toISOString(),
          isDeleted: false,
          data: null,
        };

        const result = await applyRemoteDelta(userId, instanceId, delta);

        expect(result.success).toBe(false);
        expect(result.error).toBe('Delta has no data');
      });

      it('should return error when entity creation fails', async () => {
        const delta: SyncEntityDelta = {
          entityType: 'CHARACTER',
          id: 'char-1',
          createdAt: earlier.toISOString(),
          updatedAt: now.toISOString(),
          isDeleted: false,
          data: { name: 'Test Character' },
        };

        mockRepos.characters.findById.mockResolvedValue(null);
        mockRepos.characters.createOrUpdate.mockResolvedValue(null);

        const result = await applyRemoteDelta(userId, instanceId, delta);

        expect(result.success).toBe(false);
        expect(result.error).toBe('Failed to create local entity');
      });

      it('should handle exceptions gracefully', async () => {
        const delta: SyncEntityDelta = {
          entityType: 'CHARACTER',
          id: 'char-1',
          createdAt: earlier.toISOString(),
          updatedAt: now.toISOString(),
          isDeleted: false,
          data: { name: 'Test Character' },
        };

        mockRepos.characters.findById.mockRejectedValue(new Error('Database error'));

        const result = await applyRemoteDelta(userId, instanceId, delta);

        expect(result.success).toBe(false);
        expect(result.error).toBe('Database error');
      });
    });

    describe('FILE entities', () => {
      it('should save content to S3 when provided inline as base64', async () => {
        const fileContent = Buffer.from('test file content').toString('base64');
        const delta: SyncEntityDelta = {
          entityType: 'FILE',
          id: 'file-1',
          createdAt: earlier.toISOString(),
          updatedAt: now.toISOString(),
          isDeleted: false,
          data: {
            originalFilename: 'test.txt',
            category: 'ATTACHMENT',
            mimeType: 'text/plain',
            content: fileContent,
          },
        };

        mockRepos.files.findById.mockResolvedValue(null);
        mockRepos.files.createOrUpdate.mockResolvedValue({ id: 'file-1', updatedAt: now.toISOString() });
        mockRepos.files.update.mockResolvedValue(true);
        mockedS3FileService.uploadUserFile = jest.fn().mockResolvedValue(undefined);
        mockedS3FileService.generateS3Key = jest.fn().mockReturnValue('users/user-123/attachments/file-1/test.txt');

        const result = await applyRemoteDelta(userId, instanceId, delta);

        expect(result.success).toBe(true);
        expect(mockedS3FileService.uploadUserFile).toHaveBeenCalledWith(
          userId,
          'file-1',
          'test.txt',
          'ATTACHMENT',
          expect.any(Buffer),
          'text/plain'
        );
      });

      it('should mark file as requiresContentFetch when content not provided inline', async () => {
        const delta: SyncEntityDelta = {
          entityType: 'FILE',
          id: 'file-1',
          createdAt: earlier.toISOString(),
          updatedAt: now.toISOString(),
          isDeleted: false,
          data: {
            originalFilename: 'large-file.zip',
            category: 'ATTACHMENT',
            mimeType: 'application/zip',
            requiresContentFetch: true,
          },
        };

        mockRepos.files.findById.mockResolvedValue(null);
        mockRepos.files.createOrUpdate.mockResolvedValue({ id: 'file-1', updatedAt: now.toISOString() });

        const result = await applyRemoteDelta(userId, instanceId, delta);

        expect(result.success).toBe(true);
        expect(result.isNewEntity).toBe(true);
        // uploadUserFile should not be called since content is not provided
        expect(mockedS3FileService.uploadUserFile).not.toHaveBeenCalled();
      });

      it('should update file content when REMOTE_WINS', async () => {
        const fileContent = Buffer.from('updated content').toString('base64');
        const delta: SyncEntityDelta = {
          entityType: 'FILE',
          id: 'file-1',
          createdAt: earlier.toISOString(),
          updatedAt: later.toISOString(),
          isDeleted: false,
          data: {
            originalFilename: 'test.txt',
            category: 'ATTACHMENT',
            mimeType: 'text/plain',
            content: fileContent,
          },
        };

        const existingFile = {
          id: 'file-1',
          userId,
          updatedAt: now.toISOString(),
          originalFilename: 'test.txt',
          category: 'ATTACHMENT',
          mimeType: 'text/plain',
        };

        mockRepos.files.findById.mockResolvedValue(existingFile);
        mockRepos.files.update.mockResolvedValue(true);
        mockedS3FileService.uploadUserFile = jest.fn().mockResolvedValue(undefined);

        mockedResolveConflictWithRecord.mockReturnValue({
          resolution: 'REMOTE_WINS',
          conflict: {
            entityType: 'FILE',
            localId: 'file-1',
            remoteId: 'file-1',
            resolution: 'REMOTE_WINS',
            localUpdatedAt: now.toISOString(),
            remoteUpdatedAt: later.toISOString(),
          },
        });

        const result = await applyRemoteDelta(userId, instanceId, delta);

        expect(result.success).toBe(true);
        expect(mockedS3FileService.uploadUserFile).toHaveBeenCalled();
      });
    });

    describe('CHAT entities', () => {
      it('should handle messages array when creating chat', async () => {
        const messages = [
          { id: 'msg-1', role: 'user', content: 'Hello' },
          { id: 'msg-2', role: 'assistant', content: 'Hi there!' },
        ];

        const delta: SyncEntityDelta = {
          entityType: 'CHAT',
          id: 'chat-1',
          createdAt: earlier.toISOString(),
          updatedAt: now.toISOString(),
          isDeleted: false,
          data: {
            title: 'Test Chat',
            characterId: 'char-1',
            messages,
          },
        };

        mockRepos.chats.findById.mockResolvedValue(null);
        mockRepos.chats.createOrUpdate.mockResolvedValue({ id: 'chat-1', updatedAt: now.toISOString() });
        mockRepos.chats.addMessages.mockResolvedValue(undefined);

        const result = await applyRemoteDelta(userId, instanceId, delta);

        expect(result.success).toBe(true);
        expect(mockRepos.chats.addMessages).toHaveBeenCalledWith('chat-1', messages);
      });

      it('should replace messages when updating chat with REMOTE_WINS', async () => {
        const messages = [
          { id: 'msg-3', role: 'user', content: 'Updated message' },
        ];

        const delta: SyncEntityDelta = {
          entityType: 'CHAT',
          id: 'chat-1',
          createdAt: earlier.toISOString(),
          updatedAt: later.toISOString(),
          isDeleted: false,
          data: {
            title: 'Updated Chat',
            messages,
          },
        };

        mockRepos.chats.findById.mockResolvedValue({ id: 'chat-1', updatedAt: now.toISOString() });
        mockRepos.chats.update.mockResolvedValue(true);
        mockRepos.chats.clearMessages.mockResolvedValue(undefined);
        mockRepos.chats.addMessages.mockResolvedValue(undefined);

        mockedResolveConflictWithRecord.mockReturnValue({
          resolution: 'REMOTE_WINS',
          conflict: {
            entityType: 'CHAT',
            localId: 'chat-1',
            remoteId: 'chat-1',
            resolution: 'REMOTE_WINS',
            localUpdatedAt: now.toISOString(),
            remoteUpdatedAt: later.toISOString(),
          },
        });

        const result = await applyRemoteDelta(userId, instanceId, delta);

        expect(result.success).toBe(true);
        expect(mockRepos.chats.clearMessages).toHaveBeenCalledWith('chat-1');
        expect(mockRepos.chats.addMessages).toHaveBeenCalledWith('chat-1', messages);
      });
    });
  });

  describe('processRemoteDeltas', () => {
    it('should apply all deltas and count successes', async () => {
      const deltas: SyncEntityDelta[] = [
        {
          entityType: 'CHARACTER',
          id: 'char-1',
          createdAt: earlier.toISOString(),
          updatedAt: now.toISOString(),
          isDeleted: false,
          data: { name: 'Character 1' },
        },
        {
          entityType: 'PERSONA',
          id: 'persona-1',
          createdAt: earlier.toISOString(),
          updatedAt: now.toISOString(),
          isDeleted: false,
          data: { name: 'Persona 1' },
        },
      ];

      mockRepos.characters.findById.mockResolvedValue(null);
      mockRepos.characters.createOrUpdate.mockResolvedValue({ id: 'char-1', updatedAt: now.toISOString() });
      mockRepos.personas.findById.mockResolvedValue(null);
      mockRepos.personas.createOrUpdate.mockResolvedValue({ id: 'persona-1', updatedAt: now.toISOString() });

      const result = await processRemoteDeltas(userId, instanceId, deltas);

      expect(result.applied).toBe(2);
      expect(result.errors).toHaveLength(0);
    });

    it('should collect conflicts during processing', async () => {
      const deltas: SyncEntityDelta[] = [
        {
          entityType: 'CHARACTER',
          id: 'char-1',
          createdAt: earlier.toISOString(),
          updatedAt: later.toISOString(),
          isDeleted: false,
          data: { name: 'Remote Character' },
        },
      ];

      const localEntity = { id: 'char-1', updatedAt: now.toISOString() };
      mockRepos.characters.findById.mockResolvedValue(localEntity);
      mockRepos.characters.update.mockResolvedValue(true);

      const conflict: SyncConflict = {
        entityType: 'CHARACTER',
        localId: 'char-1',
        remoteId: 'char-1',
        resolution: 'REMOTE_WINS',
        localUpdatedAt: now.toISOString(),
        remoteUpdatedAt: later.toISOString(),
      };

      mockedResolveConflictWithRecord.mockReturnValue({
        resolution: 'REMOTE_WINS',
        conflict,
      });

      const result = await processRemoteDeltas(userId, instanceId, deltas);

      expect(result.applied).toBe(1);
      expect(result.conflicts).toHaveLength(1);
      expect(result.conflicts[0]).toEqual(conflict);
    });

    it('should collect errors during processing', async () => {
      const deltas: SyncEntityDelta[] = [
        {
          entityType: 'CHARACTER',
          id: 'char-1',
          createdAt: earlier.toISOString(),
          updatedAt: now.toISOString(),
          isDeleted: false,
          data: null, // Invalid - no data
        },
      ];

      const result = await processRemoteDeltas(userId, instanceId, deltas);

      expect(result.applied).toBe(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('CHARACTER:char-1');
    });

    it('should track files needing content fetch', async () => {
      const deltas: SyncEntityDelta[] = [
        {
          entityType: 'FILE',
          id: 'file-1',
          createdAt: earlier.toISOString(),
          updatedAt: now.toISOString(),
          isDeleted: false,
          data: {
            originalFilename: 'large-file.zip',
            requiresContentFetch: true,
          },
        },
      ];

      mockRepos.files.findById
        .mockResolvedValueOnce(null) // First call during applyRemoteDelta
        .mockResolvedValueOnce({ id: 'file-1', s3Key: null }); // Second call checking for content
      mockRepos.files.createOrUpdate.mockResolvedValue({ id: 'file-1', updatedAt: now.toISOString() });

      const result = await processRemoteDeltas(userId, instanceId, deltas);

      expect(result.applied).toBe(1);
      expect(result.filesNeedingContent).toHaveLength(1);
      expect(result.filesNeedingContent[0]).toEqual({
        fileId: 'file-1',
        originalFilename: 'large-file.zip',
      });
    });

    it('should not track files that already have content', async () => {
      const deltas: SyncEntityDelta[] = [
        {
          entityType: 'FILE',
          id: 'file-1',
          createdAt: earlier.toISOString(),
          updatedAt: now.toISOString(),
          isDeleted: false,
          data: {
            originalFilename: 'large-file.zip',
            requiresContentFetch: true,
          },
        },
      ];

      mockRepos.files.findById
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'file-1', s3Key: 'users/user-123/files/file-1/large-file.zip' });
      mockRepos.files.createOrUpdate.mockResolvedValue({ id: 'file-1', updatedAt: now.toISOString() });

      const result = await processRemoteDeltas(userId, instanceId, deltas);

      expect(result.applied).toBe(1);
      expect(result.filesNeedingContent).toHaveLength(0);
    });

    it('should handle empty deltas array', async () => {
      const result = await processRemoteDeltas(userId, instanceId, []);

      expect(result.applied).toBe(0);
      expect(result.conflicts).toHaveLength(0);
      expect(result.errors).toHaveLength(0);
      expect(result.filesNeedingContent).toHaveLength(0);
    });
  });

  describe('prepareLocalDeltasForPush', () => {
    it('should use detectDeltas internally', async () => {
      const mockDeltas: SyncEntityDelta[] = [
        {
          entityType: 'CHARACTER',
          id: 'char-1',
          createdAt: earlier.toISOString(),
          updatedAt: now.toISOString(),
          isDeleted: false,
          data: { name: 'Local Character' },
        },
      ];

      mockedDetectDeltas.mockResolvedValue({
        deltas: mockDeltas,
        hasMore: false,
        oldestTimestamp: earlier.toISOString(),
        newestTimestamp: now.toISOString(),
      });

      const result = await prepareLocalDeltasForPush(userId, instanceId, earlier.toISOString());

      expect(mockedDetectDeltas).toHaveBeenCalledWith({
        userId,
        sinceTimestamp: earlier.toISOString(),
        limit: 1000,
      });
      expect(result.deltas).toEqual(mockDeltas);
    });

    it('should return array of local deltas', async () => {
      const mockDeltas: SyncEntityDelta[] = [
        {
          entityType: 'PERSONA',
          id: 'persona-1',
          createdAt: earlier.toISOString(),
          updatedAt: now.toISOString(),
          isDeleted: false,
          data: { name: 'Persona' },
        },
        {
          entityType: 'TAG',
          id: 'tag-1',
          createdAt: earlier.toISOString(),
          updatedAt: now.toISOString(),
          isDeleted: false,
          data: { name: 'Tag' },
        },
      ];

      mockedDetectDeltas.mockResolvedValue({
        deltas: mockDeltas,
        hasMore: false,
        oldestTimestamp: earlier.toISOString(),
        newestTimestamp: now.toISOString(),
      });

      const result = await prepareLocalDeltasForPush(userId, instanceId, null);

      expect(result.deltas).toHaveLength(2);
      expect(result.deltas[0].entityType).toBe('PERSONA');
      expect(result.deltas[1].entityType).toBe('TAG');
    });

    it('should handle null sinceTimestamp for full sync', async () => {
      mockedDetectDeltas.mockResolvedValue({
        deltas: [],
        hasMore: false,
        oldestTimestamp: null,
        newestTimestamp: null,
      });

      await prepareLocalDeltasForPush(userId, instanceId, null);

      expect(mockedDetectDeltas).toHaveBeenCalledWith({
        userId,
        sinceTimestamp: null,
        limit: 1000,
      });
    });
  });

  describe('startSyncOperation', () => {
    it('should create operation record with IN_PROGRESS status', async () => {
      const mockOperation: SyncOperation = {
        id: 'op-1',
        userId,
        instanceId,
        direction: 'BIDIRECTIONAL',
        status: 'IN_PROGRESS',
        entityCounts: {},
        conflicts: [],
        errors: [],
        startedAt: now.toISOString(),
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      };

      mockRepos.syncOperations.create.mockResolvedValue(mockOperation);

      const result = await startSyncOperation(userId, instanceId, 'BIDIRECTIONAL');

      expect(result.status).toBe('IN_PROGRESS');
      expect(mockRepos.syncOperations.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId,
          instanceId,
          direction: 'BIDIRECTIONAL',
          status: 'IN_PROGRESS',
        })
      );
    });

    it('should set correct direction for PUSH', async () => {
      const mockOperation: SyncOperation = {
        id: 'op-2',
        userId,
        instanceId,
        direction: 'PUSH',
        status: 'IN_PROGRESS',
        entityCounts: {},
        conflicts: [],
        errors: [],
        startedAt: now.toISOString(),
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      };

      mockRepos.syncOperations.create.mockResolvedValue(mockOperation);

      const result = await startSyncOperation(userId, instanceId, 'PUSH');

      expect(result.direction).toBe('PUSH');
    });

    it('should set correct direction for PULL', async () => {
      const mockOperation: SyncOperation = {
        id: 'op-3',
        userId,
        instanceId,
        direction: 'PULL',
        status: 'IN_PROGRESS',
        entityCounts: {},
        conflicts: [],
        errors: [],
        startedAt: now.toISOString(),
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      };

      mockRepos.syncOperations.create.mockResolvedValue(mockOperation);

      const result = await startSyncOperation(userId, instanceId, 'PULL');

      expect(result.direction).toBe('PULL');
    });
  });

  describe('completeSyncOperation', () => {
    it('should update status to COMPLETED on success', async () => {
      const operationId = 'op-1';
      const entityCounts = { CHARACTER: 5, PERSONA: 3 };
      const conflicts: SyncConflict[] = [];
      const errors: string[] = [];

      const completedOperation: SyncOperation = {
        id: operationId,
        userId,
        instanceId,
        direction: 'BIDIRECTIONAL',
        status: 'COMPLETED',
        entityCounts,
        conflicts,
        errors,
        startedAt: earlier.toISOString(),
        completedAt: now.toISOString(),
        createdAt: earlier.toISOString(),
        updatedAt: now.toISOString(),
      };

      mockRepos.syncOperations.complete.mockResolvedValue(completedOperation);

      const result = await completeSyncOperation(operationId, true, entityCounts, conflicts, errors);

      expect(result?.status).toBe('COMPLETED');
      expect(mockRepos.syncOperations.complete).toHaveBeenCalledWith(
        operationId,
        'COMPLETED',
        entityCounts,
        conflicts,
        errors
      );
    });

    it('should update status to FAILED on failure', async () => {
      const operationId = 'op-2';
      const entityCounts = { CHARACTER: 2 };
      const conflicts: SyncConflict[] = [];
      const errors = ['Connection error', 'Timeout'];

      const failedOperation: SyncOperation = {
        id: operationId,
        userId,
        instanceId,
        direction: 'PUSH',
        status: 'FAILED',
        entityCounts,
        conflicts,
        errors,
        startedAt: earlier.toISOString(),
        completedAt: now.toISOString(),
        createdAt: earlier.toISOString(),
        updatedAt: now.toISOString(),
      };

      mockRepos.syncOperations.complete.mockResolvedValue(failedOperation);

      const result = await completeSyncOperation(operationId, false, entityCounts, conflicts, errors);

      expect(result?.status).toBe('FAILED');
      expect(mockRepos.syncOperations.complete).toHaveBeenCalledWith(
        operationId,
        'FAILED',
        entityCounts,
        conflicts,
        errors
      );
    });

    it('should store entity counts in operation', async () => {
      const operationId = 'op-3';
      const entityCounts = { CHARACTER: 10, PERSONA: 5, CHAT: 20, MEMORY: 100 };
      const conflicts: SyncConflict[] = [];
      const errors: string[] = [];

      const operation: SyncOperation = {
        id: operationId,
        userId,
        instanceId,
        direction: 'PULL',
        status: 'COMPLETED',
        entityCounts,
        conflicts,
        errors,
        startedAt: earlier.toISOString(),
        completedAt: now.toISOString(),
        createdAt: earlier.toISOString(),
        updatedAt: now.toISOString(),
      };

      mockRepos.syncOperations.complete.mockResolvedValue(operation);

      const result = await completeSyncOperation(operationId, true, entityCounts, conflicts, errors);

      expect(result?.entityCounts).toEqual(entityCounts);
    });

    it('should store conflicts in operation', async () => {
      const operationId = 'op-4';
      const entityCounts = { CHARACTER: 5 };
      const conflicts: SyncConflict[] = [
        {
          entityType: 'CHARACTER',
          localId: 'char-1',
          remoteId: 'char-1',
          resolution: 'REMOTE_WINS',
          localUpdatedAt: now.toISOString(),
          remoteUpdatedAt: later.toISOString(),
        },
      ];
      const errors: string[] = [];

      const operation: SyncOperation = {
        id: operationId,
        userId,
        instanceId,
        direction: 'BIDIRECTIONAL',
        status: 'COMPLETED',
        entityCounts,
        conflicts,
        errors,
        startedAt: earlier.toISOString(),
        completedAt: now.toISOString(),
        createdAt: earlier.toISOString(),
        updatedAt: now.toISOString(),
      };

      mockRepos.syncOperations.complete.mockResolvedValue(operation);

      const result = await completeSyncOperation(operationId, true, entityCounts, conflicts, errors);

      expect(result?.conflicts).toHaveLength(1);
      expect(result?.conflicts[0].entityType).toBe('CHARACTER');
    });

    it('should store errors in operation', async () => {
      const operationId = 'op-5';
      const entityCounts = { CHARACTER: 3 };
      const conflicts: SyncConflict[] = [];
      const errors = ['Error 1', 'Error 2', 'Error 3'];

      const operation: SyncOperation = {
        id: operationId,
        userId,
        instanceId,
        direction: 'PUSH',
        status: 'FAILED',
        entityCounts,
        conflicts,
        errors,
        startedAt: earlier.toISOString(),
        completedAt: now.toISOString(),
        createdAt: earlier.toISOString(),
        updatedAt: now.toISOString(),
      };

      mockRepos.syncOperations.complete.mockResolvedValue(operation);

      const result = await completeSyncOperation(operationId, false, entityCounts, conflicts, errors);

      expect(result?.errors).toHaveLength(3);
      expect(result?.errors).toEqual(errors);
    });
  });

  describe('cleanSyncData', () => {
    it('should delete all sync mappings for user', async () => {
      mockRepos.syncMappings.deleteByUserId.mockResolvedValue(10);
      mockRepos.syncOperations.deleteByUserId.mockResolvedValue(5);
      mockRepos.syncInstances.findByUserId.mockResolvedValue([]);

      const result = await cleanSyncData(userId);

      expect(mockRepos.syncMappings.deleteByUserId).toHaveBeenCalledWith(userId);
      expect(result.mappingsDeleted).toBe(10);
    });

    it('should delete all sync operations for user', async () => {
      mockRepos.syncMappings.deleteByUserId.mockResolvedValue(0);
      mockRepos.syncOperations.deleteByUserId.mockResolvedValue(25);
      mockRepos.syncInstances.findByUserId.mockResolvedValue([]);

      const result = await cleanSyncData(userId);

      expect(mockRepos.syncOperations.deleteByUserId).toHaveBeenCalledWith(userId);
      expect(result.operationsDeleted).toBe(25);
    });

    it('should reset lastSyncAt on all sync instances', async () => {
      const instances = [
        { id: 'inst-1', userId, name: 'Instance 1' },
        { id: 'inst-2', userId, name: 'Instance 2' },
        { id: 'inst-3', userId, name: 'Instance 3' },
      ];

      mockRepos.syncMappings.deleteByUserId.mockResolvedValue(0);
      mockRepos.syncOperations.deleteByUserId.mockResolvedValue(0);
      mockRepos.syncInstances.findByUserId.mockResolvedValue(instances);
      mockRepos.syncInstances.update.mockResolvedValue(true);

      const result = await cleanSyncData(userId);

      expect(mockRepos.syncInstances.findByUserId).toHaveBeenCalledWith(userId);
      expect(mockRepos.syncInstances.update).toHaveBeenCalledTimes(3);
      expect(mockRepos.syncInstances.update).toHaveBeenCalledWith('inst-1', {
        lastSyncAt: null,
        lastSyncStatus: null,
      });
      expect(mockRepos.syncInstances.update).toHaveBeenCalledWith('inst-2', {
        lastSyncAt: null,
        lastSyncStatus: null,
      });
      expect(mockRepos.syncInstances.update).toHaveBeenCalledWith('inst-3', {
        lastSyncAt: null,
        lastSyncStatus: null,
      });
      expect(result.instancesReset).toBe(3);
    });

    it('should handle empty sync data gracefully', async () => {
      mockRepos.syncMappings.deleteByUserId.mockResolvedValue(0);
      mockRepos.syncOperations.deleteByUserId.mockResolvedValue(0);
      mockRepos.syncInstances.findByUserId.mockResolvedValue([]);

      const result = await cleanSyncData(userId);

      expect(result.mappingsDeleted).toBe(0);
      expect(result.operationsDeleted).toBe(0);
      expect(result.instancesReset).toBe(0);
    });

    it('should handle null return values from delete operations', async () => {
      mockRepos.syncMappings.deleteByUserId.mockResolvedValue(null);
      mockRepos.syncOperations.deleteByUserId.mockResolvedValue(null);
      mockRepos.syncInstances.findByUserId.mockResolvedValue([]);

      const result = await cleanSyncData(userId);

      expect(result.mappingsDeleted).toBe(0);
      expect(result.operationsDeleted).toBe(0);
    });

    it('should throw error when database operation fails', async () => {
      mockRepos.syncMappings.deleteByUserId.mockRejectedValue(new Error('Database error'));

      await expect(cleanSyncData(userId)).rejects.toThrow('Database error');
    });
  });

  describe('edge cases and error handling', () => {
    it('should handle unknown entity type gracefully when getting local entity', async () => {
      const delta: SyncEntityDelta = {
        entityType: 'UNKNOWN' as SyncableEntityType,
        id: 'unknown-1',
        createdAt: earlier.toISOString(),
        updatedAt: now.toISOString(),
        isDeleted: false,
        data: { name: 'Unknown Entity' },
      };

      // When entity type is unknown, getLocalEntity returns null
      // Then createLocalEntity is called, which also returns null for unknown types
      const result = await applyRemoteDelta(userId, instanceId, delta);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Failed to create local entity');
    });

    it('should handle unknown entity type when deleting', async () => {
      const delta: SyncEntityDelta = {
        entityType: 'UNKNOWN' as SyncableEntityType,
        id: 'unknown-1',
        createdAt: earlier.toISOString(),
        updatedAt: now.toISOString(),
        isDeleted: true,
        data: null,
      };

      // deleteLocalEntity returns false for unknown types
      const result = await applyRemoteDelta(userId, instanceId, delta);

      expect(result.success).toBe(true);
    });

    it('should handle multiple entity types in a single processRemoteDeltas call', async () => {
      const deltas: SyncEntityDelta[] = [
        {
          entityType: 'TAG',
          id: 'tag-1',
          createdAt: earlier.toISOString(),
          updatedAt: now.toISOString(),
          isDeleted: false,
          data: { name: 'Tag 1' },
        },
        {
          entityType: 'PERSONA',
          id: 'persona-1',
          createdAt: earlier.toISOString(),
          updatedAt: now.toISOString(),
          isDeleted: false,
          data: { name: 'Persona 1' },
        },
        {
          entityType: 'CHARACTER',
          id: 'char-1',
          createdAt: earlier.toISOString(),
          updatedAt: now.toISOString(),
          isDeleted: false,
          data: { name: 'Character 1' },
        },
        {
          entityType: 'CHAT',
          id: 'chat-1',
          createdAt: earlier.toISOString(),
          updatedAt: now.toISOString(),
          isDeleted: false,
          data: { title: 'Chat 1' },
        },
      ];

      mockRepos.tags.findById.mockResolvedValue(null);
      mockRepos.tags.createOrUpdate.mockResolvedValue({ id: 'tag-1', updatedAt: now.toISOString() });
      mockRepos.personas.findById.mockResolvedValue(null);
      mockRepos.personas.createOrUpdate.mockResolvedValue({ id: 'persona-1', updatedAt: now.toISOString() });
      mockRepos.characters.findById.mockResolvedValue(null);
      mockRepos.characters.createOrUpdate.mockResolvedValue({ id: 'char-1', updatedAt: now.toISOString() });
      mockRepos.chats.findById.mockResolvedValue(null);
      mockRepos.chats.createOrUpdate.mockResolvedValue({ id: 'chat-1', updatedAt: now.toISOString() });

      const result = await processRemoteDeltas(userId, instanceId, deltas);

      expect(result.applied).toBe(4);
      expect(result.errors).toHaveLength(0);
    });

    it('should continue processing even when some deltas fail', async () => {
      const deltas: SyncEntityDelta[] = [
        {
          entityType: 'CHARACTER',
          id: 'char-1',
          createdAt: earlier.toISOString(),
          updatedAt: now.toISOString(),
          isDeleted: false,
          data: { name: 'Character 1' },
        },
        {
          entityType: 'CHARACTER',
          id: 'char-2',
          createdAt: earlier.toISOString(),
          updatedAt: now.toISOString(),
          isDeleted: false,
          data: null, // This will fail
        },
        {
          entityType: 'CHARACTER',
          id: 'char-3',
          createdAt: earlier.toISOString(),
          updatedAt: now.toISOString(),
          isDeleted: false,
          data: { name: 'Character 3' },
        },
      ];

      mockRepos.characters.findById.mockResolvedValue(null);
      mockRepos.characters.createOrUpdate.mockResolvedValue({ id: 'created', updatedAt: now.toISOString() });

      const result = await processRemoteDeltas(userId, instanceId, deltas);

      expect(result.applied).toBe(2);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('CHARACTER:char-2');
    });
  });
});
