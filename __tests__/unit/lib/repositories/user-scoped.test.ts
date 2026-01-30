/**
 * Unit Tests for User-Scoped Repositories
 * Tests lib/repositories/user-scoped.ts
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import type {
  Character,
  ChatMetadata,
  Tag,
  ConnectionProfile,
  ImageProfile,
  EmbeddingProfile,
  Memory,
  FileEntry,
  ApiKey,
  Project,
  ChatEvent,
} from '@/lib/schemas/types';

// Module-level mocks
const mockLogger = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};

// Mock factory - This needs to be extensive as we test the wrappers
const mockFactoryRepos = {
  characters: {
    findById: jest.fn(),
    findByUserId: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    findByTag: jest.fn(),
    addTag: jest.fn(),
    removeTag: jest.fn(),
    setFavorite: jest.fn(),
    addDescription: jest.fn(),
    updateDescription: jest.fn(),
    removeDescription: jest.fn(),
    getDescription: jest.fn(),
    getDescriptions: jest.fn(),
    addPersona: jest.fn(),
    removePersona: jest.fn(),
  },
  chats: {
    findById: jest.fn(),
    findByUserId: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    findByTag: jest.fn(),
    addTag: jest.fn(),
    removeTag: jest.fn(),
    findByCharacterId: jest.fn(),
    getMessages: jest.fn(),
    addMessage: jest.fn(),
    clearMessages: jest.fn(),
  },
  tags: {
    findById: jest.fn(),
    findByUserId: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    findByName: jest.fn(),
  },
  connections: {
    findById: jest.fn(),
    findByUserId: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    findByTag: jest.fn(),
    addTag: jest.fn(),
    removeTag: jest.fn(),
    findDefault: jest.fn(),
    getApiKeysByUserId: jest.fn(),
    findApiKeyByIdAndUserId: jest.fn(),
    createApiKey: jest.fn(),
    updateApiKey: jest.fn(),
    deleteApiKey: jest.fn(),
    recordApiKeyUsage: jest.fn(),
  },
  imageProfiles: {
    findById: jest.fn(),
    findByUserId: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    findDefault: jest.fn(),
  },
  embeddingProfiles: {
    findById: jest.fn(),
    findByUserId: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    findDefault: jest.fn(),
  },
  memories: {
    findById: jest.fn(),
    findByCharacterId: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    searchByContent: jest.fn(),
    findByImportance: jest.fn(),
    findBySource: jest.fn(),
  },
  files: {
    findById: jest.fn(),
    findByUserId: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    findByTag: jest.fn(),
    addTag: jest.fn(),
    removeTag: jest.fn(),
    findBySha256: jest.fn(),
    findByCategory: jest.fn(),
    findByLinkedTo: jest.fn(),
    addLink: jest.fn(),
    removeLink: jest.fn(),
  },
  projects: {
    findById: jest.fn(),
    findByUserId: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    findByCharacterId: jest.fn(),
    addToRoster: jest.fn(),
    addManyToRoster: jest.fn(),
    removeFromRoster: jest.fn(),
    canCharacterParticipate: jest.fn(),
    setAllowAnyCharacter: jest.fn(),
  },
};

const mockGetRepositoriesSafe = jest.fn(async () => mockFactoryRepos);

//Test data
const TEST_USER_ID = 'user-123';
const TEST_USER_ID_2 = 'user-456';
const TEST_CHAR_ID = 'char-123';
const TEST_CHAT_ID = 'chat-123';
const TEST_TAG_ID = 'tag-123';

const makeCharacter = (overrides: Partial<Character> = {}): Character => ({
  id: TEST_CHAR_ID,
  userId: TEST_USER_ID,
  name: 'Test Character',
  description: 'A test character',
  tags: [],
  personaIds: [],
  isFavorite: false,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  ...overrides,
} as Character);

const makeChat = (overrides: Partial<ChatMetadata> = {}): ChatMetadata => ({
  id: TEST_CHAT_ID,
  userId: TEST_USER_ID,
  characterIds: [TEST_CHAR_ID],
  name: 'Test Chat',
  tags: [],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  ...overrides,
} as ChatMetadata);

const makeTag = (overrides: Partial<Tag> = {}): Tag => ({
  id: TEST_TAG_ID,
  userId: TEST_USER_ID,
  name: 'Test Tag',
  color: '#ff0000',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  ...overrides,
} as Tag);

describe('User-Scoped Repositories', () => {
  let userScoped: typeof import('@/lib/repositories/user-scoped');

  beforeEach(async () => {
    jest.clearAllMocks();
    jest.resetModules();
    
    // Set up mocks
    jest.doMock('@/lib/logger', () => ({ logger: mockLogger }));
    jest.doMock('@/lib/repositories/factory', () => ({
      getRepositories: jest.fn(() => mockFactoryRepos),
      getRepositoriesSafe: mockGetRepositoriesSafe,
    }));

    // Import module fresh after mocks
    userScoped = await import('@/lib/repositories/user-scoped');
  });

  describe('getUserRepositories', () => {
    it('creates user-scoped repository container', () => {
      const repos = userScoped.getUserRepositories(TEST_USER_ID);
      
      expect(repos.userId).toBe(TEST_USER_ID);
      expect(repos.characters).toBeDefined();
      expect(repos.chats).toBeDefined();
      expect(repos.tags).toBeDefined();
      expect(repos.connections).toBeDefined();
      expect(repos.imageProfiles).toBeDefined();
      expect(repos.embeddingProfiles).toBeDefined();
      expect(repos.memories).toBeDefined();
      expect(repos.files).toBeDefined();
      expect(repos.images).toBeDefined();
      expect(repos.projects).toBeDefined();
    });

    it('throws error when userId is missing', () => {
      expect(() => userScoped.getUserRepositories('')).toThrow('userId is required');
      expect(() => userScoped.getUserRepositories(null as any)).toThrow('userId is required');
      expect(() => userScoped.getUserRepositories(undefined as any)).toThrow('userId is required');
    });

    it('caches repository containers per user', () => {
      const repos1 = userScoped.getUserRepositories(TEST_USER_ID);
      const repos2 = userScoped.getUserRepositories(TEST_USER_ID);
      
      expect(repos1).toBe(repos2);
    });

    it('creates separate containers for different users', () => {
      const repos1 = userScoped.getUserRepositories(TEST_USER_ID);
      const repos2 = userScoped.getUserRepositories(TEST_USER_ID_2);
      
      expect(repos1).not.toBe(repos2);
      expect(repos1.userId).toBe(TEST_USER_ID);
      expect(repos2.userId).toBe(TEST_USER_ID_2);
    });

    it('provides images as alias for files repository', () => {
      const repos = userScoped.getUserRepositories(TEST_USER_ID);
      expect(repos.images).toBe(repos.files);
    });
  });

  describe('getUserRepositoriesSafe', () => {
    it('returns user-scoped repositories after migration check', async () => {
      const repos = await userScoped.getUserRepositoriesSafe(TEST_USER_ID);
      
      expect(mockGetRepositoriesSafe).toHaveBeenCalled();
      expect(repos.userId).toBe(TEST_USER_ID);
    });

    it('throws error when userId is missing', async () => {
      await expect(userScoped.getUserRepositoriesSafe('')).rejects.toThrow('userId is required');
      await expect(userScoped.getUserRepositoriesSafe(null as any)).rejects.toThrow('userId is required');
    });

    it('caches repositories after first call', async () => {
      const repos1 = await userScoped.getUserRepositoriesSafe(TEST_USER_ID);
      const repos2 = await userScoped.getUserRepositoriesSafe(TEST_USER_ID);
      
      expect(repos1).toBe(repos2);
    });
  });

  describe('clearUserRepositoryCache', () => {
    it('clears cache for specific user', () => {
      const repos1 = userScoped.getUserRepositories(TEST_USER_ID);
      userScoped.clearUserRepositoryCache(TEST_USER_ID);
      const repos2 = userScoped.getUserRepositories(TEST_USER_ID);
      
      expect(repos1).not.toBe(repos2);
    });

    it('does not affect other user caches', () => {
      const repos1 = userScoped.getUserRepositories(TEST_USER_ID);
      const repos2 = userScoped.getUserRepositories(TEST_USER_ID_2);
      
      userScoped.clearUserRepositoryCache(TEST_USER_ID);
      
      const repos1New = userScoped.getUserRepositories(TEST_USER_ID);
      const repos2Same = userScoped.getUserRepositories(TEST_USER_ID_2);
      
      expect(repos1).not.toBe(repos1New);
      expect(repos2).toBe(repos2Same);
    });

    it('clears all caches when no userId provided', () => {
      const repos1 = userScoped.getUserRepositories(TEST_USER_ID);
      const repos2 = userScoped.getUserRepositories(TEST_USER_ID_2);
      
      userScoped.clearUserRepositoryCache();
      
      const repos1New = userScoped.getUserRepositories(TEST_USER_ID);
      const repos2New = userScoped.getUserRepositories(TEST_USER_ID_2);
      
      expect(repos1).not.toBe(repos1New);
      expect(repos2).not.toBe(repos2New);
    });

  });

  describe('UserScopedCharactersRepository', () => {
    it('findAll returns only user characters', async () => {
      const character = makeCharacter();
      mockFactoryRepos.characters.findByUserId.mockResolvedValue([character]);
      
      const repos = userScoped.getUserRepositories(TEST_USER_ID);
      const result = await repos.characters.findAll();
      
      expect(mockFactoryRepos.characters.findByUserId).toHaveBeenCalledWith(TEST_USER_ID);
      expect(result).toEqual([character]);
    });

    it('findById returns character when owned by user', async () => {
      const character = makeCharacter();
      mockFactoryRepos.characters.findById.mockResolvedValue(character);
      
      const repos = userScoped.getUserRepositories(TEST_USER_ID);
      const result = await repos.characters.findById(TEST_CHAR_ID);
      
      expect(result).toEqual(character);
    });

    it('findById returns null when character belongs to different user', async () => {
      const character = makeCharacter({ userId: TEST_USER_ID_2 });
      mockFactoryRepos.characters.findById.mockResolvedValue(character);
      
      const repos = userScoped.getUserRepositories(TEST_USER_ID);
      const result = await repos.characters.findById(TEST_CHAR_ID);
      
      expect(result).toBeNull();
    });

    it('findById returns null when character not found', async () => {
      mockFactoryRepos.characters.findById.mockResolvedValue(null);
      
      const repos = userScoped.getUserRepositories(TEST_USER_ID);
      const result = await repos.characters.findById(TEST_CHAR_ID);
      
      expect(result).toBeNull();
    });

    it('create automatically adds userId', async () => {
      const character = makeCharacter();
      mockFactoryRepos.characters.create.mockResolvedValue(character);
      
      const repos = userScoped.getUserRepositories(TEST_USER_ID);
      const result = await repos.characters.create({ name: 'New Character' } as any);
      
      expect(mockFactoryRepos.characters.create).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'New Character',
          userId: TEST_USER_ID,
        }),
        undefined
      );
      expect(result).toEqual(character);
    });

    it('update checks ownership before updating', async () => {
      const character = makeCharacter();
      mockFactoryRepos.characters.findById.mockResolvedValue(character);
      mockFactoryRepos.characters.update.mockResolvedValue(character);
      
      const repos = userScoped.getUserRepositories(TEST_USER_ID);
      const result = await repos.characters.update(TEST_CHAR_ID, { name: 'Updated' });
      
      expect(result).toEqual(character);
      expect(mockFactoryRepos.characters.update).toHaveBeenCalledWith(
        TEST_CHAR_ID,
        { name: 'Updated' }
      );
    });

    it('update returns null when character not owned by user', async () => {
      const character = makeCharacter({ userId: TEST_USER_ID_2 });
      mockFactoryRepos.characters.findById.mockResolvedValue(character);
      
      const repos = userScoped.getUserRepositories(TEST_USER_ID);
      const result = await repos.characters.update(TEST_CHAR_ID, { name: 'Updated' });
      
      expect(result).toBeNull();
      expect(mockFactoryRepos.characters.update).not.toHaveBeenCalled();
    });

    it('update strips userId from update data', async () => {
      const character = makeCharacter();
      mockFactoryRepos.characters.findById.mockResolvedValue(character);
      mockFactoryRepos.characters.update.mockResolvedValue(character);
      
      const repos = userScoped.getUserRepositories(TEST_USER_ID);
      await repos.characters.update(TEST_CHAR_ID, { userId: 'hacker', name: 'Updated' } as any);
      
      expect(mockFactoryRepos.characters.update).toHaveBeenCalledWith(
        TEST_CHAR_ID,
        { name: 'Updated' }
      );
    });

    it('delete checks ownership before deleting', async () => {
      const character = makeCharacter();
      mockFactoryRepos.characters.findById.mockResolvedValue(character);
      mockFactoryRepos.characters.delete.mockResolvedValue(true);
      
      const repos = userScoped.getUserRepositories(TEST_USER_ID);
      const result = await repos.characters.delete(TEST_CHAR_ID);
      
      expect(result).toBe(true);
      expect(mockFactoryRepos.characters.delete).toHaveBeenCalledWith(TEST_CHAR_ID);
    });

    it('delete returns false when character not owned by user', async () => {
      const character = makeCharacter({ userId: TEST_USER_ID_2 });
      mockFactoryRepos.characters.findById.mockResolvedValue(character);
      
      const repos = userScoped.getUserRepositories(TEST_USER_ID);
      const result = await repos.characters.delete(TEST_CHAR_ID);
      
      expect(result).toBe(false);
      expect(mockFactoryRepos.characters.delete).not.toHaveBeenCalled();
    });

    it('findByTag filters results by user', async () => {
      const ownChar = makeCharacter({ id: 'char-1', userId: TEST_USER_ID });
      const otherChar = makeCharacter({ id: 'char-2', userId: TEST_USER_ID_2 });
      mockFactoryRepos.characters.findByTag.mockResolvedValue([ownChar, otherChar]);
      
      const repos = userScoped.getUserRepositories(TEST_USER_ID);
      const result = await repos.characters.findByTag(TEST_TAG_ID);
      
      expect(result).toEqual([ownChar]);
    });

    it('addTag checks ownership before adding', async () => {
      const character = makeCharacter();
      mockFactoryRepos.characters.findById.mockResolvedValue(character);
      mockFactoryRepos.characters.addTag.mockResolvedValue(character);
      
      const repos = userScoped.getUserRepositories(TEST_USER_ID);
      const result = await repos.characters.addTag(TEST_CHAR_ID, TEST_TAG_ID);
      
      expect(result).toEqual(character);
      expect(mockFactoryRepos.characters.addTag).toHaveBeenCalledWith(TEST_CHAR_ID, TEST_TAG_ID);
    });

    it('removeTag checks ownership before removing', async () => {
      const character = makeCharacter();
      mockFactoryRepos.characters.findById.mockResolvedValue(character);
      mockFactoryRepos.characters.removeTag.mockResolvedValue(character);
      
      const repos = userScoped.getUserRepositories(TEST_USER_ID);
      const result = await repos.characters.removeTag(TEST_CHAR_ID, TEST_TAG_ID);
      
      expect(result).toEqual(character);
    });

    it('setFavorite checks ownership', async () => {
      const character = makeCharacter();
      mockFactoryRepos.characters.findById.mockResolvedValue(character);
      mockFactoryRepos.characters.setFavorite.mockResolvedValue(character);
      
      const repos = userScoped.getUserRepositories(TEST_USER_ID);
      const result = await repos.characters.setFavorite(TEST_CHAR_ID, true);
      
      expect(result).toEqual(character);
      expect(mockFactoryRepos.characters.setFavorite).toHaveBeenCalledWith(TEST_CHAR_ID, true);
    });
  });

  describe('UserScopedChatsRepository', () => {
    it('findByCharacterId filters by user', async () => {
      const ownChat = makeChat({ id: 'chat-1', userId: TEST_USER_ID });
      const otherChat = makeChat({ id: 'chat-2', userId: TEST_USER_ID_2 });
      mockFactoryRepos.chats.findByCharacterId.mockResolvedValue([ownChat, otherChat]);
      
      const repos = userScoped.getUserRepositories(TEST_USER_ID);
      const result = await repos.chats.findByCharacterId(TEST_CHAR_ID);
      
      expect(result).toEqual([ownChat]);
    });

    it('getMessages checks ownership', async () => {
      const chat = makeChat();
      const messages: ChatEvent[] = [];
      mockFactoryRepos.chats.findById.mockResolvedValue(chat);
      mockFactoryRepos.chats.getMessages.mockResolvedValue(messages);
      
      const repos = userScoped.getUserRepositories(TEST_USER_ID);
      const result = await repos.chats.getMessages(TEST_CHAT_ID);
      
      expect(result).toEqual(messages);
    });

    it('getMessages returns empty array when chat not owned', async () => {
      const chat = makeChat({ userId: TEST_USER_ID_2 });
      mockFactoryRepos.chats.findById.mockResolvedValue(chat);
      
      const repos = userScoped.getUserRepositories(TEST_USER_ID);
      const result = await repos.chats.getMessages(TEST_CHAT_ID);
      
      expect(result).toEqual([]);
      expect(mockFactoryRepos.chats.getMessages).not.toHaveBeenCalled();
    });

    it('addMessage throws when chat not owned', async () => {
      const chat = makeChat({ userId: TEST_USER_ID_2 });
      mockFactoryRepos.chats.findById.mockResolvedValue(chat);
      
      const repos = userScoped.getUserRepositories(TEST_USER_ID);
      await expect(repos.chats.addMessage(TEST_CHAT_ID, {} as any))
        .rejects.toThrow('Chat not found or access denied');
    });

    it('clearMessages throws when chat not owned', async () => {
      const chat = makeChat({ userId: TEST_USER_ID_2 });
      mockFactoryRepos.chats.findById.mockResolvedValue(chat);
      
      const repos = userScoped.getUserRepositories(TEST_USER_ID);
      await expect(repos.chats.clearMessages(TEST_CHAT_ID))
        .rejects.toThrow('Chat not found or access denied');
    });
  });

  describe('UserScopedTagsRepository', () => {
    it('findByName scopes to user', async () => {
      const tag = makeTag();
      mockFactoryRepos.tags.findByName.mockResolvedValue(tag);
      
      const repos = userScoped.getUserRepositories(TEST_USER_ID);
      const result = await repos.tags.findByName('Test Tag');
      
      expect(mockFactoryRepos.tags.findByName).toHaveBeenCalledWith(TEST_USER_ID, 'Test Tag');
      expect(result).toEqual(tag);
    });
  });

  describe('UserScopedConnectionsRepository', () => {
    it('findDefault scopes to user', async () => {
      const connection = {} as ConnectionProfile;
      mockFactoryRepos.connections.findDefault.mockResolvedValue(connection);
      
      const repos = userScoped.getUserRepositories(TEST_USER_ID);
      const result = await repos.connections.findDefault();
      
      expect(mockFactoryRepos.connections.findDefault).toHaveBeenCalledWith(TEST_USER_ID);
      expect(result).toEqual(connection);
    });

    it('getAllApiKeys scopes to user', async () => {
      const keys: ApiKey[] = [];
      mockFactoryRepos.connections.getApiKeysByUserId.mockResolvedValue(keys);
      
      const repos = userScoped.getUserRepositories(TEST_USER_ID);
      const result = await repos.connections.getAllApiKeys();
      
      expect(mockFactoryRepos.connections.getApiKeysByUserId).toHaveBeenCalledWith(TEST_USER_ID);
      expect(result).toEqual(keys);
    });

    it('findApiKeyById scopes to user', async () => {
      const key = { id: 'key-1', userId: TEST_USER_ID } as ApiKey;
      mockFactoryRepos.connections.findApiKeyByIdAndUserId.mockResolvedValue(key);
      
      const repos = userScoped.getUserRepositories(TEST_USER_ID);
      const result = await repos.connections.findApiKeyById('key-1');
      
      expect(mockFactoryRepos.connections.findApiKeyByIdAndUserId)
        .toHaveBeenCalledWith('key-1', TEST_USER_ID);
    });

    it('createApiKey adds userId', async () => {
      const key = { id: 'key-1', userId: TEST_USER_ID } as ApiKey;
      mockFactoryRepos.connections.createApiKey.mockResolvedValue(key);
      
      const repos = userScoped.getUserRepositories(TEST_USER_ID);
      await repos.connections.createApiKey({ name: 'Test Key' } as any);
      
      expect(mockFactoryRepos.connections.createApiKey).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Test Key',
          userId: TEST_USER_ID,
        })
      );
    });
  });

  describe('UserScopedMemoriesRepository', () => {
    it('findByCharacterId checks character ownership', async () => {
      const character = makeCharacter();
      const memories: Memory[] = [];
      mockFactoryRepos.characters.findById.mockResolvedValue(character);
      mockFactoryRepos.memories.findByCharacterId.mockResolvedValue(memories);
      
      const repos = userScoped.getUserRepositories(TEST_USER_ID);
      const result = await repos.memories.findByCharacterId(TEST_CHAR_ID);
      
      expect(result).toEqual(memories);
    });

    it('findByCharacterId returns empty when character not owned', async () => {
      mockFactoryRepos.characters.findById.mockResolvedValue(null);
      
      const repos = userScoped.getUserRepositories(TEST_USER_ID);
      const result = await repos.memories.findByCharacterId(TEST_CHAR_ID);
      
      expect(result).toEqual([]);
      expect(mockFactoryRepos.memories.findByCharacterId).not.toHaveBeenCalled();
    });

    it('create checks character ownership', async () => {
      const character = makeCharacter();
      const memory = { id: 'mem-1', characterId: TEST_CHAR_ID } as Memory;
      mockFactoryRepos.characters.findById.mockResolvedValue(character);
      mockFactoryRepos.memories.create.mockResolvedValue(memory);
      
      const repos = userScoped.getUserRepositories(TEST_USER_ID);
      await repos.memories.create({ characterId: TEST_CHAR_ID, content: 'Test' } as any);
      
      expect(mockFactoryRepos.memories.create).toHaveBeenCalled();
    });

    it('create throws when character not owned', async () => {
      mockFactoryRepos.characters.findById.mockResolvedValue(null);
      
      const repos = userScoped.getUserRepositories(TEST_USER_ID);
      await expect(repos.memories.create({ characterId: TEST_CHAR_ID } as any))
        .rejects.toThrow('Character not found or access denied');
    });
  });

  describe('UserScopedFilesRepository', () => {
    it('findBySha256 filters by user', async () => {
      const ownFile = { id: 'file-1', userId: TEST_USER_ID } as FileEntry;
      const otherFile = { id: 'file-2', userId: TEST_USER_ID_2 } as FileEntry;
      mockFactoryRepos.files.findBySha256.mockResolvedValue([ownFile, otherFile]);
      
      const repos = userScoped.getUserRepositories(TEST_USER_ID);
      const result = await repos.files.findBySha256('abc123');
      
      expect(result).toEqual([ownFile]);
    });

    it('addLink checks ownership', async () => {
      const file = { id: 'file-1', userId: TEST_USER_ID } as FileEntry;
      mockFactoryRepos.files.findById.mockResolvedValue(file);
      mockFactoryRepos.files.addLink.mockResolvedValue(file);
      
      const repos = userScoped.getUserRepositories(TEST_USER_ID);
      const result = await repos.files.addLink('file-1', 'entity-1');
      
      expect(result).toEqual(file);
      expect(mockFactoryRepos.files.addLink).toHaveBeenCalledWith('file-1', 'entity-1');
    });
  });

  describe('UserScopedProjectsRepository', () => {
    it('findByCharacterId filters by user', async () => {
      const ownProject = { id: 'proj-1', userId: TEST_USER_ID } as Project;
      const otherProject = { id: 'proj-2', userId: TEST_USER_ID_2 } as Project;
      mockFactoryRepos.projects.findByCharacterId.mockResolvedValue([ownProject, otherProject]);
      
      const repos = userScoped.getUserRepositories(TEST_USER_ID);
      const result = await repos.projects.findByCharacterId(TEST_CHAR_ID);
      
      expect(result).toEqual([ownProject]);
    });

    it('addToRoster checks ownership', async () => {
      const project = { id: 'proj-1', userId: TEST_USER_ID } as Project;
      mockFactoryRepos.projects.findById.mockResolvedValue(project);
      mockFactoryRepos.projects.addToRoster.mockResolvedValue(project);
      
      const repos = userScoped.getUserRepositories(TEST_USER_ID);
      const result = await repos.projects.addToRoster('proj-1', TEST_CHAR_ID);
      
      expect(result).toEqual(project);
    });

    it('canCharacterParticipate checks ownership', async () => {
      const project = { id: 'proj-1', userId: TEST_USER_ID } as Project;
      mockFactoryRepos.projects.findById.mockResolvedValue(project);
      mockFactoryRepos.projects.canCharacterParticipate.mockResolvedValue(true);
      
      const repos = userScoped.getUserRepositories(TEST_USER_ID);
      const result = await repos.projects.canCharacterParticipate('proj-1', TEST_CHAR_ID);
      
      expect(result).toBe(true);
    });
  });
});
