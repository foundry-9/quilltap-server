/**
 * Mock Repository Objects
 *
 * Pre-configured mock implementations of repository interfaces for testing.
 * These mocks match the return type of `getUserRepositories()` and `getRepositories()`.
 */

import { jest } from '@jest/globals';
import type {
  Character,
  Persona,
  ChatMetadata,
  Tag,
  Memory,
  ConnectionProfile,
  ImageProfile,
  EmbeddingProfile,
  RoleplayTemplate,
  PromptTemplate,
  FileEntry,
  MessageEvent,
  ChatEvent,
  ApiKey,
} from '@/lib/schemas/types';

// ============================================================================
// MOCK REPOSITORY TYPES
// ============================================================================

export interface MockCharactersRepository {
  findById: jest.Mock<(id: string) => Promise<Character | null>>;
  findAll: jest.Mock<() => Promise<Character[]>>;
  create: jest.Mock<(data: Partial<Character>) => Promise<Character>>;
  update: jest.Mock<(id: string, data: Partial<Character>) => Promise<Character | null>>;
  delete: jest.Mock<(id: string) => Promise<boolean>>;
}

export interface MockPersonasRepository {
  findById: jest.Mock<(id: string) => Promise<Persona | null>>;
  findAll: jest.Mock<() => Promise<Persona[]>>;
  create: jest.Mock<(data: Partial<Persona>) => Promise<Persona>>;
  update: jest.Mock<(id: string, data: Partial<Persona>) => Promise<Persona | null>>;
  delete: jest.Mock<(id: string) => Promise<boolean>>;
}

export interface MockChatsRepository {
  findById: jest.Mock<(id: string) => Promise<ChatMetadata | null>>;
  findAll: jest.Mock<() => Promise<ChatMetadata[]>>;
  create: jest.Mock<(data: Partial<ChatMetadata>) => Promise<ChatMetadata>>;
  update: jest.Mock<(id: string, data: Partial<ChatMetadata>) => Promise<ChatMetadata | null>>;
  delete: jest.Mock<(id: string) => Promise<boolean>>;
  getMessages: jest.Mock<(chatId: string) => Promise<ChatEvent[]>>;
  addMessage: jest.Mock<(chatId: string, message: MessageEvent) => Promise<void>>;
}

export interface MockTagsRepository {
  findById: jest.Mock<(id: string) => Promise<Tag | null>>;
  findAll: jest.Mock<() => Promise<Tag[]>>;
  create: jest.Mock<(data: Partial<Tag>) => Promise<Tag>>;
  update: jest.Mock<(id: string, data: Partial<Tag>) => Promise<Tag | null>>;
  delete: jest.Mock<(id: string) => Promise<boolean>>;
}

export interface MockMemoriesRepository {
  findById: jest.Mock<(id: string) => Promise<Memory | null>>;
  findByCharacterId: jest.Mock<(characterId: string) => Promise<Memory[]>>;
  findAll: jest.Mock<() => Promise<Memory[]>>;
  create: jest.Mock<(data: Partial<Memory>) => Promise<Memory>>;
  update: jest.Mock<(id: string, data: Partial<Memory>) => Promise<Memory | null>>;
  delete: jest.Mock<(id: string) => Promise<boolean>>;
}

export interface MockConnectionsRepository {
  findById: jest.Mock<(id: string) => Promise<ConnectionProfile | null>>;
  findAll: jest.Mock<() => Promise<ConnectionProfile[]>>;
  create: jest.Mock<(data: Partial<ConnectionProfile>) => Promise<ConnectionProfile>>;
  update: jest.Mock<(id: string, data: Partial<ConnectionProfile>) => Promise<ConnectionProfile | null>>;
  delete: jest.Mock<(id: string) => Promise<boolean>>;
  findApiKeyById: jest.Mock<(id: string) => Promise<ApiKey | null>>;
  getAllApiKeys: jest.Mock<() => Promise<ApiKey[]>>;
  createApiKey: jest.Mock<(data: Omit<ApiKey, 'id' | 'createdAt' | 'updatedAt' | 'userId'>) => Promise<ApiKey>>;
  updateApiKey: jest.Mock<(id: string, data: Partial<ApiKey>) => Promise<ApiKey | null>>;
  deleteApiKey: jest.Mock<(id: string) => Promise<boolean>>;
}

export interface MockImageProfilesRepository {
  findById: jest.Mock<(id: string) => Promise<ImageProfile | null>>;
  findAll: jest.Mock<() => Promise<ImageProfile[]>>;
  create: jest.Mock<(data: Partial<ImageProfile>) => Promise<ImageProfile>>;
  update: jest.Mock<(id: string, data: Partial<ImageProfile>) => Promise<ImageProfile | null>>;
  delete: jest.Mock<(id: string) => Promise<boolean>>;
}

export interface MockEmbeddingProfilesRepository {
  findById: jest.Mock<(id: string) => Promise<EmbeddingProfile | null>>;
  findAll: jest.Mock<() => Promise<EmbeddingProfile[]>>;
  create: jest.Mock<(data: Partial<EmbeddingProfile>) => Promise<EmbeddingProfile>>;
  update: jest.Mock<(id: string, data: Partial<EmbeddingProfile>) => Promise<EmbeddingProfile | null>>;
  delete: jest.Mock<(id: string) => Promise<boolean>>;
}

export interface MockRoleplayTemplatesRepository {
  findById: jest.Mock<(id: string) => Promise<RoleplayTemplate | null>>;
  findAll: jest.Mock<() => Promise<RoleplayTemplate[]>>;
  create: jest.Mock<(data: Partial<RoleplayTemplate>) => Promise<RoleplayTemplate>>;
  update: jest.Mock<(id: string, data: Partial<RoleplayTemplate>) => Promise<RoleplayTemplate | null>>;
  delete: jest.Mock<(id: string) => Promise<boolean>>;
}

export interface MockPromptTemplatesRepository {
  findById: jest.Mock<(id: string) => Promise<PromptTemplate | null>>;
  findAll: jest.Mock<() => Promise<PromptTemplate[]>>;
  create: jest.Mock<(data: Partial<PromptTemplate>) => Promise<PromptTemplate>>;
  update: jest.Mock<(id: string, data: Partial<PromptTemplate>) => Promise<PromptTemplate | null>>;
  delete: jest.Mock<(id: string) => Promise<boolean>>;
}

export interface MockFilesRepository {
  findById: jest.Mock<(id: string) => Promise<FileEntry | null>>;
  findAll: jest.Mock<() => Promise<FileEntry[]>>;
  create: jest.Mock<(data: Partial<FileEntry>) => Promise<FileEntry>>;
  update: jest.Mock<(id: string, data: Partial<FileEntry>) => Promise<FileEntry | null>>;
  delete: jest.Mock<(id: string) => Promise<boolean>>;
}

export interface MockUserRepositories {
  characters: MockCharactersRepository;
  personas: MockPersonasRepository;
  chats: MockChatsRepository;
  tags: MockTagsRepository;
  memories: MockMemoriesRepository;
  connections: MockConnectionsRepository;
  imageProfiles: MockImageProfilesRepository;
  embeddingProfiles: MockEmbeddingProfilesRepository;
}

export interface MockGlobalRepositories {
  roleplayTemplates: MockRoleplayTemplatesRepository;
  promptTemplates: MockPromptTemplatesRepository;
  files: MockFilesRepository;
}

// ============================================================================
// FACTORY FUNCTIONS
// ============================================================================

/**
 * Create a mock characters repository
 */
export function createMockCharactersRepository(): MockCharactersRepository {
  return {
    findById: jest.fn<(id: string) => Promise<Character | null>>().mockResolvedValue(null),
    findAll: jest.fn<() => Promise<Character[]>>().mockResolvedValue([]),
    create: jest.fn<(data: Partial<Character>) => Promise<Character>>(),
    update: jest.fn<(id: string, data: Partial<Character>) => Promise<Character | null>>().mockResolvedValue(null),
    delete: jest.fn<(id: string) => Promise<boolean>>().mockResolvedValue(true),
  };
}

/**
 * Create a mock personas repository
 */
export function createMockPersonasRepository(): MockPersonasRepository {
  return {
    findById: jest.fn<(id: string) => Promise<Persona | null>>().mockResolvedValue(null),
    findAll: jest.fn<() => Promise<Persona[]>>().mockResolvedValue([]),
    create: jest.fn<(data: Partial<Persona>) => Promise<Persona>>(),
    update: jest.fn<(id: string, data: Partial<Persona>) => Promise<Persona | null>>().mockResolvedValue(null),
    delete: jest.fn<(id: string) => Promise<boolean>>().mockResolvedValue(true),
  };
}

/**
 * Create a mock chats repository
 */
export function createMockChatsRepository(): MockChatsRepository {
  return {
    findById: jest.fn<(id: string) => Promise<ChatMetadata | null>>().mockResolvedValue(null),
    findAll: jest.fn<() => Promise<ChatMetadata[]>>().mockResolvedValue([]),
    create: jest.fn<(data: Partial<ChatMetadata>) => Promise<ChatMetadata>>(),
    update: jest.fn<(id: string, data: Partial<ChatMetadata>) => Promise<ChatMetadata | null>>().mockResolvedValue(null),
    delete: jest.fn<(id: string) => Promise<boolean>>().mockResolvedValue(true),
    getMessages: jest.fn<(chatId: string) => Promise<ChatEvent[]>>().mockResolvedValue([]),
    addMessage: jest.fn<(chatId: string, message: MessageEvent) => Promise<void>>().mockResolvedValue(),
  };
}

/**
 * Create a mock tags repository
 */
export function createMockTagsRepository(): MockTagsRepository {
  return {
    findById: jest.fn<(id: string) => Promise<Tag | null>>().mockResolvedValue(null),
    findAll: jest.fn<() => Promise<Tag[]>>().mockResolvedValue([]),
    create: jest.fn<(data: Partial<Tag>) => Promise<Tag>>(),
    update: jest.fn<(id: string, data: Partial<Tag>) => Promise<Tag | null>>().mockResolvedValue(null),
    delete: jest.fn<(id: string) => Promise<boolean>>().mockResolvedValue(true),
  };
}

/**
 * Create a mock memories repository
 */
export function createMockMemoriesRepository(): MockMemoriesRepository {
  return {
    findById: jest.fn<(id: string) => Promise<Memory | null>>().mockResolvedValue(null),
    findByCharacterId: jest.fn<(characterId: string) => Promise<Memory[]>>().mockResolvedValue([]),
    findAll: jest.fn<() => Promise<Memory[]>>().mockResolvedValue([]),
    create: jest.fn<(data: Partial<Memory>) => Promise<Memory>>(),
    update: jest.fn<(id: string, data: Partial<Memory>) => Promise<Memory | null>>().mockResolvedValue(null),
    delete: jest.fn<(id: string) => Promise<boolean>>().mockResolvedValue(true),
  };
}

/**
 * Create a mock connections repository
 */
export function createMockConnectionsRepository(): MockConnectionsRepository {
  return {
    findById: jest.fn<(id: string) => Promise<ConnectionProfile | null>>().mockResolvedValue(null),
    findAll: jest.fn<() => Promise<ConnectionProfile[]>>().mockResolvedValue([]),
    create: jest.fn<(data: Partial<ConnectionProfile>) => Promise<ConnectionProfile>>(),
    update: jest.fn<(id: string, data: Partial<ConnectionProfile>) => Promise<ConnectionProfile | null>>().mockResolvedValue(null),
    delete: jest.fn<(id: string) => Promise<boolean>>().mockResolvedValue(true),
    findApiKeyById: jest.fn<(id: string) => Promise<ApiKey | null>>().mockResolvedValue(null),
    getAllApiKeys: jest.fn<() => Promise<ApiKey[]>>().mockResolvedValue([]),
    createApiKey: jest.fn<(data: Omit<ApiKey, 'id' | 'createdAt' | 'updatedAt' | 'userId'>) => Promise<ApiKey>>(),
    updateApiKey: jest.fn<(id: string, data: Partial<ApiKey>) => Promise<ApiKey | null>>().mockResolvedValue(null),
    deleteApiKey: jest.fn<(id: string) => Promise<boolean>>().mockResolvedValue(true),
  };
}

/**
 * Create a mock image profiles repository
 */
export function createMockImageProfilesRepository(): MockImageProfilesRepository {
  return {
    findById: jest.fn<(id: string) => Promise<ImageProfile | null>>().mockResolvedValue(null),
    findAll: jest.fn<() => Promise<ImageProfile[]>>().mockResolvedValue([]),
    create: jest.fn<(data: Partial<ImageProfile>) => Promise<ImageProfile>>(),
    update: jest.fn<(id: string, data: Partial<ImageProfile>) => Promise<ImageProfile | null>>().mockResolvedValue(null),
    delete: jest.fn<(id: string) => Promise<boolean>>().mockResolvedValue(true),
  };
}

/**
 * Create a mock embedding profiles repository
 */
export function createMockEmbeddingProfilesRepository(): MockEmbeddingProfilesRepository {
  return {
    findById: jest.fn<(id: string) => Promise<EmbeddingProfile | null>>().mockResolvedValue(null),
    findAll: jest.fn<() => Promise<EmbeddingProfile[]>>().mockResolvedValue([]),
    create: jest.fn<(data: Partial<EmbeddingProfile>) => Promise<EmbeddingProfile>>(),
    update: jest.fn<(id: string, data: Partial<EmbeddingProfile>) => Promise<EmbeddingProfile | null>>().mockResolvedValue(null),
    delete: jest.fn<(id: string) => Promise<boolean>>().mockResolvedValue(true),
  };
}

/**
 * Create a mock roleplay templates repository
 */
export function createMockRoleplayTemplatesRepository(): MockRoleplayTemplatesRepository {
  return {
    findById: jest.fn<(id: string) => Promise<RoleplayTemplate | null>>().mockResolvedValue(null),
    findAll: jest.fn<() => Promise<RoleplayTemplate[]>>().mockResolvedValue([]),
    create: jest.fn<(data: Partial<RoleplayTemplate>) => Promise<RoleplayTemplate>>(),
    update: jest.fn<(id: string, data: Partial<RoleplayTemplate>) => Promise<RoleplayTemplate | null>>().mockResolvedValue(null),
    delete: jest.fn<(id: string) => Promise<boolean>>().mockResolvedValue(true),
  };
}

/**
 * Create a mock prompt templates repository
 */
export function createMockPromptTemplatesRepository(): MockPromptTemplatesRepository {
  return {
    findById: jest.fn<(id: string) => Promise<PromptTemplate | null>>().mockResolvedValue(null),
    findAll: jest.fn<() => Promise<PromptTemplate[]>>().mockResolvedValue([]),
    create: jest.fn<(data: Partial<PromptTemplate>) => Promise<PromptTemplate>>(),
    update: jest.fn<(id: string, data: Partial<PromptTemplate>) => Promise<PromptTemplate | null>>().mockResolvedValue(null),
    delete: jest.fn<(id: string) => Promise<boolean>>().mockResolvedValue(true),
  };
}

/**
 * Create a mock files repository
 */
export function createMockFilesRepository(): MockFilesRepository {
  return {
    findById: jest.fn<(id: string) => Promise<FileEntry | null>>().mockResolvedValue(null),
    findAll: jest.fn<() => Promise<FileEntry[]>>().mockResolvedValue([]),
    create: jest.fn<(data: Partial<FileEntry>) => Promise<FileEntry>>(),
    update: jest.fn<(id: string, data: Partial<FileEntry>) => Promise<FileEntry | null>>().mockResolvedValue(null),
    delete: jest.fn<(id: string) => Promise<boolean>>().mockResolvedValue(true),
  };
}

// ============================================================================
// COMBINED REPOSITORY FACTORIES
// ============================================================================

/**
 * Create all user repositories (equivalent to getUserRepositories() return)
 */
export function createMockUserRepositories(): MockUserRepositories {
  return {
    characters: createMockCharactersRepository(),
    personas: createMockPersonasRepository(),
    chats: createMockChatsRepository(),
    tags: createMockTagsRepository(),
    memories: createMockMemoriesRepository(),
    connections: createMockConnectionsRepository(),
    imageProfiles: createMockImageProfilesRepository(),
    embeddingProfiles: createMockEmbeddingProfilesRepository(),
  };
}

/**
 * Create global repositories (equivalent to getRepositories() return)
 */
export function createMockGlobalRepositories(): MockGlobalRepositories {
  return {
    roleplayTemplates: createMockRoleplayTemplatesRepository(),
    promptTemplates: createMockPromptTemplatesRepository(),
    files: createMockFilesRepository(),
  };
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Reset all mocks in a user repositories object
 */
export function resetMockUserRepositories(repos: MockUserRepositories): void {
  Object.values(repos).forEach((repo) => {
    Object.values(repo).forEach((fn) => {
      if (typeof fn === 'function' && 'mockReset' in fn) {
        (fn as jest.Mock).mockReset();
      }
    });
  });
}

/**
 * Reset all mocks in a global repositories object
 */
export function resetMockGlobalRepositories(repos: MockGlobalRepositories): void {
  Object.values(repos).forEach((repo) => {
    Object.values(repo).forEach((fn) => {
      if (typeof fn === 'function' && 'mockReset' in fn) {
        (fn as jest.Mock).mockReset();
      }
    });
  });
}

/**
 * Configure a repository to return specific entities on findById
 */
export function configureFindById<T>(
  mockFn: jest.Mock<(id: string) => Promise<T | null>>,
  entities: T[],
  idField: keyof T = 'id' as keyof T
): void {
  mockFn.mockImplementation(async (id: string) => {
    return entities.find((e) => e[idField] === id) || null;
  });
}

/**
 * Configure a repository to return specific entities on findAll
 */
export function configureFindAll<T>(
  mockFn: jest.Mock<() => Promise<T[]>>,
  entities: T[]
): void {
  mockFn.mockResolvedValue(entities);
}

/**
 * Configure a create mock to return the input with an ID
 */
export function configureCreate<T extends { id?: string }>(
  mockFn: jest.Mock<(data: Partial<T>) => Promise<T>>,
  idGenerator: () => string = () => 'generated-id'
): void {
  mockFn.mockImplementation(async (data: Partial<T>) => {
    return {
      ...data,
      id: data.id || idGenerator(),
    } as T;
  });
}

// ============================================================================
// USERS REPOSITORY (for auth middleware)
// ============================================================================

export interface MockUsersRepository {
  findById: jest.Mock<(id: string) => Promise<User | null>>;
  findByEmail: jest.Mock<(email: string) => Promise<User | null>>;
  findAll: jest.Mock<() => Promise<User[]>>;
  create: jest.Mock<(data: Partial<User>) => Promise<User>>;
  update: jest.Mock<(id: string, data: Partial<User>) => Promise<User | null>>;
  delete: jest.Mock<(id: string) => Promise<boolean>>;
}

interface User {
  id: string;
  email?: string;
  name?: string;
  [key: string]: unknown;
}

/**
 * Create a mock users repository
 */
export function createMockUsersRepository(): MockUsersRepository {
  return {
    findById: jest.fn<(id: string) => Promise<User | null>>().mockResolvedValue(null),
    findByEmail: jest.fn<(email: string) => Promise<User | null>>().mockResolvedValue(null),
    findAll: jest.fn<() => Promise<User[]>>().mockResolvedValue([]),
    create: jest.fn<(data: Partial<User>) => Promise<User>>(),
    update: jest.fn<(id: string, data: Partial<User>) => Promise<User | null>>().mockResolvedValue(null),
    delete: jest.fn<(id: string) => Promise<boolean>>().mockResolvedValue(true),
  };
}

// ============================================================================
// BACKGROUND JOBS REPOSITORY
// ============================================================================

export interface MockBackgroundJobsRepository {
  findById: jest.Mock;
  findAll: jest.Mock;
  create: jest.Mock;
  update: jest.Mock;
  delete: jest.Mock;
  findPending: jest.Mock;
  findByType: jest.Mock;
  findByUserId: jest.Mock;
  getStats: jest.Mock;
}

export function createMockBackgroundJobsRepository(): MockBackgroundJobsRepository {
  return {
    findById: jest.fn().mockResolvedValue(null),
    findAll: jest.fn().mockResolvedValue([]),
    create: jest.fn(),
    update: jest.fn().mockResolvedValue(null),
    delete: jest.fn().mockResolvedValue(true),
    findPending: jest.fn().mockResolvedValue([]),
    findByType: jest.fn().mockResolvedValue([]),
    findByUserId: jest.fn().mockResolvedValue([]),
    getStats: jest.fn().mockResolvedValue({ pending: 0, processing: 0, failed: 0, completed: 0, dead: 0, paused: 0 }),
  };
}

// ============================================================================
// FULL REPOSITORY CONTAINER (for getRepositories() mock)
// ============================================================================

export interface MockRepositoryContainer {
  characters: MockCharactersRepository;
  personas: MockPersonasRepository;
  chats: MockChatsRepository;
  tags: MockTagsRepository;
  users: MockUsersRepository;
  connections: MockConnectionsRepository;
  images: MockFilesRepository;
  imageProfiles: MockImageProfilesRepository;
  embeddingProfiles: MockEmbeddingProfilesRepository;
  memories: MockMemoriesRepository;
  files: MockFilesRepository;
  backgroundJobs: MockBackgroundJobsRepository;
  roleplayTemplates: MockRoleplayTemplatesRepository;
  promptTemplates: MockPromptTemplatesRepository;
  providerModels: { findAll: jest.Mock; upsert: jest.Mock };
  syncInstances: { findAll: jest.Mock; findById: jest.Mock; create: jest.Mock; update: jest.Mock; delete: jest.Mock };
  syncMappings: { findAll: jest.Mock; findById: jest.Mock; create: jest.Mock; update: jest.Mock; delete: jest.Mock };
  syncOperations: { findAll: jest.Mock; findById: jest.Mock; create: jest.Mock; update: jest.Mock; delete: jest.Mock };
  userSyncApiKeys: { findAll: jest.Mock; findById: jest.Mock; create: jest.Mock; update: jest.Mock; delete: jest.Mock };
  chatSettings: { findByUserId: jest.Mock; upsert: jest.Mock };
}

/**
 * Create a complete mock repository container for getRepositories()
 * This is used to mock the auth middleware which calls getRepositories()
 */
export function createMockRepositoryContainer(): MockRepositoryContainer {
  return {
    characters: createMockCharactersRepository(),
    personas: createMockPersonasRepository(),
    chats: createMockChatsRepository(),
    tags: createMockTagsRepository(),
    users: createMockUsersRepository(),
    connections: createMockConnectionsRepository(),
    images: createMockFilesRepository(),
    imageProfiles: createMockImageProfilesRepository(),
    embeddingProfiles: createMockEmbeddingProfilesRepository(),
    memories: createMockMemoriesRepository(),
    files: createMockFilesRepository(),
    backgroundJobs: createMockBackgroundJobsRepository(),
    roleplayTemplates: createMockRoleplayTemplatesRepository(),
    promptTemplates: createMockPromptTemplatesRepository(),
    providerModels: { findAll: jest.fn().mockResolvedValue([]), upsert: jest.fn() },
    syncInstances: { findAll: jest.fn().mockResolvedValue([]), findById: jest.fn().mockResolvedValue(null), create: jest.fn(), update: jest.fn(), delete: jest.fn() },
    syncMappings: { findAll: jest.fn().mockResolvedValue([]), findById: jest.fn().mockResolvedValue(null), create: jest.fn(), update: jest.fn(), delete: jest.fn() },
    syncOperations: { findAll: jest.fn().mockResolvedValue([]), findById: jest.fn().mockResolvedValue(null), create: jest.fn(), update: jest.fn(), delete: jest.fn() },
    userSyncApiKeys: { findAll: jest.fn().mockResolvedValue([]), findById: jest.fn().mockResolvedValue(null), create: jest.fn(), update: jest.fn(), delete: jest.fn() },
    chatSettings: { findByUserId: jest.fn().mockResolvedValue(null), upsert: jest.fn() },
  };
}

/**
 * Default mock user for authenticated tests
 */
export const DEFAULT_MOCK_USER: User = {
  id: 'user-123',
  email: 'test@example.com',
  name: 'Test User',
};

/**
 * Setup standard authentication mocks for route tests.
 * Call this in beforeEach to set up getServerSession and getRepositories mocks.
 *
 * @param mockGetServerSession - The mocked getServerSession function
 * @param mockRepos - The mock repository container (from createMockRepositoryContainer())
 * @param mockUser - Optional custom user (defaults to DEFAULT_MOCK_USER)
 */
export function setupAuthMocks(
  mockGetServerSession: jest.Mock,
  mockRepos: MockRepositoryContainer,
  mockUser: User = DEFAULT_MOCK_USER
): void {
  mockGetServerSession.mockResolvedValue({
    user: { id: mockUser.id, email: mockUser.email },
  });
  mockRepos.users.findById.mockResolvedValue(mockUser);
}
