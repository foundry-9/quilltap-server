/**
 * Unit tests for Quilltap Export Service
 *
 * Tests the export functionality including:
 * - Profile sanitization (security critical - removes API keys)
 * - Tag name resolution
 * - Export creation for all entity types
 * - Export preview generation
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import {
  createMockCharacter,
  createMockPersona,
  createMockChat,
  createMockTag,
  createMockMemory,
  createMockConnectionProfile,
  createMockImageProfile,
  createMockEmbeddingProfile,
  createMockRoleplayTemplate,
  createMockMessage,
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
import {
  createExport,
  previewExport,
  generateExportFilename,
} from '@/lib/export/quilltap-export-service';
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
  // generateExportFilename() Tests
  // ============================================================================

  describe('generateExportFilename()', () => {
    it('should generate filename with type and timestamp', () => {
      const filename = generateExportFilename('characters');
      expect(filename).toMatch(/^quilltap-characters-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}.*\.qtap$/);
    });

    it('should generate different filenames for different types', () => {
      const charFilename = generateExportFilename('characters');
      const tagFilename = generateExportFilename('tags');

      expect(charFilename).toContain('characters');
      expect(tagFilename).toContain('tags');
    });

    it('should use .qtap extension', () => {
      const filename = generateExportFilename('tags');
      expect(filename.endsWith('.qtap')).toBe(true);
    });
  });

  // ============================================================================
  // createExport() - Character Tests
  // ============================================================================

  describe('createExport() - characters', () => {
    it('should export selected characters', async () => {
      const character = createMockCharacter({ userId: testUserId });
      configureFindById(mockUserRepos.characters.findById, [character]);

      const result = await createExport(testUserId, {
        type: 'characters',
        scope: 'selected',
        selectedIds: [character.id],
        includeMemories: false,
      });

      expect(result.manifest.format).toBe('quilltap-export');
      expect(result.manifest.version).toBe('1.0');
      expect(result.manifest.exportType).toBe('characters');
      expect(result.manifest.counts.characters).toBe(1);
      expect(result.data).toHaveProperty('characters');
      expect((result.data as any).characters).toHaveLength(1);
      expect((result.data as any).characters[0].id).toBe(character.id);
    });

    it('should export all characters when scope is all', async () => {
      const characters = [
        createMockCharacter({ userId: testUserId, name: 'Character 1' }),
        createMockCharacter({ userId: testUserId, name: 'Character 2' }),
      ];
      configureFindAll(mockUserRepos.characters.findAll, characters);
      configureFindById(mockUserRepos.characters.findById, characters);

      const result = await createExport(testUserId, {
        type: 'characters',
        scope: 'all',
        includeMemories: false,
      });

      expect(result.manifest.counts.characters).toBe(2);
      expect((result.data as any).characters).toHaveLength(2);
    });

    it('should include memories when includeMemories is true', async () => {
      const character = createMockCharacter({ userId: testUserId });
      const memories = [
        createMockMemory({ characterId: character.id }),
        createMockMemory({ characterId: character.id }),
      ];

      configureFindById(mockUserRepos.characters.findById, [character]);
      mockUserRepos.memories.findByCharacterId.mockResolvedValue(memories);

      const result = await createExport(testUserId, {
        type: 'characters',
        scope: 'selected',
        selectedIds: [character.id],
        includeMemories: true,
      });

      expect(result.manifest.counts.memories).toBe(2);
      expect((result.data as any).memories).toHaveLength(2);
    });

    it('should resolve tag names for characters', async () => {
      const tag = createMockTag({ userId: testUserId, name: 'Important' });
      const character = createMockCharacter({
        userId: testUserId,
        tags: [tag.id],
      });

      configureFindById(mockUserRepos.characters.findById, [character]);
      configureFindById(mockUserRepos.tags.findById, [tag]);

      const result = await createExport(testUserId, {
        type: 'characters',
        scope: 'selected',
        selectedIds: [character.id],
        includeMemories: false,
      });

      const exportedChar = (result.data as any).characters[0];
      expect(exportedChar._tagNames).toEqual(['Important']);
    });

    it('should skip characters that do not exist', async () => {
      const character = createMockCharacter({ userId: testUserId });
      configureFindById(mockUserRepos.characters.findById, [character]);

      const result = await createExport(testUserId, {
        type: 'characters',
        scope: 'selected',
        selectedIds: [character.id, 'non-existent-id'],
        includeMemories: false,
      });

      expect(result.manifest.counts.characters).toBe(1);
    });

    it('should handle empty selection', async () => {
      const result = await createExport(testUserId, {
        type: 'characters',
        scope: 'selected',
        selectedIds: [],
        includeMemories: false,
      });

      expect(result.manifest.counts.characters).toBe(0);
      expect((result.data as any).characters).toHaveLength(0);
    });
  });

  // ============================================================================
  // createExport() - Chat Tests
  // ============================================================================

  describe('createExport() - chats', () => {
    it('should export chats with messages', async () => {
      const chat = createMockChat({ userId: testUserId, title: 'Test Chat' });
      const messages = [
        createMockMessage({ role: 'USER', content: 'Hello' }),
        createMockMessage({ role: 'ASSISTANT', content: 'Hi there!' }),
      ];

      configureFindById(mockUserRepos.chats.findById, [chat]);
      mockUserRepos.chats.getMessages.mockResolvedValue(messages);

      const result = await createExport(testUserId, {
        type: 'chats',
        scope: 'selected',
        selectedIds: [chat.id],
        includeMemories: false,
      });

      expect(result.manifest.exportType).toBe('chats');
      expect(result.manifest.counts.chats).toBe(1);
      expect((result.data as any).chats[0].messages).toHaveLength(2);
    });

    it('should resolve participant info for chats', async () => {
      const character = createMockCharacter({ userId: testUserId, name: 'Chat Character' });
      const chat = createMockChat({
        userId: testUserId,
        participants: [
          {
            id: generateId(),
            type: 'CHARACTER',
            characterId: character.id,
            connectionProfileId: generateId(),
            imageProfileId: null,
            roleplayTemplateId: null,

            selectedSystemPromptId: null,
            displayOrder: 0,
            isActive: true,
            hasHistoryAccess: false,
            joinScenario: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ],
      });

      configureFindById(mockUserRepos.chats.findById, [chat]);
      configureFindById(mockUserRepos.characters.findById, [character]);
      mockUserRepos.chats.getMessages.mockResolvedValue([]);

      const result = await createExport(testUserId, {
        type: 'chats',
        scope: 'selected',
        selectedIds: [chat.id],
        includeMemories: false,
      });

      const exportedChat = (result.data as any).chats[0];
      expect(exportedChat._participantInfo).toBeDefined();
      expect(exportedChat._participantInfo[0].characterName).toBe('Chat Character');
    });
  });

  // ============================================================================
  // createExport() - Connection Profile Tests (Security Critical)
  // ============================================================================

  describe('createExport() - connection-profiles', () => {
    it('should sanitize API key from connection profiles', async () => {
      const apiKeyId = generateId();
      const profile = createMockConnectionProfile({
        userId: testUserId,
        apiKeyId,
        name: 'My OpenAI Profile',
      });

      configureFindById(mockUserRepos.connections.findById, [profile]);
      mockUserRepos.connections.findApiKeyById.mockResolvedValue({
        id: apiKeyId,
        label: 'My API Key',
        userId: testUserId,
        provider: 'openai',
        ciphertext: 'encrypted',
        iv: 'iv',
        authTag: 'tag',
        isActive: true,
        lastUsed: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      const result = await createExport(testUserId, {
        type: 'connection-profiles',
        scope: 'selected',
        selectedIds: [profile.id],
      });

      const exportedProfile = (result.data as any).connectionProfiles[0];

      // CRITICAL: apiKeyId must NOT be in the exported profile
      expect(exportedProfile).not.toHaveProperty('apiKeyId');

      // Should have the API key label instead
      expect(exportedProfile._apiKeyLabel).toBe('My API Key');

      // Other fields should be preserved
      expect(exportedProfile.name).toBe('My OpenAI Profile');
      expect(exportedProfile.provider).toBe('openai');
    });

    it('should handle profiles without API keys', async () => {
      const profile = createMockConnectionProfile({
        userId: testUserId,
        apiKeyId: null,
      });

      configureFindById(mockUserRepos.connections.findById, [profile]);

      const result = await createExport(testUserId, {
        type: 'connection-profiles',
        scope: 'selected',
        selectedIds: [profile.id],
      });

      const exportedProfile = (result.data as any).connectionProfiles[0];
      expect(exportedProfile).not.toHaveProperty('apiKeyId');
      expect(exportedProfile._apiKeyLabel).toBeUndefined();
    });

    it('should not mutate original profile object', async () => {
      const apiKeyId = generateId();
      const profile = createMockConnectionProfile({
        userId: testUserId,
        apiKeyId,
      });
      const originalApiKeyId = profile.apiKeyId;

      configureFindById(mockUserRepos.connections.findById, [profile]);

      await createExport(testUserId, {
        type: 'connection-profiles',
        scope: 'selected',
        selectedIds: [profile.id],
      });

      // Original profile should still have apiKeyId
      expect(profile.apiKeyId).toBe(originalApiKeyId);
    });
  });

  // ============================================================================
  // createExport() - Image Profile Tests (Security Critical)
  // ============================================================================

  describe('createExport() - image-profiles', () => {
    it('should sanitize API key from image profiles', async () => {
      const apiKeyId = generateId();
      const profile = createMockImageProfile({
        userId: testUserId,
        apiKeyId,
        name: 'DALL-E Profile',
      });

      configureFindById(mockUserRepos.imageProfiles.findById, [profile]);
      mockUserRepos.connections.findApiKeyById.mockResolvedValue({
        id: apiKeyId,
        label: 'Image API Key',
        userId: testUserId,
        provider: 'openai',
        ciphertext: 'encrypted',
        iv: 'iv',
        authTag: 'tag',
        isActive: true,
        lastUsed: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      const result = await createExport(testUserId, {
        type: 'image-profiles',
        scope: 'selected',
        selectedIds: [profile.id],
      });

      const exportedProfile = (result.data as any).imageProfiles[0];
      expect(exportedProfile).not.toHaveProperty('apiKeyId');
    });
  });

  // ============================================================================
  // createExport() - Embedding Profile Tests (Security Critical)
  // ============================================================================

  describe('createExport() - embedding-profiles', () => {
    it('should sanitize API key from embedding profiles', async () => {
      const apiKeyId = generateId();
      const profile = createMockEmbeddingProfile({
        userId: testUserId,
        apiKeyId,
        name: 'Embedding Profile',
      });

      configureFindById(mockUserRepos.embeddingProfiles.findById, [profile]);
      mockUserRepos.connections.findApiKeyById.mockResolvedValue({
        id: apiKeyId,
        label: 'Embedding API Key',
        userId: testUserId,
        provider: 'OPENAI',
        ciphertext: 'encrypted',
        iv: 'iv',
        authTag: 'tag',
        isActive: true,
        lastUsed: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      const result = await createExport(testUserId, {
        type: 'embedding-profiles',
        scope: 'selected',
        selectedIds: [profile.id],
      });

      const exportedProfile = (result.data as any).embeddingProfiles[0];
      expect(exportedProfile).not.toHaveProperty('apiKeyId');
      expect(exportedProfile._apiKeyLabel).toBe('Embedding API Key');
    });
  });

  // ============================================================================
  // createExport() - Roleplay Template Tests
  // ============================================================================

  describe('createExport() - roleplay-templates', () => {
    it('should export user-created roleplay templates', async () => {
      const template = createMockRoleplayTemplate({
        userId: testUserId,
        name: 'My Template',
        isBuiltIn: false,
        pluginName: null,
      });

      configureFindAll(mockGlobalRepos.roleplayTemplates.findAll, [template]);
      configureFindById(mockGlobalRepos.roleplayTemplates.findById, [template]);

      const result = await createExport(testUserId, {
        type: 'roleplay-templates',
        scope: 'selected',
        selectedIds: [template.id],
      });

      // Count key uses the export type directly (kebab-case)
      expect(result.manifest.counts['roleplay-templates']).toBe(1);
    });

    it('should exclude built-in templates', async () => {
      const builtInTemplate = createMockRoleplayTemplate({
        userId: null,
        isBuiltIn: true,
      });
      const userTemplate = createMockRoleplayTemplate({
        userId: testUserId,
        isBuiltIn: false,
      });

      configureFindAll(mockGlobalRepos.roleplayTemplates.findAll, [builtInTemplate, userTemplate]);
      configureFindById(mockGlobalRepos.roleplayTemplates.findById, [builtInTemplate, userTemplate]);

      const result = await createExport(testUserId, {
        type: 'roleplay-templates',
        scope: 'all',
      });

      // Count key uses the export type directly (kebab-case)
      expect(result.manifest.counts['roleplay-templates']).toBe(1);
    });

    it('should exclude plugin-provided templates', async () => {
      const pluginTemplate = createMockRoleplayTemplate({
        userId: testUserId,
        pluginName: 'some-plugin',
        isBuiltIn: false,
      });

      configureFindAll(mockGlobalRepos.roleplayTemplates.findAll, [pluginTemplate]);

      const result = await createExport(testUserId, {
        type: 'roleplay-templates',
        scope: 'all',
      });

      // Count key uses the export type directly (kebab-case)
      expect(result.manifest.counts['roleplay-templates']).toBe(0);
    });
  });

  // ============================================================================
  // createExport() - Tags Tests
  // ============================================================================

  describe('createExport() - tags', () => {
    it('should export selected tags', async () => {
      const tag = createMockTag({ userId: testUserId, name: 'My Tag' });
      configureFindById(mockUserRepos.tags.findById, [tag]);

      const result = await createExport(testUserId, {
        type: 'tags',
        scope: 'selected',
        selectedIds: [tag.id],
      });

      expect(result.manifest.exportType).toBe('tags');
      expect(result.manifest.counts.tags).toBe(1);
      expect((result.data as any).tags[0].name).toBe('My Tag');
    });

    it('should export all tags when scope is all', async () => {
      const tags = [
        createMockTag({ userId: testUserId, name: 'Tag 1' }),
        createMockTag({ userId: testUserId, name: 'Tag 2' }),
        createMockTag({ userId: testUserId, name: 'Tag 3' }),
      ];
      configureFindAll(mockUserRepos.tags.findAll, tags);
      configureFindById(mockUserRepos.tags.findById, tags);

      const result = await createExport(testUserId, {
        type: 'tags',
        scope: 'all',
      });

      expect(result.manifest.counts.tags).toBe(3);
    });
  });

  // ============================================================================
  // createExport() - Error Handling
  // ============================================================================

  describe('createExport() - error handling', () => {
    it('should throw for unknown export type', async () => {
      await expect(
        createExport(testUserId, {
          type: 'unknown-type' as any,
          scope: 'all',
        })
      ).rejects.toThrow('Unknown export type');
    });

    it('should propagate repository errors', async () => {
      mockUserRepos.characters.findAll.mockRejectedValue(new Error('Database error'));

      await expect(
        createExport(testUserId, {
          type: 'characters',
          scope: 'all',
        })
      ).rejects.toThrow('Database error');
    });
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
  });

  // ============================================================================
  // Manifest Tests
  // ============================================================================

  describe('Export manifest', () => {
    it('should include correct format identifier', async () => {
      const character = createMockCharacter({ userId: testUserId });
      configureFindById(mockUserRepos.characters.findById, [character]);

      const result = await createExport(testUserId, {
        type: 'characters',
        scope: 'selected',
        selectedIds: [character.id],
      });

      expect(result.manifest.format).toBe('quilltap-export');
    });

    it('should include version 1.0', async () => {
      const tag = createMockTag({ userId: testUserId });
      configureFindById(mockUserRepos.tags.findById, [tag]);

      const result = await createExport(testUserId, {
        type: 'tags',
        scope: 'selected',
        selectedIds: [tag.id],
      });

      expect(result.manifest.version).toBe('1.0');
    });

    it('should include app version', async () => {
      const tag = createMockTag({ userId: testUserId });
      configureFindById(mockUserRepos.tags.findById, [tag]);

      const result = await createExport(testUserId, {
        type: 'tags',
        scope: 'selected',
        selectedIds: [tag.id],
      });

      expect(result.manifest.appVersion).toBeDefined();
      expect(result.manifest.appVersion).toMatch(/^\d+\.\d+\.\d+/);
    });

    it('should include createdAt timestamp', async () => {
      const tag = createMockTag({ userId: testUserId });
      configureFindById(mockUserRepos.tags.findById, [tag]);

      const before = new Date().toISOString();
      const result = await createExport(testUserId, {
        type: 'tags',
        scope: 'selected',
        selectedIds: [tag.id],
      });
      const after = new Date().toISOString();

      expect(result.manifest.createdAt).toBeDefined();
      expect(result.manifest.createdAt >= before).toBe(true);
      expect(result.manifest.createdAt <= after).toBe(true);
    });

    it('should include export settings in manifest', async () => {
      const tag = createMockTag({ userId: testUserId });
      configureFindById(mockUserRepos.tags.findById, [tag]);

      const result = await createExport(testUserId, {
        type: 'tags',
        scope: 'selected',
        selectedIds: [tag.id],
        includeMemories: true,
      });

      expect(result.manifest.settings.scope).toBe('selected');
      expect(result.manifest.settings.selectedIds).toContain(tag.id);
      expect(result.manifest.settings.includeMemories).toBe(true);
    });
  });
});
