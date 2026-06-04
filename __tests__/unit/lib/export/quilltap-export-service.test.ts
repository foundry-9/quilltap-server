/**
 * Unit tests for Quilltap Export Service
 *
 * The live `.qtap` export is streamed by `lib/export/ndjson-writer.ts`; this
 * file only retains `previewExport`, so these tests cover the pre-export
 * preview (entity names + optional memory counts) shown in the UI.
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import {
  createMockCharacter,
  createMockChat,
  createMockMemory,
  generateId,
} from '../fixtures/test-factories';
import {
  createMockUserRepositories,
  createMockGlobalRepositories,
  configureFindById,
  configureFindAll,
} from '../fixtures/mock-repositories';

// Mock the repository factory
jest.mock('@/lib/repositories/factory', () => ({
  getUserRepositories: jest.fn(),
  getRepositories: jest.fn(),
}));

// Mock the logger
jest.mock('@/lib/logger', () => ({
  logger: {
    child: jest.fn().mockReturnValue({
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }),
  },
}));

// Import after mocking
import { previewExport } from '@/lib/export/quilltap-export-service';
import { getUserRepositories, getRepositories } from '@/lib/repositories/factory';

describe('quilltap-export-service', () => {
  const mockUserRepos = createMockUserRepositories();
  const mockGlobalRepos = createMockGlobalRepositories();
  const testUserId = generateId();

  beforeEach(() => {
    jest.clearAllMocks();
    (getUserRepositories as jest.Mock).mockReturnValue(mockUserRepos);
    (getRepositories as jest.Mock).mockReturnValue(mockGlobalRepos);
  });

  // ============================================================================
  // previewExport() Tests
  // ============================================================================

  describe('previewExport()', () => {
    it('should preview character export with names and IDs', async () => {
      const characters = [
        createMockCharacter({ userId: testUserId, name: 'Alice' }),
        createMockCharacter({ userId: testUserId, name: 'Bob' }),
      ];
      configureFindAll(mockUserRepos.characters.findAll, characters);
      configureFindById(mockUserRepos.characters.findById, characters);

      const preview = await previewExport(testUserId, {
        type: 'characters',
        scope: 'all',
      });

      expect(preview.type).toBe('characters');
      expect(preview.entities).toHaveLength(2);
      expect(preview.entities[0]).toHaveProperty('id');
      expect(preview.entities[0]).toHaveProperty('name');
      expect(preview.entities.map(e => e.name)).toContain('Alice');
      expect(preview.entities.map(e => e.name)).toContain('Bob');
    });

    it('should include memory count in preview when includeMemories is true', async () => {
      const character = createMockCharacter({ userId: testUserId });
      const memories = [
        createMockMemory({ characterId: character.id }),
        createMockMemory({ characterId: character.id }),
        createMockMemory({ characterId: character.id }),
      ];

      configureFindById(mockUserRepos.characters.findById, [character]);
      mockUserRepos.memories.findByCharacterId.mockResolvedValue(memories);

      const preview = await previewExport(testUserId, {
        type: 'characters',
        scope: 'selected',
        selectedIds: [character.id],
        includeMemories: true,
      });

      expect(preview.memoryCount).toBe(3);
    });

    it('should not include memory count when includeMemories is false', async () => {
      const character = createMockCharacter({ userId: testUserId });
      configureFindById(mockUserRepos.characters.findById, [character]);

      const preview = await previewExport(testUserId, {
        type: 'characters',
        scope: 'selected',
        selectedIds: [character.id],
        includeMemories: false,
      });

      expect(preview.memoryCount).toBeUndefined();
    });

    it('should preview chat export with titles', async () => {
      const chats = [
        createMockChat({ userId: testUserId, title: 'Adventure Chat' }),
        createMockChat({ userId: testUserId, title: 'Romance Chat' }),
      ];
      configureFindAll(mockUserRepos.chats.findAll, chats);
      configureFindById(mockUserRepos.chats.findById, chats);

      const preview = await previewExport(testUserId, {
        type: 'chats',
        scope: 'all',
      });

      expect(preview.type).toBe('chats');
      expect(preview.entities.map(e => e.name)).toContain('Adventure Chat');
      expect(preview.entities.map(e => e.name)).toContain('Romance Chat');
    });

    it('should handle empty results', async () => {
      configureFindAll(mockUserRepos.tags.findAll, []);

      const preview = await previewExport(testUserId, {
        type: 'tags',
        scope: 'all',
      });

      expect(preview.entities).toHaveLength(0);
    });

    it('should only include selected entities', async () => {
      const characters = [
        createMockCharacter({ userId: testUserId, name: 'Selected' }),
        createMockCharacter({ userId: testUserId, name: 'Not Selected' }),
      ];
      configureFindById(mockUserRepos.characters.findById, characters);

      const preview = await previewExport(testUserId, {
        type: 'characters',
        scope: 'selected',
        selectedIds: [characters[0].id],
      });

      expect(preview.entities).toHaveLength(1);
      expect(preview.entities[0].name).toBe('Selected');
    });

    it('should throw for unknown export type', async () => {
      await expect(
        previewExport(testUserId, {
          type: 'unknown-type' as any,
          scope: 'all',
        })
      ).rejects.toThrow('Unknown export type');
    });
  });
});
