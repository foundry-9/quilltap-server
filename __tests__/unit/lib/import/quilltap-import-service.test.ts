/**
 * Unit tests for Quilltap Import Service
 *
 * Tests the import functionality including:
 * - Export file parsing and validation
 * - Import preview generation
 * - Import execution with all three conflict strategies (skip, overwrite, duplicate)
 * - ID remapping and relationship reconciliation
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
  createMockExportedCharacter,
  createMockExportedPersona,
  createMockExportedChat,
  createMockQuilltapExport,
  createMockPersonasExport,
  createMockChatsExport,
  createMockTagsExport,
  createMockConnectionProfilesExport,
  createMockExportManifest,
  createMockSanitizedConnectionProfile,
  generateId,
} from '../fixtures/test-factories';
import {
  createMockUserRepositories,
  createMockGlobalRepositories,
  configureFindById,
  configureFindAll,
  configureCreate,
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
  parseExportFile,
  validateExportFormat,
  previewImport,
  executeImport,
} from '@/lib/import/quilltap-import-service';
import { getUserRepositories, getRepositories } from '@/lib/repositories/factory';

describe('quilltap-import-service', () => {
  const mockUserRepos = createMockUserRepositories();
  const mockGlobalRepos = createMockGlobalRepositories();
  const testUserId = generateId();

  beforeEach(() => {
    jest.clearAllMocks();
    (getUserRepositories as jest.Mock).mockReturnValue(mockUserRepos);
    (getRepositories as jest.Mock).mockReturnValue(mockGlobalRepos);

    // Configure default create behavior to return input with generated ID
    configureCreate(mockUserRepos.characters.create);
    configureCreate(mockUserRepos.personas.create);
    configureCreate(mockUserRepos.chats.create);
    configureCreate(mockUserRepos.tags.create);
    configureCreate(mockUserRepos.memories.create);
    configureCreate(mockUserRepos.connections.create);
    configureCreate(mockUserRepos.imageProfiles.create);
    configureCreate(mockUserRepos.embeddingProfiles.create);
    configureCreate(mockGlobalRepos.roleplayTemplates.create);
  });

  // ============================================================================
  // parseExportFile() Tests
  // ============================================================================

  describe('parseExportFile()', () => {
    it('should parse valid JSON export', () => {
      const exportData = createMockQuilltapExport();
      const jsonString = JSON.stringify(exportData);

      const result = parseExportFile(jsonString);

      expect(result.manifest.format).toBe('quilltap-export');
      expect(result.manifest.version).toBe('1.0');
    });

    it('should throw for invalid JSON', () => {
      const invalidJson = '{ invalid json }';

      expect(() => parseExportFile(invalidJson)).toThrow('Invalid export file');
    });

    it('should throw for non-object JSON', () => {
      const arrayJson = '["not", "an", "object"]';

      expect(() => parseExportFile(arrayJson)).toThrow('Invalid export file');
    });

    it('should throw for null JSON', () => {
      const nullJson = 'null';

      expect(() => parseExportFile(nullJson)).toThrow('Invalid export file');
    });
  });

  // ============================================================================
  // validateExportFormat() Tests
  // ============================================================================

  describe('validateExportFormat()', () => {
    it('should accept valid export format', () => {
      const exportData = createMockQuilltapExport();

      expect(() => validateExportFormat(exportData)).not.toThrow();
    });

    it('should reject missing manifest', () => {
      const data = { data: {} };

      expect(() => validateExportFormat(data)).toThrow('Missing or invalid manifest');
    });

    it('should reject wrong format identifier', () => {
      const data = {
        manifest: { format: 'wrong-format', version: '1.0' },
        data: {},
      };

      expect(() => validateExportFormat(data)).toThrow("Invalid format: expected 'quilltap-export'");
    });

    it('should reject unsupported version', () => {
      const data = {
        manifest: { format: 'quilltap-export', version: '2.0' },
        data: {},
      };

      expect(() => validateExportFormat(data)).toThrow('Unsupported version: 2.0');
    });

    it('should reject missing data section', () => {
      const data = {
        manifest: { format: 'quilltap-export', version: '1.0' },
      };

      expect(() => validateExportFormat(data)).toThrow('Missing or invalid data section');
    });

    it('should reject null input', () => {
      expect(() => validateExportFormat(null)).toThrow('Export data must be a JSON object');
    });

    it('should reject non-object input', () => {
      expect(() => validateExportFormat('string')).toThrow('Export data must be a JSON object');
    });
  });

  // ============================================================================
  // previewImport() Tests
  // ============================================================================

  describe('previewImport()', () => {
    it('should preview character import with conflict detection', async () => {
      const existingChar = createMockCharacter({ userId: testUserId, name: 'Existing' });
      const newChar = createMockExportedCharacter({ name: 'New Character' });
      const exportData = createMockQuilltapExport({
        characters: [
          createMockExportedCharacter({ id: existingChar.id, name: 'Existing' }),
          newChar,
        ],
      });

      configureFindById(mockUserRepos.characters.findById, [existingChar]);

      const preview = await previewImport(testUserId, exportData);

      expect(preview.manifest).toBeDefined();
      expect(preview.entities.characters).toHaveLength(2);
      expect(preview.entities.characters![0].exists).toBe(true);
      expect(preview.entities.characters![1].exists).toBe(false);
      expect(preview.conflictCounts.characters).toBe(1);
    });

    it('should preview persona import', async () => {
      const persona = createMockExportedPersona({ name: 'Test Persona' });
      const exportData = createMockPersonasExport({ personas: [persona] });

      const preview = await previewImport(testUserId, exportData);

      expect(preview.entities.personas).toHaveLength(1);
      expect(preview.entities.personas![0].name).toBe('Test Persona');
      expect(preview.entities.personas![0].exists).toBe(false);
    });

    it('should preview chat import', async () => {
      const chat = createMockExportedChat({ title: 'Adventure Chat' });
      const exportData = createMockChatsExport({ chats: [chat] });

      const preview = await previewImport(testUserId, exportData);

      expect(preview.entities.chats).toHaveLength(1);
      expect(preview.entities.chats![0].name).toBe('Adventure Chat');
    });

    it('should preview tag import', async () => {
      const tag = createMockTag({ name: 'Important' });
      const exportData = createMockTagsExport({ tags: [tag] });

      const preview = await previewImport(testUserId, exportData);

      expect(preview.entities.tags).toHaveLength(1);
      expect(preview.entities.tags![0].name).toBe('Important');
    });

    it('should include memory count in preview', async () => {
      const character = createMockExportedCharacter();
      const memories = [createMockMemory(), createMockMemory()];
      const exportData = createMockQuilltapExport({
        characters: [character],
        memories,
      });

      const preview = await previewImport(testUserId, exportData);

      expect(preview.entities.memories).toBeDefined();
      expect(preview.entities.memories!.count).toBe(2);
    });

    it('should report no conflicts when all entities are new', async () => {
      const exportData = createMockQuilltapExport();

      const preview = await previewImport(testUserId, exportData);

      expect(preview.conflictCounts).toEqual({});
    });
  });

  // ============================================================================
  // executeImport() - Skip Strategy Tests
  // ============================================================================

  describe('executeImport() - skip strategy', () => {
    it('should skip existing entities', async () => {
      const existingChar = createMockCharacter({ userId: testUserId });
      const exportData = createMockQuilltapExport({
        characters: [createMockExportedCharacter({ id: existingChar.id })],
      });

      configureFindById(mockUserRepos.characters.findById, [existingChar]);

      const result = await executeImport(testUserId, exportData, {
        conflictStrategy: 'skip',
        includeMemories: false,
        includeRelatedEntities: false,
      });

      expect(result.success).toBe(true);
      expect(result.skipped.characters).toBe(1);
      expect(result.imported.characters).toBe(0);
      expect(mockUserRepos.characters.create).not.toHaveBeenCalled();
    });

    it('should import new entities', async () => {
      const newChar = createMockExportedCharacter();
      const exportData = createMockQuilltapExport({ characters: [newChar] });

      const result = await executeImport(testUserId, exportData, {
        conflictStrategy: 'skip',
        includeMemories: false,
        includeRelatedEntities: false,
      });

      expect(result.success).toBe(true);
      expect(result.imported.characters).toBe(1);
      expect(mockUserRepos.characters.create).toHaveBeenCalledTimes(1);
    });

    it('should handle mixed existing and new entities', async () => {
      const existingChar = createMockCharacter({ userId: testUserId });
      const newChar = createMockExportedCharacter();
      const exportData = createMockQuilltapExport({
        characters: [
          createMockExportedCharacter({ id: existingChar.id }),
          newChar,
        ],
      });

      configureFindById(mockUserRepos.characters.findById, [existingChar]);

      const result = await executeImport(testUserId, exportData, {
        conflictStrategy: 'skip',
        includeMemories: false,
        includeRelatedEntities: false,
      });

      expect(result.imported.characters).toBe(1);
      expect(result.skipped.characters).toBe(1);
    });

    it('should preserve existing entity data', async () => {
      const existingChar = createMockCharacter({
        userId: testUserId,
        name: 'Original Name',
        description: 'Original Description',
      });
      const exportData = createMockQuilltapExport({
        characters: [
          createMockExportedCharacter({
            id: existingChar.id,
            name: 'New Name',
            description: 'New Description',
          }),
        ],
      });

      configureFindById(mockUserRepos.characters.findById, [existingChar]);

      await executeImport(testUserId, exportData, {
        conflictStrategy: 'skip',
        includeMemories: false,
        includeRelatedEntities: false,
      });

      // Should not update existing character
      expect(mockUserRepos.characters.update).not.toHaveBeenCalled();
    });
  });

  // ============================================================================
  // executeImport() - Overwrite Strategy Tests
  // ============================================================================

  describe('executeImport() - overwrite strategy', () => {
    it('should overwrite existing entities', async () => {
      const existingChar = createMockCharacter({ userId: testUserId, name: 'Old Name' });
      const exportData = createMockQuilltapExport({
        characters: [
          createMockExportedCharacter({ id: existingChar.id, name: 'New Name' }),
        ],
      });

      configureFindById(mockUserRepos.characters.findById, [existingChar]);

      const result = await executeImport(testUserId, exportData, {
        conflictStrategy: 'overwrite',
        includeMemories: false,
        includeRelatedEntities: false,
      });

      expect(result.success).toBe(true);
      expect(result.imported.characters).toBe(1);
      expect(mockUserRepos.characters.delete).toHaveBeenCalledWith(existingChar.id);
      expect(mockUserRepos.characters.create).toHaveBeenCalled();
    });

    it('should delete existing before creating new', async () => {
      const existingChar = createMockCharacter({ userId: testUserId });
      const exportData = createMockQuilltapExport({
        characters: [createMockExportedCharacter({ id: existingChar.id })],
      });

      configureFindById(mockUserRepos.characters.findById, [existingChar]);

      const deleteCall = jest.fn();
      const createCall = jest.fn();

      mockUserRepos.characters.delete.mockImplementation(async () => {
        deleteCall();
        return true;
      });
      mockUserRepos.characters.create.mockImplementation(async (data) => {
        createCall();
        return { ...data, id: existingChar.id } as any;
      });

      await executeImport(testUserId, exportData, {
        conflictStrategy: 'overwrite',
        includeMemories: false,
        includeRelatedEntities: false,
      });

      expect(deleteCall).toHaveBeenCalled();
      expect(createCall).toHaveBeenCalled();
    });

    it('should import new entities without deletion', async () => {
      const newChar = createMockExportedCharacter();
      const exportData = createMockQuilltapExport({ characters: [newChar] });

      const result = await executeImport(testUserId, exportData, {
        conflictStrategy: 'overwrite',
        includeMemories: false,
        includeRelatedEntities: false,
      });

      expect(result.imported.characters).toBe(1);
      expect(mockUserRepos.characters.delete).not.toHaveBeenCalled();
    });
  });

  // ============================================================================
  // executeImport() - Duplicate Strategy Tests
  // ============================================================================

  describe('executeImport() - duplicate strategy', () => {
    it('should create new entities with new IDs', async () => {
      const existingChar = createMockCharacter({ userId: testUserId, name: 'Original' });
      const exportData = createMockQuilltapExport({
        characters: [
          createMockExportedCharacter({ id: existingChar.id, name: 'Original' }),
        ],
      });

      configureFindById(mockUserRepos.characters.findById, [existingChar]);

      const result = await executeImport(testUserId, exportData, {
        conflictStrategy: 'duplicate',
        includeMemories: false,
        includeRelatedEntities: false,
      });

      expect(result.success).toBe(true);
      expect(result.imported.characters).toBe(1);
      expect(mockUserRepos.characters.create).toHaveBeenCalled();

      // Verify name was modified
      const createCall = mockUserRepos.characters.create.mock.calls[0][0];
      expect(createCall.name).toBe('Original (imported)');
    });

    it('should append (imported) suffix to duplicate names', async () => {
      const existingTag = createMockTag({ userId: testUserId, name: 'MyTag' });
      const exportData = createMockTagsExport({
        tags: [createMockTag({ id: existingTag.id, name: 'MyTag' })],
      });

      configureFindById(mockUserRepos.tags.findById, [existingTag]);

      await executeImport(testUserId, exportData, {
        conflictStrategy: 'duplicate',
        includeMemories: false,
        includeRelatedEntities: false,
      });

      const createCall = mockUserRepos.tags.create.mock.calls[0][0];
      expect(createCall.name).toBe('MyTag (imported)');
    });

    it('should preserve original entity unchanged', async () => {
      const existingChar = createMockCharacter({ userId: testUserId });
      const exportData = createMockQuilltapExport({
        characters: [createMockExportedCharacter({ id: existingChar.id })],
      });

      configureFindById(mockUserRepos.characters.findById, [existingChar]);

      await executeImport(testUserId, exportData, {
        conflictStrategy: 'duplicate',
        includeMemories: false,
        includeRelatedEntities: false,
      });

      expect(mockUserRepos.characters.delete).not.toHaveBeenCalled();
      expect(mockUserRepos.characters.update).not.toHaveBeenCalled();
    });

    it('should import new entities normally', async () => {
      const newChar = createMockExportedCharacter({ name: 'Brand New' });
      const exportData = createMockQuilltapExport({ characters: [newChar] });

      await executeImport(testUserId, exportData, {
        conflictStrategy: 'duplicate',
        includeMemories: false,
        includeRelatedEntities: false,
      });

      const createCall = mockUserRepos.characters.create.mock.calls[0][0];
      expect(createCall.name).toBe('Brand New');
    });
  });

  // ============================================================================
  // executeImport() - Connection Profile Tests
  // ============================================================================

  describe('executeImport() - connection profiles', () => {
    it('should import connection profiles without API keys', async () => {
      const profile = createMockSanitizedConnectionProfile({
        name: 'My Profile',
        _apiKeyLabel: 'Old API Key',
      });
      const exportData = createMockConnectionProfilesExport({
        connectionProfiles: [profile],
      });

      await executeImport(testUserId, exportData, {
        conflictStrategy: 'skip',
        includeMemories: false,
        includeRelatedEntities: false,
      });

      expect(mockUserRepos.connections.create).toHaveBeenCalled();

      const createCall = mockUserRepos.connections.create.mock.calls[0][0];
      expect(createCall.apiKeyId).toBeNull();
    });
  });

  // ============================================================================
  // executeImport() - Memory Import Tests
  // ============================================================================

  describe('executeImport() - memories', () => {
    it('should import memories when includeMemories is true', async () => {
      const character = createMockExportedCharacter();
      const memories = [
        createMockMemory({ characterId: character.id }),
        createMockMemory({ characterId: character.id }),
      ];
      const exportData = createMockQuilltapExport({
        characters: [character],
        memories,
      });

      // Make sure the character create returns something with the character id
      mockUserRepos.characters.create.mockImplementation(async (data) => ({
        ...data,
        id: character.id,
      }) as any);

      const result = await executeImport(testUserId, exportData, {
        conflictStrategy: 'skip',
        includeMemories: true,
        includeRelatedEntities: false,
      });

      expect(result.imported.memories).toBe(2);
      expect(mockUserRepos.memories.create).toHaveBeenCalledTimes(2);
    });

    it('should not import memories when includeMemories is false', async () => {
      const character = createMockExportedCharacter();
      const memories = [createMockMemory({ characterId: character.id })];
      const exportData = createMockQuilltapExport({
        characters: [character],
        memories,
      });

      const result = await executeImport(testUserId, exportData, {
        conflictStrategy: 'skip',
        includeMemories: false,
        includeRelatedEntities: false,
      });

      expect(result.imported.memories).toBe(0);
      expect(mockUserRepos.memories.create).not.toHaveBeenCalled();
    });

    it('should skip memories with missing character reference', async () => {
      const memory = createMockMemory({ characterId: 'non-existent-char' });
      const exportData = createMockQuilltapExport({
        characters: [],
        memories: [memory],
      });

      const result = await executeImport(testUserId, exportData, {
        conflictStrategy: 'skip',
        includeMemories: true,
        includeRelatedEntities: false,
      });

      expect(result.skipped.memories).toBe(1);
      expect(result.warnings).toContainEqual(
        expect.stringContaining('non-existent character')
      );
    });
  });

  // ============================================================================
  // executeImport() - Import Order Tests
  // ============================================================================

  describe('executeImport() - import order', () => {
    it('should import tags before characters (dependency order)', async () => {
      const tag = createMockTag({ name: 'TestTag' });
      const character = createMockExportedCharacter({ tags: [tag.id] });
      const exportData = {
        manifest: createMockExportManifest({ exportType: 'characters' }),
        data: {
          characters: [character],
          tags: [tag],
        },
      };

      const importOrder: string[] = [];
      mockUserRepos.tags.create.mockImplementation(async (data) => {
        importOrder.push('tag');
        return { ...data, id: tag.id } as any;
      });
      mockUserRepos.characters.create.mockImplementation(async (data) => {
        importOrder.push('character');
        return { ...data, id: character.id } as any;
      });

      await executeImport(testUserId, exportData as any, {
        conflictStrategy: 'skip',
        includeMemories: false,
        includeRelatedEntities: false,
      });

      expect(importOrder.indexOf('tag')).toBeLessThan(importOrder.indexOf('character'));
    });

    it('should import connection profiles before characters', async () => {
      const profile = createMockSanitizedConnectionProfile();
      const character = createMockExportedCharacter({
        defaultConnectionProfileId: profile.id,
      });
      const exportData = {
        manifest: createMockExportManifest({ exportType: 'characters' }),
        data: {
          characters: [character],
          connectionProfiles: [profile],
        },
      };

      const importOrder: string[] = [];
      mockUserRepos.connections.create.mockImplementation(async (data) => {
        importOrder.push('profile');
        return { ...data, id: profile.id } as any;
      });
      mockUserRepos.characters.create.mockImplementation(async (data) => {
        importOrder.push('character');
        return { ...data, id: character.id } as any;
      });

      await executeImport(testUserId, exportData as any, {
        conflictStrategy: 'skip',
        includeMemories: false,
        includeRelatedEntities: false,
      });

      expect(importOrder.indexOf('profile')).toBeLessThan(importOrder.indexOf('character'));
    });
  });

  // ============================================================================
  // executeImport() - Chat with Messages Tests
  // ============================================================================

  describe('executeImport() - chats with messages', () => {
    it('should import chat messages', async () => {
      const messages = [
        createMockMessage({ role: 'USER', content: 'Hello' }),
        createMockMessage({ role: 'ASSISTANT', content: 'Hi there!' }),
      ];
      const chat = createMockExportedChat({ title: 'Test Chat', messages });
      const exportData = createMockChatsExport({ chats: [chat] });

      mockUserRepos.chats.create.mockImplementation(async (data) => ({
        ...data,
        id: chat.id,
      }) as any);

      const result = await executeImport(testUserId, exportData, {
        conflictStrategy: 'skip',
        includeMemories: false,
        includeRelatedEntities: false,
      });

      expect(result.imported.chats).toBe(1);
      expect(result.imported.messages).toBe(2);
      expect(mockUserRepos.chats.addMessage).toHaveBeenCalledTimes(2);
    });

    it('should handle message import errors gracefully', async () => {
      const chat = createMockExportedChat({
        messages: [createMockMessage()],
      });
      const exportData = createMockChatsExport({ chats: [chat] });

      mockUserRepos.chats.create.mockImplementation(async (data) => ({
        ...data,
        id: chat.id,
      }) as any);
      mockUserRepos.chats.addMessage.mockRejectedValue(new Error('Message error'));

      const result = await executeImport(testUserId, exportData, {
        conflictStrategy: 'skip',
        includeMemories: false,
        includeRelatedEntities: false,
      });

      expect(result.warnings).toContainEqual(
        expect.stringContaining('Failed to import message')
      );
    });
  });

  // ============================================================================
  // executeImport() - Result Structure Tests
  // ============================================================================

  describe('executeImport() - result structure', () => {
    it('should return success status', async () => {
      const exportData = createMockQuilltapExport();

      const result = await executeImport(testUserId, exportData, {
        conflictStrategy: 'skip',
        includeMemories: false,
        includeRelatedEntities: false,
      });

      expect(result).toHaveProperty('success');
      expect(result).toHaveProperty('imported');
      expect(result).toHaveProperty('skipped');
      expect(result).toHaveProperty('warnings');
    });

    it('should return accurate imported counts', async () => {
      const exportData = createMockQuilltapExport({
        characters: [
          createMockExportedCharacter(),
          createMockExportedCharacter(),
          createMockExportedCharacter(),
        ],
      });

      const result = await executeImport(testUserId, exportData, {
        conflictStrategy: 'skip',
        includeMemories: false,
        includeRelatedEntities: false,
      });

      expect(result.imported.characters).toBe(3);
    });

    it('should return accurate skipped counts', async () => {
      const existingChars = [
        createMockCharacter({ userId: testUserId }),
        createMockCharacter({ userId: testUserId }),
      ];
      const exportData = createMockQuilltapExport({
        characters: existingChars.map((c) =>
          createMockExportedCharacter({ id: c.id })
        ),
      });

      configureFindById(mockUserRepos.characters.findById, existingChars);

      const result = await executeImport(testUserId, exportData, {
        conflictStrategy: 'skip',
        includeMemories: false,
        includeRelatedEntities: false,
      });

      expect(result.skipped.characters).toBe(2);
    });

    it('should return warnings array', async () => {
      const exportData = createMockQuilltapExport();

      const result = await executeImport(testUserId, exportData, {
        conflictStrategy: 'skip',
        includeMemories: false,
        includeRelatedEntities: false,
      });

      expect(Array.isArray(result.warnings)).toBe(true);
    });
  });

  // ============================================================================
  // executeImport() - Error Handling Tests
  // ============================================================================

  describe('executeImport() - error handling', () => {
    it('should continue after individual entity failures', async () => {
      const chars = [
        createMockExportedCharacter({ name: 'Good Character' }),
        createMockExportedCharacter({ name: 'Bad Character' }),
        createMockExportedCharacter({ name: 'Another Good' }),
      ];
      const exportData = createMockQuilltapExport({ characters: chars });

      let callCount = 0;
      mockUserRepos.characters.create.mockImplementation(async (data) => {
        callCount++;
        if ((data as any).name === 'Bad Character') {
          throw new Error('Database error');
        }
        return { ...data, id: generateId() } as any;
      });

      const result = await executeImport(testUserId, exportData, {
        conflictStrategy: 'skip',
        includeMemories: false,
        includeRelatedEntities: false,
      });

      // Should have attempted all three
      expect(callCount).toBe(3);
      expect(result.imported.characters).toBe(2);
      expect(result.warnings).toContainEqual(
        expect.stringContaining('Bad Character')
      );
    });

    it('should handle and report import failures in warnings', async () => {
      // The import service is designed to be resilient - it catches individual
      // errors and continues. Test that individual failures are properly reported.
      const exportData = createMockQuilltapExport({
        characters: [createMockExportedCharacter({ name: 'Failing Character' })],
      });

      // All character creates fail
      mockUserRepos.characters.create.mockRejectedValue(
        new Error('Critical database failure')
      );

      const result = await executeImport(testUserId, exportData, {
        conflictStrategy: 'skip',
        includeMemories: false,
        includeRelatedEntities: false,
      });

      // Import still "succeeds" overall but with warnings
      expect(result.success).toBe(true);
      expect(result.imported.characters).toBe(0);
      expect(result.warnings).toContainEqual(
        expect.stringContaining('Failing Character')
      );
    });
  });

  // ============================================================================
  // executeImport() - Empty Import Tests
  // ============================================================================

  describe('executeImport() - empty imports', () => {
    it('should handle empty character export', async () => {
      const exportData = createMockQuilltapExport({ characters: [] });

      const result = await executeImport(testUserId, exportData, {
        conflictStrategy: 'skip',
        includeMemories: false,
        includeRelatedEntities: false,
      });

      expect(result.success).toBe(true);
      expect(result.imported.characters).toBe(0);
    });

    it('should handle export with characters and memories', async () => {
      const characterId = generateId();
      const character = createMockExportedCharacter({ id: characterId });
      const memories = [
        createMockMemory({ characterId: characterId }),
      ];
      const exportData = createMockQuilltapExport({
        characters: [character],
        memories,
      });

      // Important: the create mock must return the entity with an ID that matches
      // what we put in the idMaps, so the memory import can find its character
      mockUserRepos.characters.create.mockImplementation(async (data) => {
        // Return with a NEW id (which is what the import does)
        const newId = generateId();
        return { ...data, id: newId } as any;
      });

      const result = await executeImport(testUserId, exportData, {
        conflictStrategy: 'skip',
        includeMemories: true,
        includeRelatedEntities: false,
      });

      expect(result.success).toBe(true);
      // The memory should be imported because the character was imported
      // and its new ID was mapped
      expect(result.imported.memories).toBe(1);
    });
  });
});
