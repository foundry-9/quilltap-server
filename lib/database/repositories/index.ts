/**
 * Database Repositories Index
 *
 * Central export point for all backend-agnostic repository classes.
 * These repositories work with both MongoDB and SQLite through the
 * database abstraction layer.
 */

import { logger } from '@/lib/logger';

// Export base repository and types
export { AbstractBaseRepository, UserOwnedBaseRepository, TaggableBaseRepository } from './base.repository';
export type { CreateOptions, ValidationResult } from './base.repository';

// Export all repository classes
export { BackgroundJobsRepository, type QueueStats } from './background-jobs.repository';
export { CharactersRepository } from './characters.repository';
export { ChatsRepository } from './chats.repository';
export { ChatSettingsRepository } from './chat-settings.repository';
export { ConnectionProfilesRepository } from './connection-profiles.repository';
export { EmbeddingProfilesRepository } from './embedding-profiles.repository';
export { FilePermissionsRepository } from './file-permissions.repository';
export { FilesRepository } from './files.repository';
export { FoldersRepository } from './folders.repository';
export { ImageProfilesRepository } from './image-profiles.repository';
export { LLMLogsRepository } from './llm-logs.repository';
export { MemoriesRepository } from './memories.repository';
export { MountPointsRepository } from './mount-points.repository';
export { PluginConfigRepository } from './plugin-config.repository';
export { ProjectsRepository } from './projects.repository';
export { PromptTemplatesRepository } from './prompt-templates.repository';
export { ProviderModelsRepository } from './provider-models.repository';
export { RoleplayTemplatesRepository } from './roleplay-templates.repository';
export { SyncInstancesRepository } from './sync-instances.repository';
export { SyncMappingsRepository } from './sync-mappings.repository';
export { SyncOperationsRepository } from './sync-operations.repository';
export { TagsRepository } from './tags.repository';
export { UsersRepository } from './users.repository';
export { UserSyncApiKeysRepository } from './user-sync-api-keys.repository';
export { VectorIndicesRepository } from './vector-indices.repository';

// Import all repository classes for container
import { BackgroundJobsRepository } from './background-jobs.repository';
import { CharactersRepository } from './characters.repository';
import { ChatsRepository } from './chats.repository';
import { ChatSettingsRepository } from './chat-settings.repository';
import { ConnectionProfilesRepository } from './connection-profiles.repository';
import { EmbeddingProfilesRepository } from './embedding-profiles.repository';
import { FilePermissionsRepository } from './file-permissions.repository';
import { FilesRepository } from './files.repository';
import { FoldersRepository } from './folders.repository';
import { ImageProfilesRepository } from './image-profiles.repository';
import { LLMLogsRepository } from './llm-logs.repository';
import { MemoriesRepository } from './memories.repository';
import { MountPointsRepository } from './mount-points.repository';
import { PluginConfigRepository } from './plugin-config.repository';
import { ProjectsRepository } from './projects.repository';
import { PromptTemplatesRepository } from './prompt-templates.repository';
import { ProviderModelsRepository } from './provider-models.repository';
import { RoleplayTemplatesRepository } from './roleplay-templates.repository';
import { SyncInstancesRepository } from './sync-instances.repository';
import { SyncMappingsRepository } from './sync-mappings.repository';
import { SyncOperationsRepository } from './sync-operations.repository';
import { TagsRepository } from './tags.repository';
import { UsersRepository } from './users.repository';
import { UserSyncApiKeysRepository } from './user-sync-api-keys.repository';
import { VectorIndicesRepository } from './vector-indices.repository';

/**
 * Container interface for all repository instances.
 * Provides type-safe access to repositories throughout the application.
 */
export interface RepositoryContainer {
  backgroundJobs: BackgroundJobsRepository;
  characters: CharactersRepository;
  chats: ChatsRepository;
  chatSettings: ChatSettingsRepository;
  connections: ConnectionProfilesRepository;
  embeddingProfiles: EmbeddingProfilesRepository;
  filePermissions: FilePermissionsRepository;
  files: FilesRepository;
  folders: FoldersRepository;
  imageProfiles: ImageProfilesRepository;
  images: FilesRepository; // Alias for backwards compatibility
  llmLogs: LLMLogsRepository;
  memories: MemoriesRepository;
  mountPoints: MountPointsRepository;
  pluginConfigs: PluginConfigRepository;
  projects: ProjectsRepository;
  promptTemplates: PromptTemplatesRepository;
  providerModels: ProviderModelsRepository;
  roleplayTemplates: RoleplayTemplatesRepository;
  syncInstances: SyncInstancesRepository;
  syncMappings: SyncMappingsRepository;
  syncOperations: SyncOperationsRepository;
  tags: TagsRepository;
  users: UsersRepository;
  userSyncApiKeys: UserSyncApiKeysRepository;
  vectorIndices: VectorIndicesRepository;
}

/**
 * Singleton instance of the repository container
 */
let repositoryInstance: RepositoryContainer | null = null;

/**
 * Create a new instance of all repositories.
 * This function instantiates all repository classes and returns them in a container.
 *
 * @returns {RepositoryContainer} Container with all repository instances
 */
export function createRepositories(): RepositoryContainer {
  try {
    const filesRepo = new FilesRepository();

    const repositories: RepositoryContainer = {
      backgroundJobs: new BackgroundJobsRepository(),
      characters: new CharactersRepository(),
      chats: new ChatsRepository(),
      chatSettings: new ChatSettingsRepository(),
      connections: new ConnectionProfilesRepository(),
      embeddingProfiles: new EmbeddingProfilesRepository(),
      filePermissions: new FilePermissionsRepository(),
      files: filesRepo,
      folders: new FoldersRepository(),
      imageProfiles: new ImageProfilesRepository(),
      images: filesRepo, // Alias for backwards compatibility
      llmLogs: new LLMLogsRepository(),
      memories: new MemoriesRepository(),
      mountPoints: new MountPointsRepository(),
      pluginConfigs: new PluginConfigRepository(),
      projects: new ProjectsRepository(),
      promptTemplates: new PromptTemplatesRepository(),
      providerModels: new ProviderModelsRepository(),
      roleplayTemplates: new RoleplayTemplatesRepository(),
      syncInstances: new SyncInstancesRepository(),
      syncMappings: new SyncMappingsRepository(),
      syncOperations: new SyncOperationsRepository(),
      tags: new TagsRepository(),
      users: new UsersRepository(),
      userSyncApiKeys: new UserSyncApiKeysRepository(),
      vectorIndices: new VectorIndicesRepository(),
    };
    return repositories;
  } catch (error) {
    logger.error('Failed to create database repository container', {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Get the singleton instance of the repository container.
 * Creates the instance on first call, subsequent calls return the cached instance.
 *
 * @returns {RepositoryContainer} Singleton repository container instance
 */
export function getRepositories(): RepositoryContainer {
  if (!repositoryInstance) {
    repositoryInstance = createRepositories();
  }

  return repositoryInstance;
}

/**
 * Reset the singleton repository instance.
 * Useful for testing to ensure a clean state between tests.
 *
 * @returns {void}
 */
export function resetRepositories(): void {
  repositoryInstance = null;
}
