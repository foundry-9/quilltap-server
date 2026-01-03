/**
 * Unit Tests for Sync Delta Detector
 *
 * Tests the delta detection logic used during sync operations.
 * Covers entity detection, filtering by timestamp, limit handling,
 * entity type ordering, and file content handling.
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import {
  createMockCharacter,
  createMockPersona,
  createMockChat,
  createMockTag,
  createMockMemory,
  createMockRoleplayTemplate,
  createMockPromptTemplate,
  createMockFileEntry,
  createMockMessage,
  generateId,
} from '../fixtures/test-factories';

// Define mock repositories interface for this test
interface MockRepositories {
  characters: {
    findByUserId: jest.Mock;
  };
  personas: {
    findByUserId: jest.Mock;
  };
  chats: {
    findByUserId: jest.Mock;
    findById: jest.Mock;
    getMessages: jest.Mock;
  };
  tags: {
    findByUserId: jest.Mock;
  };
  memories: {
    findByCharacterId: jest.Mock;
  };
  files: {
    findByUserId: jest.Mock;
  };
  projects: {
    findByUserId: jest.Mock;
  };
  roleplayTemplates: {
    findByUserId: jest.Mock;
  };
  promptTemplates: {
    findByUserId: jest.Mock;
  };
}

// Create mock repositories - must be defined before jest.mock
const mockRepositories: MockRepositories = {
  characters: {
    findByUserId: jest.fn().mockResolvedValue([]),
  },
  personas: {
    findByUserId: jest.fn().mockResolvedValue([]),
  },
  chats: {
    findByUserId: jest.fn().mockResolvedValue([]),
    findById: jest.fn().mockResolvedValue(null),
    getMessages: jest.fn().mockResolvedValue([]),
  },
  tags: {
    findByUserId: jest.fn().mockResolvedValue([]),
  },
  memories: {
    findByCharacterId: jest.fn().mockResolvedValue([]),
  },
  files: {
    findByUserId: jest.fn().mockResolvedValue([]),
  },
  projects: {
    findByUserId: jest.fn().mockResolvedValue([]),
  },
  roleplayTemplates: {
    findByUserId: jest.fn().mockResolvedValue([]),
  },
  promptTemplates: {
    findByUserId: jest.fn().mockResolvedValue([]),
  },
};

// Mock the S3 file service download function
const mockDownloadUserFile = jest.fn();

// Mock the mongodb repositories - must be called before importing the module under test
jest.mock('@/lib/mongodb/repositories', () => ({
  getRepositories: jest.fn(() => mockRepositories),
}));

// Mock the logger
jest.mock('@/lib/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

// Mock the S3 file service
jest.mock('@/lib/s3/file-service', () => ({
  s3FileService: {
    downloadUserFile: mockDownloadUserFile,
  },
}));

// Import after mocking - use require to ensure mocks are in place
const { detectDeltas, countDeltas, getMostRecentUpdate } = require('@/lib/sync/delta-detector');
const { FILE_CONTENT_SIZE_THRESHOLD } = require('@/lib/sync/types');

describe('Sync Delta Detector', () => {
  const testUserId = generateId();

  // Timestamp helpers
  const now = new Date();
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
  const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);
  const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);

  beforeEach(() => {
    jest.clearAllMocks();
    // Reset all repository mocks to return empty arrays
    mockRepositories.characters.findByUserId.mockResolvedValue([]);
    mockRepositories.personas.findByUserId.mockResolvedValue([]);
    mockRepositories.chats.findByUserId.mockResolvedValue([]);
    mockRepositories.chats.findById.mockResolvedValue(null);
    mockRepositories.chats.getMessages.mockResolvedValue([]);
    mockRepositories.tags.findByUserId.mockResolvedValue([]);
    mockRepositories.memories.findByCharacterId.mockResolvedValue([]);
    mockRepositories.files.findByUserId.mockResolvedValue([]);
    mockRepositories.roleplayTemplates.findByUserId.mockResolvedValue([]);
    mockRepositories.promptTemplates.findByUserId.mockResolvedValue([]);
    mockDownloadUserFile.mockReset();
  });

  // ============================================================================
  // detectDeltas() Tests
  // ============================================================================

  describe('detectDeltas()', () => {
    describe('basic delta detection', () => {
      it('should detect entities updated after sinceTimestamp', async () => {
        const oldChar = createMockCharacter({
          userId: testUserId,
          updatedAt: threeDaysAgo.toISOString(),
        });
        const newChar = createMockCharacter({
          userId: testUserId,
          updatedAt: oneHourAgo.toISOString(),
        });

        mockRepositories.characters.findByUserId.mockResolvedValue([oldChar, newChar]);

        const result = await detectDeltas({
          userId: testUserId,
          sinceTimestamp: twoHoursAgo.toISOString(),
          entityTypes: ['CHARACTER'],
        });

        expect(result.deltas).toHaveLength(1);
        expect(result.deltas[0].id).toBe(newChar.id);
        expect(result.deltas[0].entityType).toBe('CHARACTER');
      });

      it('should include all entities when sinceTimestamp is null', async () => {
        const char1 = createMockCharacter({
          userId: testUserId,
          updatedAt: threeDaysAgo.toISOString(),
        });
        const char2 = createMockCharacter({
          userId: testUserId,
          updatedAt: oneHourAgo.toISOString(),
        });

        mockRepositories.characters.findByUserId.mockResolvedValue([char1, char2]);

        const result = await detectDeltas({
          userId: testUserId,
          sinceTimestamp: null,
          entityTypes: ['CHARACTER'],
        });

        expect(result.deltas).toHaveLength(2);
      });

      it('should respect limit parameter and return hasMore when exceeded', async () => {
        const characters = Array.from({ length: 10 }, (_, i) =>
          createMockCharacter({
            userId: testUserId,
            name: `Character ${i}`,
            updatedAt: new Date(now.getTime() - i * 1000).toISOString(),
          })
        );

        mockRepositories.characters.findByUserId.mockResolvedValue(characters);

        const result = await detectDeltas({
          userId: testUserId,
          sinceTimestamp: null,
          entityTypes: ['CHARACTER'],
          limit: 5,
        });

        expect(result.deltas).toHaveLength(5);
        expect(result.hasMore).toBe(true);
      });

      it('should return hasMore=false when within limit', async () => {
        const characters = Array.from({ length: 3 }, (_, i) =>
          createMockCharacter({
            userId: testUserId,
            name: `Character ${i}`,
          })
        );

        mockRepositories.characters.findByUserId.mockResolvedValue(characters);

        const result = await detectDeltas({
          userId: testUserId,
          sinceTimestamp: null,
          entityTypes: ['CHARACTER'],
          limit: 10,
        });

        expect(result.deltas).toHaveLength(3);
        expect(result.hasMore).toBe(false);
      });

      it('should sort deltas by updatedAt ascending (oldest first)', async () => {
        const char1 = createMockCharacter({
          userId: testUserId,
          name: 'Oldest',
          updatedAt: threeDaysAgo.toISOString(),
        });
        const char2 = createMockCharacter({
          userId: testUserId,
          name: 'Middle',
          updatedAt: twoHoursAgo.toISOString(),
        });
        const char3 = createMockCharacter({
          userId: testUserId,
          name: 'Newest',
          updatedAt: oneHourAgo.toISOString(),
        });

        mockRepositories.characters.findByUserId.mockResolvedValue([char3, char1, char2]);

        const result = await detectDeltas({
          userId: testUserId,
          sinceTimestamp: null,
          entityTypes: ['CHARACTER'],
        });

        expect(result.deltas[0].id).toBe(char1.id);
        expect(result.deltas[1].id).toBe(char2.id);
        expect(result.deltas[2].id).toBe(char3.id);
      });
    });

    describe('entity type handling', () => {
      it('should include all entity types in default order', async () => {
        const tag = createMockTag({ userId: testUserId });
        const file = createMockFileEntry({ userId: testUserId, size: 100 });
        const persona = createMockPersona({ userId: testUserId });
        const character = createMockCharacter({ userId: testUserId });
        const roleplayTemplate = createMockRoleplayTemplate({ userId: testUserId });
        const promptTemplate = createMockPromptTemplate({ userId: testUserId });
        const chat = createMockChat({ userId: testUserId });
        const memory = createMockMemory({ characterId: character.id });

        mockRepositories.tags.findByUserId.mockResolvedValue([tag]);
        mockRepositories.files.findByUserId.mockResolvedValue([file]);
        mockRepositories.personas.findByUserId.mockResolvedValue([persona]);
        mockRepositories.characters.findByUserId.mockResolvedValue([character]);
        mockRepositories.roleplayTemplates.findByUserId.mockResolvedValue([roleplayTemplate]);
        mockRepositories.promptTemplates.findByUserId.mockResolvedValue([promptTemplate]);
        mockRepositories.chats.findByUserId.mockResolvedValue([chat]);
        mockRepositories.chats.findById.mockResolvedValue(chat);
        mockRepositories.memories.findByCharacterId.mockResolvedValue([memory]);
        mockDownloadUserFile.mockResolvedValue(Buffer.from('test content'));

        const result = await detectDeltas({
          userId: testUserId,
          sinceTimestamp: null,
        });

        // Should have all 8 entity types
        expect(result.deltas.length).toBeGreaterThanOrEqual(8);

        // Check that all entity types are represented
        const entityTypes = result.deltas.map((d) => d.entityType);
        expect(entityTypes).toContain('TAG');
        expect(entityTypes).toContain('FILE');
        expect(entityTypes).toContain('PERSONA');
        expect(entityTypes).toContain('CHARACTER');
        expect(entityTypes).toContain('ROLEPLAY_TEMPLATE');
        expect(entityTypes).toContain('PROMPT_TEMPLATE');
        expect(entityTypes).toContain('CHAT');
        expect(entityTypes).toContain('MEMORY');
      });

      it('should filter to specific entityTypes when provided', async () => {
        const character = createMockCharacter({ userId: testUserId });
        const persona = createMockPersona({ userId: testUserId });

        mockRepositories.characters.findByUserId.mockResolvedValue([character]);
        mockRepositories.personas.findByUserId.mockResolvedValue([persona]);

        const result = await detectDeltas({
          userId: testUserId,
          sinceTimestamp: null,
          entityTypes: ['CHARACTER', 'PERSONA'],
        });

        expect(result.deltas).toHaveLength(2);
        const entityTypes = result.deltas.map((d) => d.entityType);
        expect(entityTypes).toContain('CHARACTER');
        expect(entityTypes).toContain('PERSONA');
        expect(entityTypes).not.toContain('TAG');
        expect(entityTypes).not.toContain('CHAT');
      });

      it('should handle single entity type filter', async () => {
        const tag = createMockTag({ userId: testUserId });
        mockRepositories.tags.findByUserId.mockResolvedValue([tag]);

        const result = await detectDeltas({
          userId: testUserId,
          sinceTimestamp: null,
          entityTypes: ['TAG'],
        });

        expect(result.deltas).toHaveLength(1);
        expect(result.deltas[0].entityType).toBe('TAG');
      });
    });

    describe('timestamp handling', () => {
      it('should return correct oldestTimestamp and newestTimestamp', async () => {
        const char1 = createMockCharacter({
          userId: testUserId,
          updatedAt: threeDaysAgo.toISOString(),
        });
        const char2 = createMockCharacter({
          userId: testUserId,
          updatedAt: oneHourAgo.toISOString(),
        });

        mockRepositories.characters.findByUserId.mockResolvedValue([char1, char2]);

        const result = await detectDeltas({
          userId: testUserId,
          sinceTimestamp: null,
          entityTypes: ['CHARACTER'],
        });

        expect(result.oldestTimestamp).toBe(threeDaysAgo.toISOString());
        expect(result.newestTimestamp).toBe(oneHourAgo.toISOString());
      });

      it('should return null timestamps when no deltas', async () => {
        mockRepositories.characters.findByUserId.mockResolvedValue([]);

        const result = await detectDeltas({
          userId: testUserId,
          sinceTimestamp: null,
          entityTypes: ['CHARACTER'],
        });

        expect(result.deltas).toHaveLength(0);
        expect(result.oldestTimestamp).toBeNull();
        expect(result.newestTimestamp).toBeNull();
      });

      it('should handle same timestamps for oldest and newest', async () => {
        const timestamp = oneHourAgo.toISOString();
        const char = createMockCharacter({
          userId: testUserId,
          updatedAt: timestamp,
        });

        mockRepositories.characters.findByUserId.mockResolvedValue([char]);

        const result = await detectDeltas({
          userId: testUserId,
          sinceTimestamp: null,
          entityTypes: ['CHARACTER'],
        });

        expect(result.oldestTimestamp).toBe(timestamp);
        expect(result.newestTimestamp).toBe(timestamp);
      });
    });

    describe('chat entity handling', () => {
      it('should include messages in chat delta data', async () => {
        const chat = createMockChat({ userId: testUserId });
        const messages = [
          createMockMessage({ content: 'Hello' }),
          createMockMessage({ content: 'World', role: 'ASSISTANT' }),
        ];

        mockRepositories.chats.findByUserId.mockResolvedValue([chat]);
        mockRepositories.chats.findById.mockResolvedValue(chat);
        mockRepositories.chats.getMessages.mockResolvedValue(messages);

        const result = await detectDeltas({
          userId: testUserId,
          sinceTimestamp: null,
          entityTypes: ['CHAT'],
        });

        expect(result.deltas).toHaveLength(1);
        expect(result.deltas[0].entityType).toBe('CHAT');
        expect(result.deltas[0].data).toHaveProperty('messages');
        expect((result.deltas[0].data as any).messages).toHaveLength(2);
      });

      it('should skip chat if findById returns null', async () => {
        const chat = createMockChat({ userId: testUserId });

        mockRepositories.chats.findByUserId.mockResolvedValue([chat]);
        mockRepositories.chats.findById.mockResolvedValue(null);

        const result = await detectDeltas({
          userId: testUserId,
          sinceTimestamp: null,
          entityTypes: ['CHAT'],
        });

        expect(result.deltas).toHaveLength(0);
      });
    });

    describe('memory entity handling', () => {
      it('should fetch memories via characters', async () => {
        const character = createMockCharacter({ userId: testUserId });
        const memory1 = createMockMemory({ characterId: character.id, content: 'Memory 1' });
        const memory2 = createMockMemory({ characterId: character.id, content: 'Memory 2' });

        mockRepositories.characters.findByUserId.mockResolvedValue([character]);
        mockRepositories.memories.findByCharacterId.mockResolvedValue([memory1, memory2]);

        const result = await detectDeltas({
          userId: testUserId,
          sinceTimestamp: null,
          entityTypes: ['MEMORY'],
        });

        expect(result.deltas).toHaveLength(2);
        expect(result.deltas.every((d) => d.entityType === 'MEMORY')).toBe(true);
      });

      it('should handle memories from multiple characters', async () => {
        const char1 = createMockCharacter({ userId: testUserId, name: 'Character 1' });
        const char2 = createMockCharacter({ userId: testUserId, name: 'Character 2' });
        const memory1 = createMockMemory({ characterId: char1.id });
        const memory2 = createMockMemory({ characterId: char2.id });

        mockRepositories.characters.findByUserId.mockResolvedValue([char1, char2]);
        mockRepositories.memories.findByCharacterId
          .mockResolvedValueOnce([memory1])
          .mockResolvedValueOnce([memory2]);

        const result = await detectDeltas({
          userId: testUserId,
          sinceTimestamp: null,
          entityTypes: ['MEMORY'],
        });

        expect(result.deltas).toHaveLength(2);
      });
    });
  });

  // ============================================================================
  // FILE entity handling tests
  // ============================================================================

  describe('FILE entity handling', () => {
    it('should include base64 content inline for small files', async () => {
      const smallFile = createMockFileEntry({
        userId: testUserId,
        size: 100, // Well under threshold
        s3Key: 'test-key',
      });
      const fileContent = Buffer.from('small file content');

      mockRepositories.files.findByUserId.mockResolvedValue([smallFile]);
      mockDownloadUserFile.mockResolvedValue(fileContent);

      const result = await detectDeltas({
        userId: testUserId,
        sinceTimestamp: null,
        entityTypes: ['FILE'],
      });

      expect(result.deltas).toHaveLength(1);
      expect(result.deltas[0].data).toHaveProperty('content');
      expect((result.deltas[0].data as any).content).toBe(fileContent.toString('base64'));
      expect((result.deltas[0].data as any).requiresContentFetch).toBe(false);
    });

    it('should set requiresContentFetch=true for large files', async () => {
      const largeFile = createMockFileEntry({
        userId: testUserId,
        size: FILE_CONTENT_SIZE_THRESHOLD + 1000, // Over threshold
        s3Key: 'test-key',
      });

      mockRepositories.files.findByUserId.mockResolvedValue([largeFile]);

      const result = await detectDeltas({
        userId: testUserId,
        sinceTimestamp: null,
        entityTypes: ['FILE'],
      });

      expect(result.deltas).toHaveLength(1);
      expect((result.deltas[0].data as any).requiresContentFetch).toBe(true);
      expect((result.deltas[0].data as any).content).toBeUndefined();
    });

    it('should not include s3Key/s3Bucket in delta data', async () => {
      const file = createMockFileEntry({
        userId: testUserId,
        size: 100,
        s3Key: 'users/test/files/test.png',
        s3Bucket: 'quilltap-files',
      });

      mockRepositories.files.findByUserId.mockResolvedValue([file]);
      mockDownloadUserFile.mockResolvedValue(Buffer.from('content'));

      const result = await detectDeltas({
        userId: testUserId,
        sinceTimestamp: null,
        entityTypes: ['FILE'],
      });

      expect(result.deltas).toHaveLength(1);
      expect((result.deltas[0].data as any).s3Key).toBeUndefined();
      expect((result.deltas[0].data as any).s3Bucket).toBeUndefined();
    });

    it('should mark file for content fetch when download fails', async () => {
      const file = createMockFileEntry({
        userId: testUserId,
        size: 100,
        s3Key: 'test-key',
      });

      mockRepositories.files.findByUserId.mockResolvedValue([file]);
      mockDownloadUserFile.mockRejectedValue(new Error('Download failed'));

      const result = await detectDeltas({
        userId: testUserId,
        sinceTimestamp: null,
        entityTypes: ['FILE'],
      });

      expect(result.deltas).toHaveLength(1);
      expect((result.deltas[0].data as any).requiresContentFetch).toBe(true);
    });

    it('should set requiresContentFetch=true when file has no s3Key', async () => {
      const fileWithoutS3Key = createMockFileEntry({
        userId: testUserId,
        size: 100,
        s3Key: undefined as any,
      });

      mockRepositories.files.findByUserId.mockResolvedValue([fileWithoutS3Key]);

      const result = await detectDeltas({
        userId: testUserId,
        sinceTimestamp: null,
        entityTypes: ['FILE'],
      });

      expect(result.deltas).toHaveLength(1);
      expect((result.deltas[0].data as any).requiresContentFetch).toBe(true);
    });
  });

  // ============================================================================
  // countDeltas() Tests
  // ============================================================================

  describe('countDeltas()', () => {
    it('should return counts per entity type', async () => {
      const characters = [
        createMockCharacter({ userId: testUserId }),
        createMockCharacter({ userId: testUserId }),
      ];
      const personas = [createMockPersona({ userId: testUserId })];
      const tags = [
        createMockTag({ userId: testUserId }),
        createMockTag({ userId: testUserId }),
        createMockTag({ userId: testUserId }),
      ];

      mockRepositories.characters.findByUserId.mockResolvedValue(characters);
      mockRepositories.personas.findByUserId.mockResolvedValue(personas);
      mockRepositories.tags.findByUserId.mockResolvedValue(tags);

      const counts = await countDeltas({
        userId: testUserId,
        sinceTimestamp: null,
        entityTypes: ['CHARACTER', 'PERSONA', 'TAG'],
      });

      expect(counts.CHARACTER).toBe(2);
      expect(counts.PERSONA).toBe(1);
      expect(counts.TAG).toBe(3);
    });

    it('should filter by sinceTimestamp', async () => {
      const oldChar = createMockCharacter({
        userId: testUserId,
        updatedAt: threeDaysAgo.toISOString(),
      });
      const newChar = createMockCharacter({
        userId: testUserId,
        updatedAt: oneHourAgo.toISOString(),
      });

      mockRepositories.characters.findByUserId.mockResolvedValue([oldChar, newChar]);

      const counts = await countDeltas({
        userId: testUserId,
        sinceTimestamp: twoHoursAgo.toISOString(),
        entityTypes: ['CHARACTER'],
      });

      expect(counts.CHARACTER).toBe(1);
    });

    it('should handle specific entityTypes parameter', async () => {
      const character = createMockCharacter({ userId: testUserId });
      const persona = createMockPersona({ userId: testUserId });

      mockRepositories.characters.findByUserId.mockResolvedValue([character]);
      mockRepositories.personas.findByUserId.mockResolvedValue([persona]);

      const counts = await countDeltas({
        userId: testUserId,
        sinceTimestamp: null,
        entityTypes: ['CHARACTER'],
      });

      expect(counts.CHARACTER).toBe(1);
      expect(counts.PERSONA).toBeUndefined();
    });

    it('should return zero counts for empty repositories', async () => {
      const counts = await countDeltas({
        userId: testUserId,
        sinceTimestamp: null,
        entityTypes: ['CHARACTER', 'PERSONA', 'TAG'],
      });

      expect(counts.CHARACTER).toBe(0);
      expect(counts.PERSONA).toBe(0);
      expect(counts.TAG).toBe(0);
    });

    it('should count all entity types when no filter provided', async () => {
      const character = createMockCharacter({ userId: testUserId });
      const tag = createMockTag({ userId: testUserId });
      const file = createMockFileEntry({ userId: testUserId });

      mockRepositories.characters.findByUserId.mockResolvedValue([character]);
      mockRepositories.tags.findByUserId.mockResolvedValue([tag]);
      mockRepositories.files.findByUserId.mockResolvedValue([file]);
      mockDownloadUserFile.mockResolvedValue(Buffer.from('content'));

      const counts = await countDeltas({
        userId: testUserId,
        sinceTimestamp: null,
      });

      expect(counts.CHARACTER).toBe(1);
      expect(counts.TAG).toBe(1);
      expect(counts.FILE).toBe(1);
    });
  });

  // ============================================================================
  // getMostRecentUpdate() Tests
  // ============================================================================

  describe('getMostRecentUpdate()', () => {
    it('should return null when no entities exist', async () => {
      const result = await getMostRecentUpdate(testUserId);

      expect(result).toBeNull();
    });

    it('should return the most recent timestamp across all entity types', async () => {
      const oldChar = createMockCharacter({
        userId: testUserId,
        updatedAt: threeDaysAgo.toISOString(),
      });
      const newerPersona = createMockPersona({
        userId: testUserId,
        updatedAt: twoHoursAgo.toISOString(),
      });
      const newestChat = createMockChat({
        userId: testUserId,
        updatedAt: oneHourAgo.toISOString(),
      });

      mockRepositories.characters.findByUserId.mockResolvedValue([oldChar]);
      mockRepositories.personas.findByUserId.mockResolvedValue([newerPersona]);
      mockRepositories.chats.findByUserId.mockResolvedValue([newestChat]);

      const result = await getMostRecentUpdate(testUserId);

      expect(result).toBe(oneHourAgo.toISOString());
    });

    it('should include memories in the check', async () => {
      const character = createMockCharacter({
        userId: testUserId,
        updatedAt: threeDaysAgo.toISOString(),
      });
      const recentMemory = createMockMemory({
        characterId: character.id,
        updatedAt: oneHourAgo.toISOString(),
      });

      mockRepositories.characters.findByUserId.mockResolvedValue([character]);
      mockRepositories.memories.findByCharacterId.mockResolvedValue([recentMemory]);

      const result = await getMostRecentUpdate(testUserId);

      expect(result).toBe(oneHourAgo.toISOString());
    });

    it('should check all entity types for most recent', async () => {
      const tag = createMockTag({
        userId: testUserId,
        updatedAt: threeDaysAgo.toISOString(),
      });
      const file = createMockFileEntry({
        userId: testUserId,
        updatedAt: twoHoursAgo.toISOString(),
      });
      const roleplayTemplate = createMockRoleplayTemplate({
        userId: testUserId,
        updatedAt: oneHourAgo.toISOString(),
      });
      const promptTemplate = createMockPromptTemplate({
        userId: testUserId,
        updatedAt: now.toISOString(),
      });

      mockRepositories.tags.findByUserId.mockResolvedValue([tag]);
      mockRepositories.files.findByUserId.mockResolvedValue([file]);
      mockRepositories.roleplayTemplates.findByUserId.mockResolvedValue([roleplayTemplate]);
      mockRepositories.promptTemplates.findByUserId.mockResolvedValue([promptTemplate]);

      const result = await getMostRecentUpdate(testUserId);

      expect(result).toBe(now.toISOString());
    });

    it('should handle single entity type with data', async () => {
      const tag = createMockTag({
        userId: testUserId,
        updatedAt: oneHourAgo.toISOString(),
      });

      mockRepositories.tags.findByUserId.mockResolvedValue([tag]);

      const result = await getMostRecentUpdate(testUserId);

      expect(result).toBe(oneHourAgo.toISOString());
    });
  });

  // ============================================================================
  // Edge Cases and Error Handling
  // ============================================================================

  describe('edge cases and error handling', () => {
    it('should handle empty userId gracefully', async () => {
      const result = await detectDeltas({
        userId: '',
        sinceTimestamp: null,
        entityTypes: ['CHARACTER'],
      });

      expect(result.deltas).toHaveLength(0);
      expect(result.hasMore).toBe(false);
    });

    it('should propagate repository errors', async () => {
      mockRepositories.characters.findByUserId.mockRejectedValue(
        new Error('Database connection failed')
      );

      await expect(
        detectDeltas({
          userId: testUserId,
          sinceTimestamp: null,
          entityTypes: ['CHARACTER'],
        })
      ).rejects.toThrow('Database connection failed');
    });

    it('should handle undefined sinceTimestamp same as null', async () => {
      const character = createMockCharacter({ userId: testUserId });
      mockRepositories.characters.findByUserId.mockResolvedValue([character]);

      const result = await detectDeltas({
        userId: testUserId,
        entityTypes: ['CHARACTER'],
      });

      expect(result.deltas).toHaveLength(1);
    });

    it('should handle large number of entities with pagination', async () => {
      const characters = Array.from({ length: 500 }, (_, i) =>
        createMockCharacter({
          userId: testUserId,
          name: `Character ${i}`,
          updatedAt: new Date(now.getTime() - i * 1000).toISOString(),
        })
      );

      mockRepositories.characters.findByUserId.mockResolvedValue(characters);

      const result = await detectDeltas({
        userId: testUserId,
        sinceTimestamp: null,
        entityTypes: ['CHARACTER'],
        limit: 100,
      });

      expect(result.deltas).toHaveLength(100);
      expect(result.hasMore).toBe(true);
    });

    it('should include isDeleted=false in delta data', async () => {
      const character = createMockCharacter({ userId: testUserId });
      mockRepositories.characters.findByUserId.mockResolvedValue([character]);

      const result = await detectDeltas({
        userId: testUserId,
        sinceTimestamp: null,
        entityTypes: ['CHARACTER'],
      });

      expect(result.deltas[0].isDeleted).toBe(false);
    });

    it('should include createdAt and updatedAt in delta', async () => {
      const createdAt = threeDaysAgo.toISOString();
      const updatedAt = oneHourAgo.toISOString();
      const character = createMockCharacter({
        userId: testUserId,
        createdAt,
        updatedAt,
      });
      mockRepositories.characters.findByUserId.mockResolvedValue([character]);

      const result = await detectDeltas({
        userId: testUserId,
        sinceTimestamp: null,
        entityTypes: ['CHARACTER'],
      });

      expect(result.deltas[0].createdAt).toBe(createdAt);
      expect(result.deltas[0].updatedAt).toBe(updatedAt);
    });

    it('should include full entity data in delta', async () => {
      const character = createMockCharacter({
        userId: testUserId,
        name: 'Test Character',
        description: 'A test description',
      });
      mockRepositories.characters.findByUserId.mockResolvedValue([character]);

      const result = await detectDeltas({
        userId: testUserId,
        sinceTimestamp: null,
        entityTypes: ['CHARACTER'],
      });

      expect(result.deltas[0].data).toHaveProperty('name', 'Test Character');
      expect(result.deltas[0].data).toHaveProperty('description', 'A test description');
    });
  });

  // ============================================================================
  // Cross-Entity Type Sorting
  // ============================================================================

  describe('cross-entity type sorting', () => {
    it('should sort across multiple entity types by updatedAt', async () => {
      const oldTag = createMockTag({
        userId: testUserId,
        updatedAt: threeDaysAgo.toISOString(),
      });
      const middleChar = createMockCharacter({
        userId: testUserId,
        updatedAt: twoHoursAgo.toISOString(),
      });
      const newPersona = createMockPersona({
        userId: testUserId,
        updatedAt: oneHourAgo.toISOString(),
      });

      mockRepositories.tags.findByUserId.mockResolvedValue([oldTag]);
      mockRepositories.characters.findByUserId.mockResolvedValue([middleChar]);
      mockRepositories.personas.findByUserId.mockResolvedValue([newPersona]);

      const result = await detectDeltas({
        userId: testUserId,
        sinceTimestamp: null,
        entityTypes: ['TAG', 'CHARACTER', 'PERSONA'],
      });

      expect(result.deltas[0].entityType).toBe('TAG');
      expect(result.deltas[1].entityType).toBe('CHARACTER');
      expect(result.deltas[2].entityType).toBe('PERSONA');
    });

    it('should correctly limit and paginate across entity types', async () => {
      // Create entities with known timestamps
      const entities = [];
      for (let i = 0; i < 5; i++) {
        entities.push(
          createMockTag({
            userId: testUserId,
            name: `Tag ${i}`,
            updatedAt: new Date(now.getTime() - (10 - i) * 60000).toISOString(),
          })
        );
      }
      for (let i = 0; i < 5; i++) {
        entities.push(
          createMockCharacter({
            userId: testUserId,
            name: `Character ${i}`,
            updatedAt: new Date(now.getTime() - (5 - i) * 60000).toISOString(),
          })
        );
      }

      mockRepositories.tags.findByUserId.mockResolvedValue(entities.slice(0, 5));
      mockRepositories.characters.findByUserId.mockResolvedValue(entities.slice(5, 10));

      const result = await detectDeltas({
        userId: testUserId,
        sinceTimestamp: null,
        entityTypes: ['TAG', 'CHARACTER'],
        limit: 7,
      });

      expect(result.deltas).toHaveLength(7);
      expect(result.hasMore).toBe(true);
      // First items should be oldest (tags created earlier)
      expect(result.deltas[0].entityType).toBe('TAG');
    });
  });
});
