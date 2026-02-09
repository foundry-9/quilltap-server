/**
 * Restore Service
 *
 * Restores user data from a backup ZIP archive to the database and S3.
 * Supports two modes:
 * - 'replace': Deletes existing data and restores from backup
 * - 'new-account': Regenerates all UUIDs and imports to a new account
 */

import AdmZip from 'adm-zip';
import fs from 'fs';
import path from 'path';
import { logger } from '@/lib/logger';
import { getUserRepositories } from '@/lib/repositories/user-scoped';
import { getRepositories } from '@/lib/repositories/factory';
import { fileStorageManager } from '@/lib/file-storage/manager';
import { getNpmPluginsDir } from '@/lib/paths';
import { UuidRemapper } from './uuid-remapper';
import type {
  BackupManifest,
  BackupData,
  RestoreOptions,
  RestoreSummary,
  ChatWithMessages,
} from './types';
import type {
  Character,
  Tag,
  ConnectionProfile,
  ImageProfile,
  EmbeddingProfile,
  Memory,
  FileEntry,
  ChatMetadata,
  ChatParticipantBase,
  PhysicalDescription,
  ClothingRecord,
  PromptTemplate,
  RoleplayTemplate,
  ProviderModel,
  Project,
  LLMLog,
  PluginConfig,
} from '@/lib/schemas/types';

const moduleLogger = logger.child({ module: 'backup:restore-service' });

/**
 * Parses a backup ZIP file and extracts its data
 */
export function parseBackupZip(zipBuffer: Buffer): BackupData {
  const zip = new AdmZip(zipBuffer);
  const entries = zip.getEntries();

  // Find the root folder name (quilltap-backup-{timestamp})
  let rootFolder = '';
  for (const entry of entries) {
    if (entry.entryName.includes('manifest.json')) {
      rootFolder = entry.entryName.split('/')[0] + '/';
      break;
    }
  }

  if (!rootFolder) {
    throw new Error('Invalid backup: manifest.json not found');
  }
  // Helper to read JSON from zip
  const readJson = <T>(path: string): T => {
    const entry = zip.getEntry(rootFolder + path);
    if (!entry) {
      throw new Error(`Invalid backup: ${path} not found`);
    }
    const content = entry.getData().toString('utf8');
    return JSON.parse(content) as T;
  };

  // Helper to read JSON from zip with optional fallback for backwards compatibility
  const readJsonOptional = <T>(path: string, fallback: T): T => {
    const entry = zip.getEntry(rootFolder + path);
    if (!entry) {
      return fallback;
    }
    const content = entry.getData().toString('utf8');
    return JSON.parse(content) as T;
  };

  // Read all data files
  const manifest = readJson<BackupManifest>('manifest.json');
  const characters = readJson<Character[]>('data/characters.json');
  const chats = readJson<ChatWithMessages[]>('data/chats.json');
  const tags = readJson<Tag[]>('data/tags.json');
  const connectionProfiles = readJson<ConnectionProfile[]>('data/connection-profiles.json');
  const imageProfiles = readJson<ImageProfile[]>('data/image-profiles.json');
  const embeddingProfiles = readJson<EmbeddingProfile[]>('data/embedding-profiles.json');
  const memories = readJson<Memory[]>('data/memories.json');
  const files = readJson<FileEntry[]>('data/files.json');
  // Templates are optional for backwards compatibility with older backups
  const promptTemplates = readJsonOptional<PromptTemplate[]>('data/prompt-templates.json', []);
  const roleplayTemplates = readJsonOptional<RoleplayTemplate[]>('data/roleplay-templates.json', []);
  // Provider models are optional for backwards compatibility with older backups
  const providerModels = readJsonOptional<ProviderModel[]>('data/provider-models.json', []);
  // Projects are optional for backwards compatibility with older backups
  const projects = readJsonOptional<Project[]>('data/projects.json', []);
  // LLM logs are optional for backwards compatibility with older backups
  const llmLogs = readJsonOptional<LLMLog[]>('data/llm-logs.json', []);
  // Plugin configs are optional for backwards compatibility with older backups
  const pluginConfigs = readJsonOptional<PluginConfig[]>('data/plugin-configs.json', []);

  moduleLogger.info('Parsed backup ZIP', {
    version: manifest.version,
    createdAt: manifest.createdAt,
    counts: manifest.counts,
  });

  return {
    manifest,
    characters,
    chats,
    tags,
    connectionProfiles,
    imageProfiles,
    embeddingProfiles,
    memories,
    files,
    promptTemplates,
    roleplayTemplates,
    providerModels,
    projects,
    llmLogs,
    pluginConfigs,
  };
}

/**
 * Gets a file from the backup ZIP by its metadata
 */
export function getFileFromZip(
  zipBuffer: Buffer,
  file: FileEntry
): Buffer | null {
  const zip = new AdmZip(zipBuffer);
  const entries = zip.getEntries();

  // Find the root folder
  let rootFolder = '';
  for (const entry of entries) {
    if (entry.entryName.includes('manifest.json')) {
      rootFolder = entry.entryName.split('/')[0] + '/';
      break;
    }
  }

  // Look for the file
  const expectedPath = `${rootFolder}files/${file.category}/${file.id}_${file.originalFilename}`;
  const entry = zip.getEntry(expectedPath);

  if (!entry) {
    moduleLogger.warn('File not found in backup ZIP', { expectedPath, fileId: file.id });
    return null;
  }

  return entry.getData();
}

/**
 * Counts npm plugins in a backup ZIP
 */
function countNpmPluginsInZip(zipBuffer: Buffer): number {
  const zip = new AdmZip(zipBuffer);
  const entries = zip.getEntries();

  // Find the root folder
  let rootFolder = '';
  for (const entry of entries) {
    if (entry.entryName.includes('manifest.json')) {
      rootFolder = entry.entryName.split('/')[0] + '/';
      break;
    }
  }

  if (!rootFolder) return 0;

  // Count unique plugin directories in plugins/npm/
  const pluginPrefix = `${rootFolder}plugins/npm/`;
  const pluginNames = new Set<string>();

  for (const entry of entries) {
    if (entry.entryName.startsWith(pluginPrefix)) {
      const relativePath = entry.entryName.substring(pluginPrefix.length);
      const pluginName = relativePath.split('/')[0];
      if (pluginName) {
        pluginNames.add(pluginName);
      }
    }
  }

  return pluginNames.size;
}

/**
 * Previews what will be restored without actually restoring
 */
export function previewRestore(zipBuffer: Buffer): RestoreSummary {
  const data = parseBackupZip(zipBuffer);

  const totalMessages = data.chats.reduce((sum, chat) => sum + chat.messages.length, 0);
  const npmPluginCount = countNpmPluginsInZip(zipBuffer);

  return {
    characters: data.characters.length,
    chats: data.chats.length,
    messages: totalMessages,
    tags: data.tags.length,
    files: data.files.length,
    memories: data.memories.length,
    profiles: {
      connection: data.connectionProfiles.length,
      image: data.imageProfiles.length,
      embedding: data.embeddingProfiles.length,
    },
    templates: {
      prompt: data.promptTemplates.length,
      roleplay: data.roleplayTemplates.length,
    },
    providerModels: data.providerModels.length,
    projects: data.projects.length,
    llmLogs: data.llmLogs.length,
    pluginConfigs: data.pluginConfigs?.length || 0,
    npmPlugins: npmPluginCount,
    warnings: [],
  };
}

/**
 * Deletes all user data before restore (for 'replace' mode)
 * Also used for the "delete all data" feature
 */
async function deleteUserData(userId: string): Promise<void> {
  moduleLogger.info('Deleting existing user data for replace mode', { userId });

  const repos = getUserRepositories(userId);
  const globalRepos = getRepositories();

  // Get all entities to delete
  const [characters, chats, tags, files, connectionProfiles, imageProfiles, embeddingProfiles, promptTemplates, roleplayTemplates, projects, llmLogs] =
    await Promise.all([
      repos.characters.findAll(),
      repos.chats.findAll(),
      repos.tags.findAll(),
      repos.files.findAll(),
      repos.connections.findAll(),
      repos.imageProfiles.findAll(),
      repos.embeddingProfiles.findAll(),
      globalRepos.promptTemplates.findByUserId(userId),
      globalRepos.roleplayTemplates.findByUserId(userId),
      repos.projects.findAll(),
      repos.llmLogs.findAll(10000), // High limit to get all user logs
    ]);

  // Delete memories for each character first
  for (const character of characters) {
    const memories = await repos.memories.findByCharacterId(character.id);
    for (const memory of memories) {
      await repos.memories.delete(memory.id);
    }
  }

  // Delete all entities (including user-created templates, projects, and LLM logs)
  await Promise.all([
    ...characters.map((c) => repos.characters.delete(c.id)),
    ...chats.map((c) => repos.chats.delete(c.id)),
    ...tags.map((t) => repos.tags.delete(t.id)),
    ...connectionProfiles.map((cp) => repos.connections.delete(cp.id)),
    ...imageProfiles.map((ip) => repos.imageProfiles.delete(ip.id)),
    ...embeddingProfiles.map((ep) => repos.embeddingProfiles.delete(ep.id)),
    ...promptTemplates.map((pt) => globalRepos.promptTemplates.delete(pt.id)),
    ...roleplayTemplates.map((rt) => globalRepos.roleplayTemplates.delete(rt.id)),
    ...projects.map((p) => repos.projects.delete(p.id)),
    ...llmLogs.map((log) => repos.llmLogs.delete(log.id)),
  ]);

  // Delete files from storage
  for (const file of files) {
    try {
      if (file.storageKey) {
        await fileStorageManager.deleteFile(file);
      }
      await repos.files.delete(file.id);
    } catch (error) {
      moduleLogger.warn('Failed to delete file during cleanup', {
        fileId: file.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  moduleLogger.info('Deleted existing user data', {
    userId,
    deletedCounts: {
      characters: characters.length,
      chats: chats.length,
      tags: tags.length,
      files: files.length,
      connectionProfiles: connectionProfiles.length,
      imageProfiles: imageProfiles.length,
      embeddingProfiles: embeddingProfiles.length,
      promptTemplates: promptTemplates.length,
      roleplayTemplates: roleplayTemplates.length,
      projects: projects.length,
      llmLogs: llmLogs.length,
    },
  });
}

/**
 * Summary of deleted data counts
 */
export interface DeleteSummary {
  characters: number;
  chats: number;
  tags: number;
  files: number;
  memories: number;
  apiKeys: number;
  backups: number;
  projects: number;
  profiles: {
    connection: number;
    image: number;
    embedding: number;
  };
  templates: {
    prompt: number;
    roleplay: number;
  };
}

/**
 * Deletes all user data including API keys and backups
 * This is a complete account reset
 */
export async function deleteAllUserData(userId: string): Promise<DeleteSummary> {
  moduleLogger.info('Starting complete user data deletion', { userId });

  const repos = getUserRepositories(userId);
  const globalRepos = getRepositories();

  // First, count everything before deletion
  const [characters, chats, tags, files, connectionProfiles, imageProfiles, embeddingProfiles, apiKeys, promptTemplates, roleplayTemplates, projects] =
    await Promise.all([
      repos.characters.findAll(),
      repos.chats.findAll(),
      repos.tags.findAll(),
      repos.files.findAll(),
      repos.connections.findAll(),
      repos.imageProfiles.findAll(),
      repos.embeddingProfiles.findAll(),
      repos.connections.getAllApiKeys(),
      globalRepos.promptTemplates.findByUserId(userId),
      globalRepos.roleplayTemplates.findByUserId(userId),
      repos.projects.findAll(),
    ]);

  // Count memories
  let memoriesCount = 0;
  for (const character of characters) {
    const memories = await repos.memories.findByCharacterId(character.id);
    memoriesCount += memories.length;
  }

  // List and count backups
  const allBackupFiles = files.filter(
    (f: FileEntry) => f.folderPath === '/backups' || f.originalFilename?.endsWith('.zip')
  );
  const backupsCount = allBackupFiles.length;

  // Now delete everything using the existing function (includes templates)
  await deleteUserData(userId);

  // Delete API keys
  for (const apiKey of apiKeys) {
    try {
      await repos.connections.deleteApiKey(apiKey.id);
    } catch (error) {
      moduleLogger.warn('Failed to delete API key', {
        apiKeyId: apiKey.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Delete backups from storage (note: already deleted by deleteUserData above)
  // but we log for clarity
  moduleLogger.info('Backups deleted with other files', {
    backupsCount,
  });

  const summary: DeleteSummary = {
    characters: characters.length,
    chats: chats.length,
    tags: tags.length,
    files: files.length,
    memories: memoriesCount,
    apiKeys: apiKeys.length,
    backups: backupsCount,
    projects: projects.length,
    profiles: {
      connection: connectionProfiles.length,
      image: imageProfiles.length,
      embedding: embeddingProfiles.length,
    },
    templates: {
      prompt: promptTemplates.length,
      roleplay: roleplayTemplates.length,
    },
  };

  moduleLogger.info('Complete user data deletion finished', { userId, summary });

  return summary;
}

/**
 * Preview what will be deleted (counts only, no actual deletion)
 */
export async function previewDeleteAllUserData(userId: string): Promise<DeleteSummary> {
  const repos = getUserRepositories(userId);
  const globalRepos = getRepositories();

  const [characters, chats, tags, files, connectionProfiles, imageProfiles, embeddingProfiles, apiKeys, promptTemplates, roleplayTemplates, projects] =
    await Promise.all([
      repos.characters.findAll(),
      repos.chats.findAll(),
      repos.tags.findAll(),
      repos.files.findAll(),
      repos.connections.findAll(),
      repos.imageProfiles.findAll(),
      repos.embeddingProfiles.findAll(),
      repos.connections.getAllApiKeys(),
      globalRepos.promptTemplates.findByUserId(userId),
      globalRepos.roleplayTemplates.findByUserId(userId),
      repos.projects.findAll(),
    ]);

  // Count memories
  let memoriesCount = 0;
  for (const character of characters) {
    const memories = await repos.memories.findByCharacterId(character.id);
    memoriesCount += memories.length;
  }

  // List and count backups from files
  const backupFiles = files.filter(
    (f: FileEntry) => f.folderPath === '/backups' || f.originalFilename?.endsWith('.zip')
  );

  return {
    characters: characters.length,
    chats: chats.length,
    tags: tags.length,
    files: files.length,
    memories: memoriesCount,
    apiKeys: apiKeys.length,
    backups: backupFiles.length,
    projects: projects.length,
    profiles: {
      connection: connectionProfiles.length,
      image: imageProfiles.length,
      embedding: embeddingProfiles.length,
    },
    templates: {
      prompt: promptTemplates.length,
      roleplay: roleplayTemplates.length,
    },
  };
}

/**
 * Remaps all UUIDs in the backup data for new-account mode
 */
function remapBackupData(
  data: BackupData,
  targetUserId: string,
  remapper: UuidRemapper
): BackupData {
  // Remap tags
  const remappedTags = data.tags.map((tag) => ({
    ...remapper.remapFields(tag, ['id']),
    userId: targetUserId,
  }));

  // Remap files
  const remappedFiles = data.files.map((file) => ({
    ...remapper.remapFields(file, ['id']),
    ...remapper.remapArrayFields(file, ['linkedTo', 'tags']),
    userId: targetUserId,
  }));

  // Remap characters
  const remappedCharacters = data.characters.map((char) => {
    const remapped = {
      ...remapper.remapFields(char, ['id', 'defaultImageId', 'defaultConnectionProfileId', 'defaultPartnerId']),
      ...remapper.remapArrayFields(char, ['tags']),
      userId: targetUserId,
    };
    // Handle personaLinks array of objects
    if (remapped.personaLinks) {
      remapped.personaLinks = remapped.personaLinks.map((link: { personaId: string; isDefault: boolean }) => ({
        ...link,
        personaId: remapper.remap(link.personaId),
      }));
    }
    // Handle avatarOverrides
    if (remapped.avatarOverrides) {
      remapped.avatarOverrides = remapped.avatarOverrides.map((override: { chatId: string; imageId: string }) => ({
        chatId: remapper.remap(override.chatId),
        imageId: remapper.remap(override.imageId),
      }));
    }
    // Handle physicalDescriptions
    if (remapped.physicalDescriptions) {
      remapped.physicalDescriptions = remapped.physicalDescriptions.map((desc: PhysicalDescription) => ({
        ...desc,
        id: remapper.remap(desc.id),
      }));
    }
    // Handle clothingRecords
    if (remapped.clothingRecords) {
      remapped.clothingRecords = remapped.clothingRecords.map((record: ClothingRecord) => ({
        ...record,
        id: remapper.remap(record.id),
      }));
    }
    return remapped as Character;
  });


  // Remap connection profiles
  const remappedConnectionProfiles = data.connectionProfiles.map((profile) => ({
    ...remapper.remapFields(profile, ['id', 'apiKeyId']),
    ...remapper.remapArrayFields(profile, ['tags']),
    userId: targetUserId,
  })) as ConnectionProfile[];

  // Remap image profiles
  const remappedImageProfiles = data.imageProfiles.map((profile) => ({
    ...remapper.remapFields(profile, ['id', 'apiKeyId']),
    ...remapper.remapArrayFields(profile, ['tags']),
    userId: targetUserId,
  })) as ImageProfile[];

  // Remap embedding profiles
  const remappedEmbeddingProfiles = data.embeddingProfiles.map((profile) => ({
    ...remapper.remapFields(profile, ['id', 'apiKeyId']),
    ...remapper.remapArrayFields(profile, ['tags']),
    userId: targetUserId,
  })) as EmbeddingProfile[];

  // Remap chats (complex due to participants and messages)
  const remappedChats = data.chats.map((chat) => {
    const remappedChat = {
      ...remapper.remapFields(chat, ['id', 'activeTypingParticipantId']),
      ...remapper.remapArrayFields(chat, ['tags', 'impersonatingParticipantIds']),
      userId: targetUserId,
    };

    // Remap participants
    remappedChat.participants = chat.participants.map((participant: ChatParticipantBase) => ({
      ...remapper.remapFields(participant, [
        'id',
        'characterId',
        'connectionProfileId',
        'imageProfileId',
      ]),
    })) as ChatParticipantBase[];

    // Remap messages
    remappedChat.messages = chat.messages.map((msg) => ({
      ...remapper.remapFields(msg, ['id', 'swipeGroupId']),
      ...remapper.remapArrayFields(msg, ['attachments']),
    }));

    return remappedChat as ChatWithMessages;
  });

  // Remap memories
  const remappedMemories = data.memories.map((memory) => ({
    ...remapper.remapFields(memory, ['id', 'characterId', 'aboutCharacterId', 'chatId', 'sourceMessageId']),
    ...remapper.remapArrayFields(memory, ['tags']),
  })) as Memory[];

  // Remap prompt templates
  const remappedPromptTemplates = data.promptTemplates.map((template) => ({
    ...remapper.remapFields(template, ['id']),
    ...remapper.remapArrayFields(template, ['tags']),
    userId: targetUserId,
  })) as PromptTemplate[];

  // Remap roleplay templates
  const remappedRoleplayTemplates = data.roleplayTemplates.map((template) => ({
    ...remapper.remapFields(template, ['id']),
    ...remapper.remapArrayFields(template, ['tags']),
    userId: targetUserId,
  })) as RoleplayTemplate[];

  // Provider models are global and don't need remapping, just copy them
  const remappedProviderModels = data.providerModels;

  // Remap projects
  const remappedProjects = data.projects.map((project) => ({
    ...remapper.remapFields(project, ['id']),
    ...remapper.remapArrayFields(project, ['characterRoster']),
    userId: targetUserId,
  })) as Project[];

  // Remap LLM logs
  const remappedLLMLogs = data.llmLogs.map((log) => ({
    ...remapper.remapFields(log, ['id', 'messageId', 'chatId', 'characterId']),
    userId: targetUserId,
  })) as LLMLog[];

  // Remap plugin configs
  const remappedPluginConfigs = (data.pluginConfigs || []).map((config) => ({
    ...remapper.remapFields(config, ['id']),
    userId: targetUserId,
  })) as PluginConfig[];

  return {
    manifest: data.manifest,
    characters: remappedCharacters,
    chats: remappedChats,
    tags: remappedTags as Tag[],
    connectionProfiles: remappedConnectionProfiles,
    imageProfiles: remappedImageProfiles,
    embeddingProfiles: remappedEmbeddingProfiles,
    memories: remappedMemories,
    files: remappedFiles as FileEntry[],
    promptTemplates: remappedPromptTemplates,
    roleplayTemplates: remappedRoleplayTemplates,
    providerModels: remappedProviderModels,
    projects: remappedProjects,
    llmLogs: remappedLLMLogs,
    pluginConfigs: remappedPluginConfigs,
  };
}

/**
 * Restores data from a backup ZIP
 */
export async function restore(
  zipBuffer: Buffer,
  options: RestoreOptions
): Promise<RestoreSummary> {
  const { mode, targetUserId } = options;

  moduleLogger.info('Starting restore operation', { mode, targetUserId });

  const warnings: string[] = [];
  let data = parseBackupZip(zipBuffer);

  // For replace mode, delete existing data first
  if (mode === 'replace') {
    await deleteUserData(targetUserId);
  }

  // For new-account mode, remap all UUIDs
  if (mode === 'new-account') {
    const remapper = new UuidRemapper();
    data = remapBackupData(data, targetUserId, remapper);
  }

  const repos = getUserRepositories(targetUserId);

  // ID mapping tables to track backup IDs -> newly created IDs
  // This is necessary because repositories generate new IDs during create()
  const tagIdMap = new Map<string, string>();
  const connectionProfileIdMap = new Map<string, string>();
  const imageProfileIdMap = new Map<string, string>();
  const embeddingProfileIdMap = new Map<string, string>();
  const fileIdMap = new Map<string, string>();
  const characterIdMap = new Map<string, string>();
  const chatIdMap = new Map<string, string>();
  const projectIdMap = new Map<string, string>();

  // Restore in dependency order
  // 1. Tags (no dependencies)
  for (const tag of data.tags) {
    try {
      const { id: backupId, userId, createdAt, updatedAt, ...tagData } = tag;
      const createdTag = await repos.tags.create({ ...tagData, nameLower: tagData.nameLower || tagData.name.toLowerCase() });
      tagIdMap.set(backupId, createdTag.id);
    } catch (error) {
      warnings.push(`Failed to restore tag "${tag.name}": ${error instanceof Error ? error.message : String(error)}`);
      moduleLogger.warn('Failed to restore tag', { tagId: tag.id, error });
    }
  }

  // 2. Connection profiles (no entity dependencies, but have tag refs)
  for (const profile of data.connectionProfiles) {
    try {
      const { id: backupId, userId, createdAt, updatedAt, apiKeyId, ...profileData } = profile;
      // Note: apiKeyId is not restored as API keys are encrypted and can't be restored
      const createdProfile = await repos.connections.create({ ...profileData, apiKeyId: null });
      connectionProfileIdMap.set(backupId, createdProfile.id);
    } catch (error) {
      warnings.push(`Failed to restore connection profile "${profile.name}": ${error instanceof Error ? error.message : String(error)}`);
      moduleLogger.warn('Failed to restore connection profile', { profileId: profile.id, error });
    }
  }

  // 3. Image profiles
  for (const profile of data.imageProfiles) {
    try {
      const { id: backupId, userId, createdAt, updatedAt, apiKeyId, ...profileData } = profile;
      const createdProfile = await repos.imageProfiles.create({ ...profileData, apiKeyId: null });
      imageProfileIdMap.set(backupId, createdProfile.id);
    } catch (error) {
      warnings.push(`Failed to restore image profile "${profile.name}": ${error instanceof Error ? error.message : String(error)}`);
      moduleLogger.warn('Failed to restore image profile', { profileId: profile.id, error });
    }
  }

  // 4. Embedding profiles
  for (const profile of data.embeddingProfiles) {
    try {
      const { id: backupId, userId, createdAt, updatedAt, apiKeyId, ...profileData } = profile;
      const createdProfile = await repos.embeddingProfiles.create({ ...profileData, apiKeyId: null });
      embeddingProfileIdMap.set(backupId, createdProfile.id);
    } catch (error) {
      warnings.push(`Failed to restore embedding profile "${profile.name}": ${error instanceof Error ? error.message : String(error)}`);
      moduleLogger.warn('Failed to restore embedding profile', { profileId: profile.id, error });
    }
  }

  // 5. Files (upload to storage and create metadata)
  let filesRestored = 0;
  for (const file of data.files) {
    try {
      const fileBuffer = getFileFromZip(zipBuffer, file);
      if (fileBuffer) {
        // Upload to storage using file storage manager
        const uploadResult = await fileStorageManager.uploadFile({
          userId: targetUserId,
          fileId: file.id,
          filename: file.originalFilename,
          content: fileBuffer,
          contentType: file.mimeType,
          projectId: file.projectId || null,
          folderPath: file.folderPath || '/',
        });

        // Create file metadata with storage key and mount point ID
        const { id: backupId, userId, createdAt, updatedAt, s3Key, s3Bucket, storageKey, mountPointId, ...fileData } = file;
        const createdFile = await repos.files.create(
          {
            ...fileData,
            storageKey: uploadResult.storageKey,
            mountPointId: uploadResult.mountPointId,
          },
          { id: file.id }
        );
        fileIdMap.set(backupId, createdFile.id);
        filesRestored++;
      } else {
        warnings.push(`File not found in backup: ${file.originalFilename}`);
      }
    } catch (error) {
      warnings.push(`Failed to restore file "${file.originalFilename}": ${error instanceof Error ? error.message : String(error)}`);
      moduleLogger.warn('Failed to restore file', { fileId: file.id, error });
    }
  }

  // 6. Characters
  for (const character of data.characters) {
    try {
      const { id: backupId, userId, createdAt, updatedAt, ...charData } = character;
      const createdCharacter = await repos.characters.create(charData);
      // Track the mapping from backup ID to newly created ID
      characterIdMap.set(backupId, createdCharacter.id);
    } catch (error) {
      warnings.push(`Failed to restore character "${character.name}": ${error instanceof Error ? error.message : String(error)}`);
      moduleLogger.warn('Failed to restore character', { characterId: character.id, error });
    }
  }

  // 7. Chats (with messages)
  let messagesRestored = 0;
  for (const chat of data.chats) {
    try {
      const { id: backupId, userId, createdAt, updatedAt, messages, ...chatData } = chat;
      const createdChat = await repos.chats.create(chatData);
      chatIdMap.set(backupId, createdChat.id);

      // Add messages to the chat
      for (const message of messages) {
        try {
          await repos.chats.addMessage(createdChat.id, message);
          messagesRestored++;
        } catch (msgError) {
          warnings.push(`Failed to restore message in chat "${chat.title}": ${msgError instanceof Error ? msgError.message : String(msgError)}`);
        }
      }
    } catch (error) {
      warnings.push(`Failed to restore chat "${chat.title}": ${error instanceof Error ? error.message : String(error)}`);
      moduleLogger.warn('Failed to restore chat', { chatId: chat.id, error });
    }
  }

  // 9. Memories
  // Note: Characters Not Personas migration (Phase 7) will convert personaId to aboutCharacterId
  // after restore if needed. For new backups, aboutCharacterId may already be set.
  for (const memory of data.memories) {
    try {
      const { id, createdAt, updatedAt, ...memoryData } = memory;

      // Remap characterId to the newly created character's ID
      const newCharacterId = characterIdMap.get(memoryData.characterId);
      if (!newCharacterId) {
        warnings.push(`Failed to restore memory: Character ID ${memoryData.characterId} not found in restored characters`);
        moduleLogger.warn('Failed to restore memory - character not found', {
          memoryId: memory.id,
          backupCharacterId: memoryData.characterId,
        });
        continue;
      }

      // Personas are no longer supported; clear personaId for backwards compatibility
      const newPersonaId = null;

      // Remap aboutCharacterId if present (new backups with Characters Not Personas)
      let newAboutCharacterId = memoryData.aboutCharacterId;
      if (memoryData.aboutCharacterId) {
        newAboutCharacterId = characterIdMap.get(memoryData.aboutCharacterId) || null;
        if (!newAboutCharacterId) {
        }
      }

      await repos.memories.create({
        ...memoryData,
        characterId: newCharacterId,
        personaId: newPersonaId,
        aboutCharacterId: newAboutCharacterId,
      });
    } catch (error) {
      warnings.push(`Failed to restore memory: ${error instanceof Error ? error.message : String(error)}`);
      moduleLogger.warn('Failed to restore memory', { memoryId: memory.id, error });
    }
  }

  // 10. Prompt Templates (user-created only)
  const globalRepos = getRepositories();
  let promptTemplatesRestored = 0;
  for (const template of data.promptTemplates) {
    try {
      const { id, userId, createdAt, updatedAt, ...templateData } = template;
      await globalRepos.promptTemplates.create({
        ...templateData,
        userId: targetUserId,
      });
      promptTemplatesRestored++;
    } catch (error) {
      warnings.push(`Failed to restore prompt template "${template.name}": ${error instanceof Error ? error.message : String(error)}`);
      moduleLogger.warn('Failed to restore prompt template', { templateId: template.id, error });
    }
  }

  // 11. Roleplay Templates (user-created only)
  let roleplayTemplatesRestored = 0;
  for (const template of data.roleplayTemplates) {
    try {
      const { id, userId, createdAt, updatedAt, ...templateData } = template;
      await globalRepos.roleplayTemplates.create({
        ...templateData,
        userId: targetUserId,
      });
      roleplayTemplatesRestored++;
    } catch (error) {
      warnings.push(`Failed to restore roleplay template "${template.name}": ${error instanceof Error ? error.message : String(error)}`);
      moduleLogger.warn('Failed to restore roleplay template', { templateId: template.id, error });
    }
  }

  // 12. Provider Models (global cache)
  let providerModelsRestored = 0;
  for (const model of data.providerModels) {
    try {
      const { id, createdAt, updatedAt, ...modelData } = model;
      await globalRepos.providerModels.upsertModel(modelData);
      providerModelsRestored++;
    } catch (error) {
      warnings.push(`Failed to restore provider model "${model.modelId}": ${error instanceof Error ? error.message : String(error)}`);
      moduleLogger.warn('Failed to restore provider model', { modelId: model.modelId, error });
    }
  }

  // 13. Projects
  let projectsRestored = 0;
  for (const project of data.projects) {
    try {
      const { id: backupId, userId, createdAt, updatedAt, ...projectData } = project;
      const createdProject = await repos.projects.create(projectData);
      projectIdMap.set(backupId, createdProject.id);
      projectsRestored++;
    } catch (error) {
      warnings.push(`Failed to restore project "${project.name}": ${error instanceof Error ? error.message : String(error)}`);
      moduleLogger.warn('Failed to restore project', { projectId: project.id, error });
    }
  }

  // 14. LLM Logs
  let llmLogsRestored = 0;
  for (const log of data.llmLogs) {
    try {
      const { id, createdAt, ...logData } = log;
      await repos.llmLogs.create(logData, { id, createdAt });
      llmLogsRestored++;
    } catch (error) {
      warnings.push(`Failed to restore LLM log: ${error instanceof Error ? error.message : String(error)}`);
      moduleLogger.warn('Failed to restore LLM log', { logId: log.id, error });
    }
  }

  // 15. Plugin Configs
  let pluginConfigsRestored = 0;
  for (const config of data.pluginConfigs || []) {
    try {
      const { id, createdAt, updatedAt, ...configData } = config;
      // Use upsert to merge with existing configs or create new ones
      await globalRepos.pluginConfigs.upsertForUserPlugin(
        targetUserId,
        configData.pluginName,
        configData.config as Record<string, unknown>
      );
      pluginConfigsRestored++;
    } catch (error) {
      warnings.push(`Failed to restore plugin config for "${config.pluginName}": ${error instanceof Error ? error.message : String(error)}`);
      moduleLogger.warn('Failed to restore plugin config', { pluginName: config.pluginName, error });
    }
  }

  // 16. NPM Plugins (extract from ZIP to plugins/npm directory)
  let npmPluginsRestored = 0;
  const zip = new AdmZip(zipBuffer);
  const zipEntries = zip.getEntries();

  // Find the root folder
  let rootFolder = '';
  for (const entry of zipEntries) {
    if (entry.entryName.includes('manifest.json')) {
      rootFolder = entry.entryName.split('/')[0] + '/';
      break;
    }
  }

  if (rootFolder) {
    const pluginPrefix = `${rootFolder}plugins/npm/`;
    const npmPluginsDir = getNpmPluginsDir();
    const restoredPluginNames = new Set<string>();

    // Ensure the npm plugins directory exists
    if (!fs.existsSync(npmPluginsDir)) {
      fs.mkdirSync(npmPluginsDir, { recursive: true });
    }

    for (const entry of zipEntries) {
      if (entry.entryName.startsWith(pluginPrefix) && !entry.isDirectory) {
        try {
          const relativePath = entry.entryName.substring(pluginPrefix.length);
          const pluginName = relativePath.split('/')[0];

          if (pluginName) {
            const targetPath = path.join(npmPluginsDir, relativePath);
            const targetDir = path.dirname(targetPath);

            // Create directory if it doesn't exist
            if (!fs.existsSync(targetDir)) {
              fs.mkdirSync(targetDir, { recursive: true });
            }

            // Extract the file
            const fileData = entry.getData();
            fs.writeFileSync(targetPath, new Uint8Array(fileData));
            restoredPluginNames.add(pluginName);
          }
        } catch (error) {
          warnings.push(`Failed to restore npm plugin file "${entry.entryName}": ${error instanceof Error ? error.message : String(error)}`);
          moduleLogger.warn('Failed to restore npm plugin file', { entryName: entry.entryName, error });
        }
      }
    }

    npmPluginsRestored = restoredPluginNames.size;
    if (npmPluginsRestored > 0) {
      moduleLogger.info('Restored npm plugins', {
        count: npmPluginsRestored,
        plugins: Array.from(restoredPluginNames),
      });
    }
  }

  // ============================================================================
  // POST-RESTORE RECONCILIATION PHASE
  // ============================================================================
  // Repositories generate new IDs during create(), so relationship fields still
  // reference backup IDs. This phase updates all entities with the correct IDs.
  // ============================================================================

  moduleLogger.info('Starting post-restore reconciliation phase', {
    idMappings: {
      tags: tagIdMap.size,
      files: fileIdMap.size,
      connectionProfiles: connectionProfileIdMap.size,
      imageProfiles: imageProfileIdMap.size,
      characters: characterIdMap.size,
      chats: chatIdMap.size,
      projects: projectIdMap.size,
    },
  });

  // Helper to remap an ID, returning undefined if not in map (or if original was null/undefined)
  const remapId = (id: string | null | undefined, idMap: Map<string, string>): string | null => {
    if (!id) return null;
    return idMap.get(id) || null;
  };

  // Helper to remap an array of IDs
  const remapIdArray = (ids: string[] | undefined, idMap: Map<string, string>): string[] => {
    if (!ids) return [];
    return ids.map((id) => idMap.get(id) || id).filter((id) => id !== null) as string[];
  };

  // 13. Update characters with correct relationship IDs
  for (const [backupId, newId] of characterIdMap) {
    try {
      // Find the original character data to get relationship fields
      const originalChar = data.characters.find((c) => c.id === backupId);
      if (!originalChar) continue;

      const updates: Partial<Character> = {};
      let hasUpdates = false;

      // Remap defaultImageId
      if (originalChar.defaultImageId) {
        const newImageId = remapId(originalChar.defaultImageId, fileIdMap);
        if (newImageId) {
          updates.defaultImageId = newImageId;
          hasUpdates = true;
        }
      }

      // Remap defaultConnectionProfileId
      if (originalChar.defaultConnectionProfileId) {
        const newProfileId = remapId(originalChar.defaultConnectionProfileId, connectionProfileIdMap);
        if (newProfileId) {
          updates.defaultConnectionProfileId = newProfileId;
          hasUpdates = true;
        }
      }

      // Remap defaultPartnerId (Characters Not Personas: default user-controlled character to pair with)
      if (originalChar.defaultPartnerId) {
        const newPartnerId = remapId(originalChar.defaultPartnerId, characterIdMap);
        if (newPartnerId) {
          updates.defaultPartnerId = newPartnerId;
          hasUpdates = true;
        }
      }

      // Personas are no longer supported; clear personaLinks for backwards compatibility
      if (originalChar.personaLinks && originalChar.personaLinks.length > 0) {
        updates.personaLinks = [];
        hasUpdates = true;
      }

      // Remap avatarOverrides
      if (originalChar.avatarOverrides && originalChar.avatarOverrides.length > 0) {
        updates.avatarOverrides = originalChar.avatarOverrides
          .map((override) => {
            const newChatId = remapId(override.chatId, chatIdMap);
            const newImageId = remapId(override.imageId, fileIdMap);
            if (newChatId && newImageId) {
              return { chatId: newChatId, imageId: newImageId };
            }
            return null;
          })
          .filter((override) => override !== null) as { chatId: string; imageId: string }[];
        hasUpdates = true;
      }

      // Remap tags
      if (originalChar.tags && originalChar.tags.length > 0) {
        const remappedTags = remapIdArray(originalChar.tags, tagIdMap);
        if (remappedTags.length > 0) {
          updates.tags = remappedTags;
          hasUpdates = true;
        }
      }

      if (hasUpdates) {
        await repos.characters.update(newId, updates);
      }
    } catch (error) {
      warnings.push(`Failed to reconcile character relationships: ${error instanceof Error ? error.message : String(error)}`);
      moduleLogger.warn('Failed to reconcile character relationships', { characterId: newId, error });
    }
  }

  // 14. Update chats with correct participant IDs
  for (const [backupId, newId] of chatIdMap) {
    try {
      const originalChat = data.chats.find((c) => c.id === backupId);
      if (!originalChat) continue;

      const updates: Partial<ChatMetadata> = {};
      let hasUpdates = false;

      // Remap participants
      if (originalChat.participants && originalChat.participants.length > 0) {
        updates.participants = originalChat.participants.map((participant) => {
          const remapped: ChatParticipantBase = { ...participant };

          if (participant.characterId) {
            const newCharId = remapId(participant.characterId, characterIdMap);
            if (newCharId) remapped.characterId = newCharId;
          }

          if (participant.connectionProfileId) {
            const newConnId = remapId(participant.connectionProfileId, connectionProfileIdMap);
            if (newConnId) remapped.connectionProfileId = newConnId;
          }

          if (participant.imageProfileId) {
            const newImgProfId = remapId(participant.imageProfileId, imageProfileIdMap);
            if (newImgProfId) remapped.imageProfileId = newImgProfId;
          }

          return remapped;
        });
        hasUpdates = true;
      }

      // Remap tags
      if (originalChat.tags && originalChat.tags.length > 0) {
        const remappedTags = remapIdArray(originalChat.tags, tagIdMap);
        if (remappedTags.length > 0) {
          updates.tags = remappedTags;
          hasUpdates = true;
        }
      }

      // Remap projectId
      if (originalChat.projectId) {
        const newProjectId = remapId(originalChat.projectId, projectIdMap);
        if (newProjectId) {
          updates.projectId = newProjectId;
          hasUpdates = true;
        }
      }

      if (hasUpdates) {
        await repos.chats.update(newId, updates);
      }
    } catch (error) {
      warnings.push(`Failed to reconcile chat relationships: ${error instanceof Error ? error.message : String(error)}`);
      moduleLogger.warn('Failed to reconcile chat relationships', { chatId: newId, error });
    }
  }

  // 15. Update projects with correct characterRoster IDs
  for (const [backupId, newId] of projectIdMap) {
    try {
      const originalProject = data.projects.find((p) => p.id === backupId);
      if (!originalProject) continue;

      const updates: Partial<Project> = {};
      let hasUpdates = false;

      // Remap characterRoster
      if (originalProject.characterRoster && originalProject.characterRoster.length > 0) {
        const remappedRoster = remapIdArray(originalProject.characterRoster, characterIdMap);
        if (remappedRoster.length > 0) {
          updates.characterRoster = remappedRoster;
          hasUpdates = true;
        }
      }

      if (hasUpdates) {
        await repos.projects.update(newId, updates);
      }
    } catch (error) {
      warnings.push(`Failed to reconcile project relationships: ${error instanceof Error ? error.message : String(error)}`);
      moduleLogger.warn('Failed to reconcile project relationships', { projectId: newId, error });
    }
  }

  moduleLogger.info('Post-restore reconciliation phase completed');

  const summary: RestoreSummary = {
    characters: data.characters.length,
    chats: data.chats.length,
    messages: messagesRestored,
    tags: data.tags.length,
    files: filesRestored,
    memories: data.memories.length,
    profiles: {
      connection: data.connectionProfiles.length,
      image: data.imageProfiles.length,
      embedding: data.embeddingProfiles.length,
    },
    templates: {
      prompt: promptTemplatesRestored,
      roleplay: roleplayTemplatesRestored,
    },
    providerModels: providerModelsRestored,
    projects: projectsRestored,
    llmLogs: llmLogsRestored,
    pluginConfigs: pluginConfigsRestored,
    npmPlugins: npmPluginsRestored,
    warnings,
  };

  moduleLogger.info('Restore operation completed', {
    targetUserId,
    mode,
    summary,
    warningCount: warnings.length,
  });

  return summary;
}
