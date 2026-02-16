/**
 * Restore Service
 *
 * Restores user data from a backup ZIP archive to the database and file storage.
 * Uses shell `unzip` to extract to a temp directory on disk — no in-memory zip
 * operations to avoid OOM in memory-constrained VMs.
 *
 * Supports two modes:
 * - 'replace': Deletes existing data and restores from backup
 * - 'new-account': Regenerates all UUIDs and imports to a new account
 */

import { execFile } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { promisify } from 'util';
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

const execFileAsync = promisify(execFile);

const moduleLogger = logger.child({ module: 'backup:restore-service' });

/**
 * Recursively removes a directory and all its contents
 */
async function cleanupDir(dirPath: string): Promise<void> {
  try {
    await fs.promises.rm(dirPath, { recursive: true, force: true });
  } catch (error) {
    moduleLogger.warn('Failed to clean up temp directory', {
      dirPath,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Extracts a backup ZIP to a temp directory using shell `unzip`
 * and finds the root folder name inside.
 *
 * @returns The extract directory path and the root folder name
 */
async function extractZipToTemp(zipPath: string): Promise<{ extractDir: string; rootFolder: string }> {
  const extractDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'quilltap-restore-'));

  moduleLogger.debug('Extracting backup zip', { zipPath, extractDir });

  await execFileAsync('unzip', ['-o', zipPath, '-d', extractDir], {
    maxBuffer: 10 * 1024 * 1024,
  });

  // Find the root folder (quilltap-backup-{timestamp})
  const entries = await fs.promises.readdir(extractDir, { withFileTypes: true });
  const rootEntry = entries.find(
    (e) => e.isDirectory() && e.name.startsWith('quilltap-backup-')
  );

  if (!rootEntry) {
    // Check if manifest.json is directly in the extract dir (flat zip)
    try {
      await fs.promises.access(path.join(extractDir, 'manifest.json'));
      // Flat structure — the extractDir itself is the root
      return { extractDir, rootFolder: '' };
    } catch {
      await cleanupDir(extractDir);
      throw new Error('Invalid backup: no quilltap-backup-* folder or manifest.json found');
    }
  }

  return { extractDir, rootFolder: rootEntry.name };
}

/**
 * Reads and parses a JSON file from the extracted backup directory.
 * Returns the parsed data or throws if the file is required but missing.
 */
async function readJsonFile<T>(basePath: string, relativePath: string): Promise<T> {
  const filePath = path.join(basePath, relativePath);
  const content = await fs.promises.readFile(filePath, 'utf8');
  return JSON.parse(content) as T;
}

/**
 * Reads and parses an optional JSON file, returning a fallback if missing.
 */
async function readJsonFileOptional<T>(basePath: string, relativePath: string, fallback: T): Promise<T> {
  try {
    return await readJsonFile<T>(basePath, relativePath);
  } catch {
    return fallback;
  }
}

/**
 * Parses a backup ZIP file by extracting to disk and reading JSON data files.
 *
 * @param zipPath - Path to the backup ZIP file on disk
 * @returns The parsed backup data and the extraction directory (caller must clean up)
 */
export async function parseBackupZip(zipPath: string): Promise<{ data: BackupData; extractDir: string; rootFolder: string }> {
  const { extractDir, rootFolder } = await extractZipToTemp(zipPath);
  const rootPath = rootFolder ? path.join(extractDir, rootFolder) : extractDir;

  try {
    // Read all data files from disk
    const manifest = await readJsonFile<BackupManifest>(rootPath, 'manifest.json');
    const characters = await readJsonFile<Character[]>(rootPath, 'data/characters.json');
    const chats = await readJsonFile<ChatWithMessages[]>(rootPath, 'data/chats.json');
    const tags = await readJsonFile<Tag[]>(rootPath, 'data/tags.json');
    const connectionProfiles = await readJsonFile<ConnectionProfile[]>(rootPath, 'data/connection-profiles.json');
    const imageProfiles = await readJsonFile<ImageProfile[]>(rootPath, 'data/image-profiles.json');
    const embeddingProfiles = await readJsonFile<EmbeddingProfile[]>(rootPath, 'data/embedding-profiles.json');
    const memories = await readJsonFile<Memory[]>(rootPath, 'data/memories.json');
    const files = await readJsonFile<FileEntry[]>(rootPath, 'data/files.json');
    // Templates are optional for backwards compatibility with older backups
    const promptTemplates = await readJsonFileOptional<PromptTemplate[]>(rootPath, 'data/prompt-templates.json', []);
    const roleplayTemplates = await readJsonFileOptional<RoleplayTemplate[]>(rootPath, 'data/roleplay-templates.json', []);
    // Provider models are optional for backwards compatibility with older backups
    const providerModels = await readJsonFileOptional<ProviderModel[]>(rootPath, 'data/provider-models.json', []);
    // Projects are optional for backwards compatibility with older backups
    const projects = await readJsonFileOptional<Project[]>(rootPath, 'data/projects.json', []);
    // LLM logs are optional for backwards compatibility with older backups
    const llmLogs = await readJsonFileOptional<LLMLog[]>(rootPath, 'data/llm-logs.json', []);
    // Plugin configs are optional for backwards compatibility with older backups
    const pluginConfigs = await readJsonFileOptional<PluginConfig[]>(rootPath, 'data/plugin-configs.json', []);

    moduleLogger.info('Parsed backup ZIP', {
      version: manifest.version,
      createdAt: manifest.createdAt,
      counts: manifest.counts,
    });

    const data: BackupData = {
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

    return { data, extractDir, rootFolder };
  } catch (error) {
    // Clean up on parse failure
    await cleanupDir(extractDir);
    throw error;
  }
}

/**
 * Gets a file from the extracted backup directory by its metadata.
 * Returns the file contents as a Buffer, or null if not found.
 * Only one file is in memory at a time.
 */
export async function getFileFromExtractedBackup(
  rootPath: string,
  file: FileEntry
): Promise<Buffer | null> {
  const expectedPath = path.join(rootPath, 'files', file.category, `${file.id}_${file.originalFilename}`);

  try {
    await fs.promises.access(expectedPath);
    return await fs.promises.readFile(expectedPath);
  } catch {
    moduleLogger.warn('File not found in extracted backup', { expectedPath, fileId: file.id });
    return null;
  }
}

/**
 * Counts npm plugin directories in the extracted backup
 */
async function countNpmPluginsInExtractedBackup(rootPath: string): Promise<number> {
  const pluginsPath = path.join(rootPath, 'plugins', 'npm');

  try {
    const entries = await fs.promises.readdir(pluginsPath, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).length;
  } catch {
    return 0;
  }
}

/**
 * Previews what will be restored without actually restoring.
 * Extracts the zip to a temp directory, counts entities, then cleans up.
 */
export async function previewRestore(zipPath: string): Promise<RestoreSummary> {
  const { data, extractDir, rootFolder } = await parseBackupZip(zipPath);
  const rootPath = rootFolder ? path.join(extractDir, rootFolder) : extractDir;

  try {
    const totalMessages = data.chats.reduce((sum, chat) => sum + chat.messages.length, 0);
    const npmPluginCount = await countNpmPluginsInExtractedBackup(rootPath);

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
  } finally {
    await cleanupDir(extractDir);
  }
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
 * Restores data from a backup ZIP file on disk
 */
export async function restore(
  zipPath: string,
  options: RestoreOptions
): Promise<RestoreSummary> {
  const { mode, targetUserId } = options;

  moduleLogger.info('Starting restore operation', { mode, targetUserId });

  const warnings: string[] = [];

  // Extract zip to temp directory once — all file reads come from disk
  const { data: parsedData, extractDir, rootFolder } = await parseBackupZip(zipPath);
  const rootPath = rootFolder ? path.join(extractDir, rootFolder) : extractDir;

  try {
    let data = parsedData;

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

    // 5. Files (read from extracted dir on disk, upload to storage)
    let filesRestored = 0;
    for (const file of data.files) {
      try {
        const fileBuffer = await getFileFromExtractedBackup(rootPath, file);
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

    // 16. NPM Plugins (copy from extracted dir to plugins/npm directory)
    let npmPluginsRestored = 0;
    const npmPluginsSrcDir = path.join(rootPath, 'plugins', 'npm');

    try {
      const pluginEntries = await fs.promises.readdir(npmPluginsSrcDir, { withFileTypes: true });
      const npmPluginsDir = getNpmPluginsDir();

      // Ensure the npm plugins directory exists
      await fs.promises.mkdir(npmPluginsDir, { recursive: true });

      for (const entry of pluginEntries) {
        if (entry.isDirectory()) {
          try {
            const srcPath = path.join(npmPluginsSrcDir, entry.name);
            const destPath = path.join(npmPluginsDir, entry.name);
            await fs.promises.cp(srcPath, destPath, { recursive: true });
            npmPluginsRestored++;
            moduleLogger.debug('Restored npm plugin', { pluginName: entry.name });
          } catch (error) {
            warnings.push(`Failed to restore npm plugin "${entry.name}": ${error instanceof Error ? error.message : String(error)}`);
            moduleLogger.warn('Failed to restore npm plugin', { pluginName: entry.name, error });
          }
        }
      }

      if (npmPluginsRestored > 0) {
        moduleLogger.info('Restored npm plugins', {
          count: npmPluginsRestored,
          plugins: pluginEntries.filter((e) => e.isDirectory()).map((e) => e.name),
        });
      }
    } catch {
      // No plugins/npm directory in the backup — that's fine
      moduleLogger.debug('No npm plugins directory in backup');
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
  } finally {
    // Always clean up the extracted temp directory
    await cleanupDir(extractDir);
  }
}
