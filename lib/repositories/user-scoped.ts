/**
 * User-Scoped Repository Wrappers
 *
 * These wrappers automatically scope all repository operations to a specific user,
 * making it impossible to accidentally access another user's data.
 *
 * Usage:
 *   const repos = getUserRepositories(session.user.id);
 *   const characters = await repos.characters.findAll(); // Only returns user's characters
 *   const character = await repos.characters.findById(id); // Returns null if not user's
 */

import { logger } from '@/lib/logger';
import {
  getRepositories,
  RepositoryContainer,
  CharactersRepository,
  PersonasRepository,
  MongoChatsRepository,
  MongoTagsRepository,
  ConnectionProfilesRepository,
  MongoImageProfilesRepository,
  EmbeddingProfilesRepository,
  MemoriesRepository,
  FilesRepository,
} from '@/lib/mongodb/repositories';
import type {
  Character,
  Persona,
  ChatMetadata,
  Tag,
  ConnectionProfile,
  ImageProfile,
  EmbeddingProfile,
  Memory,
  FileEntry,
  ApiKey,
  ChatEvent,
} from '@/lib/schemas/types';

/**
 * User-scoped Characters Repository
 * All operations are automatically filtered to the specified user
 */
class UserScopedCharactersRepository {
  constructor(
    private readonly userId: string,
    private readonly baseRepo: CharactersRepository
  ) {}

  async findAll(): Promise<Character[]> {
    return this.baseRepo.findByUserId(this.userId);
  }

  async findById(id: string): Promise<Character | null> {
    const character = await this.baseRepo.findById(id);
    if (!character || character.userId !== this.userId) {
      return null;
    }
    return character;
  }

  async findByTag(tagId: string): Promise<Character[]> {
    const characters = await this.baseRepo.findByTag(tagId);
    return characters.filter(c => c.userId === this.userId);
  }

  async create(data: Omit<Character, 'id' | 'createdAt' | 'updatedAt' | 'userId'>): Promise<Character> {
    return this.baseRepo.create({ ...data, userId: this.userId });
  }

  async update(id: string, data: Partial<Character>): Promise<Character | null> {
    const character = await this.findById(id);
    if (!character) return null;
    // Prevent userId from being changed
    const { userId: _, ...safeData } = data;
    return this.baseRepo.update(id, safeData);
  }

  async delete(id: string): Promise<boolean> {
    const character = await this.findById(id);
    if (!character) return false;
    return this.baseRepo.delete(id);
  }

  // Pass-through methods that are already scoped by character ownership
  async addTag(characterId: string, tagId: string): Promise<Character | null> {
    const character = await this.findById(characterId);
    if (!character) return null;
    return this.baseRepo.addTag(characterId, tagId);
  }

  async removeTag(characterId: string, tagId: string): Promise<Character | null> {
    const character = await this.findById(characterId);
    if (!character) return null;
    return this.baseRepo.removeTag(characterId, tagId);
  }

  async setFavorite(characterId: string, isFavorite: boolean): Promise<Character | null> {
    const character = await this.findById(characterId);
    if (!character) return null;
    return this.baseRepo.setFavorite(characterId, isFavorite);
  }

  async addDescription(characterId: string, description: any): Promise<any> {
    const character = await this.findById(characterId);
    if (!character) return null;
    return this.baseRepo.addDescription(characterId, description);
  }

  async updateDescription(characterId: string, descriptionId: string, data: any): Promise<any> {
    const character = await this.findById(characterId);
    if (!character) return null;
    return this.baseRepo.updateDescription(characterId, descriptionId, data);
  }

  async removeDescription(characterId: string, descriptionId: string): Promise<boolean> {
    const character = await this.findById(characterId);
    if (!character) return false;
    return this.baseRepo.removeDescription(characterId, descriptionId);
  }

  async getDescription(characterId: string, descriptionId: string): Promise<any> {
    const character = await this.findById(characterId);
    if (!character) return null;
    return this.baseRepo.getDescription(characterId, descriptionId);
  }

  async getDescriptions(characterId: string): Promise<any[]> {
    const character = await this.findById(characterId);
    if (!character) return [];
    return this.baseRepo.getDescriptions(characterId);
  }

  async addPersona(characterId: string, personaId: string, isDefault?: boolean): Promise<Character | null> {
    const character = await this.findById(characterId);
    if (!character) return null;
    return this.baseRepo.addPersona(characterId, personaId, isDefault);
  }

  async removePersona(characterId: string, personaId: string): Promise<Character | null> {
    const character = await this.findById(characterId);
    if (!character) return null;
    return this.baseRepo.removePersona(characterId, personaId);
  }
}

/**
 * User-scoped Personas Repository
 */
class UserScopedPersonasRepository {
  constructor(
    private readonly userId: string,
    private readonly baseRepo: PersonasRepository
  ) {}

  async findAll(): Promise<Persona[]> {
    return this.baseRepo.findByUserId(this.userId);
  }

  async findById(id: string): Promise<Persona | null> {
    const persona = await this.baseRepo.findById(id);
    if (!persona || persona.userId !== this.userId) {
      return null;
    }
    return persona;
  }

  async findByTag(tagId: string): Promise<Persona[]> {
    const personas = await this.baseRepo.findByTag(tagId);
    return personas.filter(p => p.userId === this.userId);
  }

  async create(data: Omit<Persona, 'id' | 'createdAt' | 'updatedAt' | 'userId'>): Promise<Persona> {
    return this.baseRepo.create({ ...data, userId: this.userId });
  }

  async update(id: string, data: Partial<Persona>): Promise<Persona | null> {
    const persona = await this.findById(id);
    if (!persona) return null;
    const { userId: _, ...safeData } = data;
    return this.baseRepo.update(id, safeData);
  }

  async delete(id: string): Promise<boolean> {
    const persona = await this.findById(id);
    if (!persona) return false;
    return this.baseRepo.delete(id);
  }

  async addTag(personaId: string, tagId: string): Promise<Persona | null> {
    const persona = await this.findById(personaId);
    if (!persona) return null;
    return this.baseRepo.addTag(personaId, tagId);
  }

  async removeTag(personaId: string, tagId: string): Promise<Persona | null> {
    const persona = await this.findById(personaId);
    if (!persona) return null;
    return this.baseRepo.removeTag(personaId, tagId);
  }

  async addDescription(personaId: string, description: any): Promise<any> {
    const persona = await this.findById(personaId);
    if (!persona) return null;
    return this.baseRepo.addDescription(personaId, description);
  }

  async updateDescription(personaId: string, descriptionId: string, data: any): Promise<any> {
    const persona = await this.findById(personaId);
    if (!persona) return null;
    return this.baseRepo.updateDescription(personaId, descriptionId, data);
  }

  async removeDescription(personaId: string, descriptionId: string): Promise<boolean> {
    const persona = await this.findById(personaId);
    if (!persona) return false;
    return this.baseRepo.removeDescription(personaId, descriptionId);
  }

  async getDescription(personaId: string, descriptionId: string): Promise<any> {
    const persona = await this.findById(personaId);
    if (!persona) return null;
    return this.baseRepo.getDescription(personaId, descriptionId);
  }

  async getDescriptions(personaId: string): Promise<any[]> {
    const persona = await this.findById(personaId);
    if (!persona) return [];
    return this.baseRepo.getDescriptions(personaId);
  }

  async addCharacterLink(personaId: string, characterId: string): Promise<Persona | null> {
    const persona = await this.findById(personaId);
    if (!persona) return null;
    return this.baseRepo.addCharacterLink(personaId, characterId);
  }

  async removeCharacterLink(personaId: string, characterId: string): Promise<Persona | null> {
    const persona = await this.findById(personaId);
    if (!persona) return null;
    return this.baseRepo.removeCharacterLink(personaId, characterId);
  }
}

/**
 * User-scoped Chats Repository
 */
class UserScopedChatsRepository {
  constructor(
    private readonly userId: string,
    private readonly baseRepo: MongoChatsRepository
  ) {}

  async findAll(): Promise<ChatMetadata[]> {
    return this.baseRepo.findByUserId(this.userId);
  }

  async findById(id: string): Promise<ChatMetadata | null> {
    const chat = await this.baseRepo.findById(id);
    if (!chat || chat.userId !== this.userId) {
      return null;
    }
    return chat;
  }

  async findByCharacterId(characterId: string): Promise<ChatMetadata[]> {
    const chats = await this.baseRepo.findByCharacterId(characterId);
    return chats.filter(c => c.userId === this.userId);
  }

  async findByTag(tagId: string): Promise<ChatMetadata[]> {
    const chats = await this.baseRepo.findByTag(tagId);
    return chats.filter(c => c.userId === this.userId);
  }

  async create(data: Omit<ChatMetadata, 'id' | 'createdAt' | 'updatedAt' | 'userId'>): Promise<ChatMetadata> {
    return this.baseRepo.create({ ...data, userId: this.userId });
  }

  async update(id: string, data: Partial<ChatMetadata>): Promise<ChatMetadata | null> {
    const chat = await this.findById(id);
    if (!chat) return null;
    const { userId: _, ...safeData } = data;
    return this.baseRepo.update(id, safeData);
  }

  async delete(id: string): Promise<boolean> {
    const chat = await this.findById(id);
    if (!chat) return false;
    return this.baseRepo.delete(id);
  }

  async getMessages(chatId: string): Promise<ChatEvent[]> {
    const chat = await this.findById(chatId);
    if (!chat) return [];
    return this.baseRepo.getMessages(chatId);
  }

  async addMessage(chatId: string, message: ChatEvent): Promise<ChatEvent> {
    const chat = await this.findById(chatId);
    if (!chat) throw new Error('Chat not found or access denied');
    return this.baseRepo.addMessage(chatId, message);
  }

  async clearMessages(chatId: string): Promise<boolean> {
    const chat = await this.findById(chatId);
    if (!chat) throw new Error('Chat not found or access denied');
    return this.baseRepo.clearMessages(chatId);
  }

  async addTag(chatId: string, tagId: string): Promise<ChatMetadata | null> {
    const chat = await this.findById(chatId);
    if (!chat) return null;
    return this.baseRepo.addTag(chatId, tagId);
  }

  async removeTag(chatId: string, tagId: string): Promise<ChatMetadata | null> {
    const chat = await this.findById(chatId);
    if (!chat) return null;
    return this.baseRepo.removeTag(chatId, tagId);
  }
}

/**
 * User-scoped Tags Repository
 */
class UserScopedTagsRepository {
  constructor(
    private readonly userId: string,
    private readonly baseRepo: MongoTagsRepository
  ) {}

  async findAll(): Promise<Tag[]> {
    return this.baseRepo.findByUserId(this.userId);
  }

  async findById(id: string): Promise<Tag | null> {
    const tag = await this.baseRepo.findById(id);
    if (!tag || tag.userId !== this.userId) {
      return null;
    }
    return tag;
  }

  async findByName(name: string): Promise<Tag | null> {
    const tag = await this.baseRepo.findByName(name, this.userId);
    return tag;
  }

  async create(data: Omit<Tag, 'id' | 'createdAt' | 'updatedAt' | 'userId'>): Promise<Tag> {
    return this.baseRepo.create({ ...data, userId: this.userId });
  }

  async update(id: string, data: Partial<Tag>): Promise<Tag | null> {
    const tag = await this.findById(id);
    if (!tag) return null;
    const { userId: _, ...safeData } = data;
    return this.baseRepo.update(id, safeData);
  }

  async delete(id: string): Promise<boolean> {
    const tag = await this.findById(id);
    if (!tag) return false;
    return this.baseRepo.delete(id);
  }
}

/**
 * User-scoped Connection Profiles Repository (includes API keys)
 */
class UserScopedConnectionsRepository {
  constructor(
    private readonly userId: string,
    private readonly baseRepo: ConnectionProfilesRepository
  ) {}

  // Connection Profiles
  async findAll(): Promise<ConnectionProfile[]> {
    return this.baseRepo.findByUserId(this.userId);
  }

  async findById(id: string): Promise<ConnectionProfile | null> {
    const profile = await this.baseRepo.findById(id);
    if (!profile || profile.userId !== this.userId) {
      return null;
    }
    return profile;
  }

  async findDefault(): Promise<ConnectionProfile | null> {
    return this.baseRepo.findDefault(this.userId);
  }

  async findByTag(tagId: string): Promise<ConnectionProfile[]> {
    const profiles = await this.baseRepo.findByTag(tagId);
    return profiles.filter(p => p.userId === this.userId);
  }

  async create(data: Omit<ConnectionProfile, 'id' | 'createdAt' | 'updatedAt' | 'userId'>): Promise<ConnectionProfile> {
    return this.baseRepo.create({ ...data, userId: this.userId });
  }

  async update(id: string, data: Partial<ConnectionProfile>): Promise<ConnectionProfile | null> {
    const profile = await this.findById(id);
    if (!profile) return null;
    const { userId: _, ...safeData } = data;
    return this.baseRepo.update(id, safeData);
  }

  async delete(id: string): Promise<boolean> {
    const profile = await this.findById(id);
    if (!profile) return false;
    return this.baseRepo.delete(id);
  }

  async addTag(profileId: string, tagId: string): Promise<ConnectionProfile | null> {
    const profile = await this.findById(profileId);
    if (!profile) return null;
    return this.baseRepo.addTag(profileId, tagId);
  }

  async removeTag(profileId: string, tagId: string): Promise<ConnectionProfile | null> {
    const profile = await this.findById(profileId);
    if (!profile) return null;
    return this.baseRepo.removeTag(profileId, tagId);
  }

  // API Keys - all scoped to user
  async getAllApiKeys(): Promise<ApiKey[]> {
    return this.baseRepo.getApiKeysByUserId(this.userId);
  }

  async findApiKeyById(id: string): Promise<ApiKey | null> {
    return this.baseRepo.findApiKeyByIdAndUserId(id, this.userId);
  }

  async createApiKey(data: Omit<ApiKey, 'id' | 'createdAt' | 'updatedAt' | 'userId'>): Promise<ApiKey> {
    return this.baseRepo.createApiKey({ ...data, userId: this.userId });
  }

  async updateApiKey(id: string, data: Partial<ApiKey>): Promise<ApiKey | null> {
    const apiKey = await this.findApiKeyById(id);
    if (!apiKey) return null;
    const { userId: _, ...safeData } = data;
    return this.baseRepo.updateApiKey(id, safeData);
  }

  async deleteApiKey(id: string): Promise<boolean> {
    const apiKey = await this.findApiKeyById(id);
    if (!apiKey) return false;
    return this.baseRepo.deleteApiKey(id);
  }

  async recordApiKeyUsage(id: string): Promise<ApiKey | null> {
    const apiKey = await this.findApiKeyById(id);
    if (!apiKey) return null;
    return this.baseRepo.recordApiKeyUsage(id);
  }
}

/**
 * User-scoped Image Profiles Repository
 */
class UserScopedImageProfilesRepository {
  constructor(
    private readonly userId: string,
    private readonly baseRepo: MongoImageProfilesRepository
  ) {}

  async findAll(): Promise<ImageProfile[]> {
    return this.baseRepo.findByUserId(this.userId);
  }

  async findById(id: string): Promise<ImageProfile | null> {
    const profile = await this.baseRepo.findById(id);
    if (!profile || profile.userId !== this.userId) {
      return null;
    }
    return profile;
  }

  async findDefault(): Promise<ImageProfile | null> {
    return this.baseRepo.findDefault(this.userId);
  }

  async create(data: Omit<ImageProfile, 'id' | 'createdAt' | 'updatedAt' | 'userId'>): Promise<ImageProfile> {
    return this.baseRepo.create({ ...data, userId: this.userId });
  }

  async update(id: string, data: Partial<ImageProfile>): Promise<ImageProfile | null> {
    const profile = await this.findById(id);
    if (!profile) return null;
    const { userId: _, ...safeData } = data;
    return this.baseRepo.update(id, safeData);
  }

  async delete(id: string): Promise<boolean> {
    const profile = await this.findById(id);
    if (!profile) return false;
    return this.baseRepo.delete(id);
  }
}

/**
 * User-scoped Embedding Profiles Repository
 */
class UserScopedEmbeddingProfilesRepository {
  constructor(
    private readonly userId: string,
    private readonly baseRepo: EmbeddingProfilesRepository
  ) {}

  async findAll(): Promise<EmbeddingProfile[]> {
    return this.baseRepo.findByUserId(this.userId);
  }

  async findById(id: string): Promise<EmbeddingProfile | null> {
    const profile = await this.baseRepo.findById(id);
    if (!profile || profile.userId !== this.userId) {
      return null;
    }
    return profile;
  }

  async findDefault(): Promise<EmbeddingProfile | null> {
    return this.baseRepo.findDefault(this.userId);
  }

  async create(data: Omit<EmbeddingProfile, 'id' | 'createdAt' | 'updatedAt' | 'userId'>): Promise<EmbeddingProfile> {
    return this.baseRepo.create({ ...data, userId: this.userId });
  }

  async update(id: string, data: Partial<EmbeddingProfile>): Promise<EmbeddingProfile | null> {
    const profile = await this.findById(id);
    if (!profile) return null;
    const { userId: _, ...safeData } = data;
    return this.baseRepo.update(id, safeData);
  }

  async delete(id: string): Promise<boolean> {
    const profile = await this.findById(id);
    if (!profile) return false;
    return this.baseRepo.delete(id);
  }
}

/**
 * User-scoped Memories Repository
 */
class UserScopedMemoriesRepository {
  constructor(
    private readonly userId: string,
    private readonly baseRepo: MemoriesRepository,
    private readonly charactersRepo: UserScopedCharactersRepository
  ) {}

  async findByCharacterId(characterId: string): Promise<Memory[]> {
    // Verify user owns the character first
    const character = await this.charactersRepo.findById(characterId);
    if (!character) return [];
    return this.baseRepo.findByCharacterId(characterId);
  }

  async findById(id: string): Promise<Memory | null> {
    const memory = await this.baseRepo.findById(id);
    if (!memory) return null;
    // Verify user owns the character this memory belongs to
    const character = await this.charactersRepo.findById(memory.characterId);
    if (!character) return null;
    return memory;
  }

  async create(data: Omit<Memory, 'id' | 'createdAt' | 'updatedAt'>): Promise<Memory> {
    // Verify user owns the character
    const character = await this.charactersRepo.findById(data.characterId);
    if (!character) throw new Error('Character not found or access denied');
    return this.baseRepo.create(data);
  }

  async update(id: string, data: Partial<Memory>): Promise<Memory | null> {
    const memory = await this.findById(id);
    if (!memory) return null;
    return this.baseRepo.update(id, data);
  }

  async delete(id: string): Promise<boolean> {
    const memory = await this.findById(id);
    if (!memory) return false;
    return this.baseRepo.delete(id);
  }

  async searchByContent(characterId: string, query: string): Promise<Memory[]> {
    const character = await this.charactersRepo.findById(characterId);
    if (!character) return [];
    return this.baseRepo.searchByContent(characterId, query);
  }

  async findByImportance(characterId: string, minImportance: number): Promise<Memory[]> {
    const character = await this.charactersRepo.findById(characterId);
    if (!character) return [];
    return this.baseRepo.findByImportance(characterId, minImportance);
  }

  async findBySource(characterId: string, source: 'AUTO' | 'MANUAL'): Promise<Memory[]> {
    const character = await this.charactersRepo.findById(characterId);
    if (!character) return [];
    return this.baseRepo.findBySource(characterId, source);
  }
}

/**
 * User-scoped Files Repository
 */
class UserScopedFilesRepository {
  constructor(
    private readonly userId: string,
    private readonly baseRepo: FilesRepository
  ) {}

  async findAll(): Promise<FileEntry[]> {
    return this.baseRepo.findByUserId(this.userId);
  }

  async findById(id: string): Promise<FileEntry | null> {
    const file = await this.baseRepo.findById(id);
    if (!file || file.userId !== this.userId) {
      return null;
    }
    return file;
  }

  async findBySha256(sha256: string): Promise<FileEntry[]> {
    const files = await this.baseRepo.findBySha256(sha256);
    return files.filter(f => f.userId === this.userId);
  }

  async findByCategory(category: string): Promise<FileEntry[]> {
    const files = await this.baseRepo.findByCategory(category as any);
    return files.filter(f => f.userId === this.userId);
  }

  async findByLinkedTo(entityId: string): Promise<FileEntry[]> {
    const files = await this.baseRepo.findByLinkedTo(entityId);
    return files.filter(f => f.userId === this.userId);
  }

  async create(data: Omit<FileEntry, 'id' | 'createdAt' | 'updatedAt' | 'userId'>): Promise<FileEntry> {
    return this.baseRepo.create({ ...data, userId: this.userId });
  }

  async update(id: string, data: Partial<FileEntry>): Promise<FileEntry | null> {
    const file = await this.findById(id);
    if (!file) return null;
    const { userId: _, ...safeData } = data;
    return this.baseRepo.update(id, safeData);
  }

  async delete(id: string): Promise<boolean> {
    const file = await this.findById(id);
    if (!file) return false;
    return this.baseRepo.delete(id);
  }

  async addLink(fileId: string, entityId: string): Promise<FileEntry | null> {
    const file = await this.findById(fileId);
    if (!file) return null;
    return this.baseRepo.addLink(fileId, entityId);
  }

  async removeLink(fileId: string, entityId: string): Promise<FileEntry | null> {
    const file = await this.findById(fileId);
    if (!file) return null;
    return this.baseRepo.removeLink(fileId, entityId);
  }

  async addTag(fileId: string, tagId: string): Promise<FileEntry | null> {
    const file = await this.findById(fileId);
    if (!file) return null;
    return this.baseRepo.addTag(fileId, tagId);
  }

  async removeTag(fileId: string, tagId: string): Promise<FileEntry | null> {
    const file = await this.findById(fileId);
    if (!file) return null;
    return this.baseRepo.removeTag(fileId, tagId);
  }
}

/**
 * Container interface for user-scoped repositories
 */
export interface UserScopedRepositoryContainer {
  /** The user ID this container is scoped to */
  readonly userId: string;
  /** Characters repository - only returns user's characters */
  characters: UserScopedCharactersRepository;
  /** Personas repository - only returns user's personas */
  personas: UserScopedPersonasRepository;
  /** Chats repository - only returns user's chats */
  chats: UserScopedChatsRepository;
  /** Tags repository - only returns user's tags */
  tags: UserScopedTagsRepository;
  /** Connection profiles & API keys repository - only returns user's profiles/keys */
  connections: UserScopedConnectionsRepository;
  /** Image profiles repository - only returns user's image profiles */
  imageProfiles: UserScopedImageProfilesRepository;
  /** Embedding profiles repository - only returns user's embedding profiles */
  embeddingProfiles: UserScopedEmbeddingProfilesRepository;
  /** Memories repository - only returns memories for user's characters */
  memories: UserScopedMemoriesRepository;
  /** Files repository - only returns user's files */
  files: UserScopedFilesRepository;
  /** Images repository (alias for files) - only returns user's images */
  images: UserScopedFilesRepository;
}

/**
 * Cache for user-scoped repository containers
 * Key is userId, value is the container
 */
const userRepoCache = new Map<string, UserScopedRepositoryContainer>();

/**
 * Get a user-scoped repository container.
 * All operations through this container are automatically filtered to the specified user.
 *
 * @param userId The user ID to scope all operations to
 * @returns UserScopedRepositoryContainer with all repositories scoped to the user
 *
 * @example
 * ```typescript
 * const repos = getUserRepositories(session.user.id);
 *
 * // All operations are automatically scoped to the user
 * const characters = await repos.characters.findAll(); // Only user's characters
 * const character = await repos.characters.findById(id); // Returns null if not user's
 * const chat = await repos.chats.findById(chatId); // Returns null if not user's
 * ```
 */
export function getUserRepositories(userId: string): UserScopedRepositoryContainer {
  if (!userId) {
    throw new Error('userId is required for getUserRepositories');
  }

  // Check cache first
  const cached = userRepoCache.get(userId);
  if (cached) {
    logger.debug('Returning cached user-scoped repositories', { userId });
    return cached;
  }

  logger.debug('Creating new user-scoped repository container', { userId });

  // Get the base repositories
  const baseRepos = getRepositories();

  // Create user-scoped wrappers
  const characters = new UserScopedCharactersRepository(userId, baseRepos.characters);
  const personas = new UserScopedPersonasRepository(userId, baseRepos.personas);
  const chats = new UserScopedChatsRepository(userId, baseRepos.chats);
  const tags = new UserScopedTagsRepository(userId, baseRepos.tags);
  const connections = new UserScopedConnectionsRepository(userId, baseRepos.connections);
  const imageProfiles = new UserScopedImageProfilesRepository(userId, baseRepos.imageProfiles);
  const embeddingProfiles = new UserScopedEmbeddingProfilesRepository(userId, baseRepos.embeddingProfiles);
  const files = new UserScopedFilesRepository(userId, baseRepos.files);
  const memories = new UserScopedMemoriesRepository(userId, baseRepos.memories, characters);

  const container: UserScopedRepositoryContainer = {
    userId,
    characters,
    personas,
    chats,
    tags,
    connections,
    imageProfiles,
    embeddingProfiles,
    memories,
    files,
    images: files, // Alias for backwards compatibility
  };

  // Cache the container
  userRepoCache.set(userId, container);

  logger.debug('User-scoped repository container created', { userId });
  return container;
}

/**
 * Clear the user repository cache.
 * Useful for testing or when user data changes significantly.
 */
export function clearUserRepositoryCache(userId?: string): void {
  if (userId) {
    userRepoCache.delete(userId);
    logger.debug('Cleared user repository cache for user', { userId });
  } else {
    userRepoCache.clear();
    logger.debug('Cleared all user repository caches');
  }
}
