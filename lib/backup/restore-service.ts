/**
 * Restore Service
 *
 * Restores user data from a backup ZIP archive to MongoDB and S3.
 * Supports two modes:
 * - 'replace': Deletes existing data and restores from backup
 * - 'new-account': Regenerates all UUIDs and imports to a new account
 */

import AdmZip from 'adm-zip';
import { logger } from '@/lib/logger';
import { getUserRepositories } from '@/lib/repositories/user-scoped';
import { getRepositories } from '@/lib/repositories/factory';
import { s3FileService } from '@/lib/s3/file-service';
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
  Persona,
  Tag,
  ConnectionProfile,
  ImageProfile,
  EmbeddingProfile,
  Memory,
  FileEntry,
  ChatMetadata,
  ChatParticipantBase,
  PhysicalDescription,
  PromptTemplate,
  RoleplayTemplate,
  ProviderModel,
} from '@/lib/schemas/types';

const moduleLogger = logger.child({ module: 'backup:restore-service' });

/**
 * Parses a backup ZIP file and extracts its data
 */
export function parseBackupZip(zipBuffer: Buffer): BackupData {
  moduleLogger.debug('Parsing backup ZIP', { size: zipBuffer.length });

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

  moduleLogger.debug('Found backup root folder', { rootFolder });

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
      moduleLogger.debug('Optional file not found in backup, using fallback', { path });
      return fallback;
    }
    const content = entry.getData().toString('utf8');
    return JSON.parse(content) as T;
  };

  // Read all data files
  const manifest = readJson<BackupManifest>('manifest.json');
  const characters = readJson<Character[]>('data/characters.json');
  const personas = readJson<Persona[]>('data/personas.json');
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

  moduleLogger.info('Parsed backup ZIP', {
    version: manifest.version,
    createdAt: manifest.createdAt,
    counts: manifest.counts,
  });

  return {
    manifest,
    characters,
    personas,
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
 * Previews what will be restored without actually restoring
 */
export function previewRestore(zipBuffer: Buffer): RestoreSummary {
  const data = parseBackupZip(zipBuffer);

  const totalMessages = data.chats.reduce((sum, chat) => sum + chat.messages.length, 0);

  return {
    characters: data.characters.length,
    personas: data.personas.length,
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
  const [characters, personas, chats, tags, files, connectionProfiles, imageProfiles, embeddingProfiles, promptTemplates, roleplayTemplates] =
    await Promise.all([
      repos.characters.findAll(),
      repos.personas.findAll(),
      repos.chats.findAll(),
      repos.tags.findAll(),
      repos.files.findAll(),
      repos.connections.findAll(),
      repos.imageProfiles.findAll(),
      repos.embeddingProfiles.findAll(),
      globalRepos.promptTemplates.findByUserId(userId),
      globalRepos.roleplayTemplates.findByUserId(userId),
    ]);

  // Delete memories for each character first
  for (const character of characters) {
    const memories = await repos.memories.findByCharacterId(character.id);
    for (const memory of memories) {
      await repos.memories.delete(memory.id);
    }
  }

  // Delete all entities (including user-created templates)
  await Promise.all([
    ...characters.map((c) => repos.characters.delete(c.id)),
    ...personas.map((p) => repos.personas.delete(p.id)),
    ...chats.map((c) => repos.chats.delete(c.id)),
    ...tags.map((t) => repos.tags.delete(t.id)),
    ...connectionProfiles.map((cp) => repos.connections.delete(cp.id)),
    ...imageProfiles.map((ip) => repos.imageProfiles.delete(ip.id)),
    ...embeddingProfiles.map((ep) => repos.embeddingProfiles.delete(ep.id)),
    ...promptTemplates.map((pt) => globalRepos.promptTemplates.delete(pt.id)),
    ...roleplayTemplates.map((rt) => globalRepos.roleplayTemplates.delete(rt.id)),
  ]);

  // Delete files from S3
  for (const file of files) {
    try {
      if (file.s3Key) {
        await s3FileService.deleteByS3Key(file.s3Key);
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
      personas: personas.length,
      chats: chats.length,
      tags: tags.length,
      files: files.length,
      connectionProfiles: connectionProfiles.length,
      imageProfiles: imageProfiles.length,
      embeddingProfiles: embeddingProfiles.length,
      promptTemplates: promptTemplates.length,
      roleplayTemplates: roleplayTemplates.length,
    },
  });
}

/**
 * Summary of deleted data counts
 */
export interface DeleteSummary {
  characters: number;
  personas: number;
  chats: number;
  tags: number;
  files: number;
  memories: number;
  apiKeys: number;
  backups: number;
  profiles: {
    connection: number;
    image: number;
    embedding: number;
  };
  templates: {
    prompt: number;
    roleplay: number;
  };
  sync: {
    instances: number;
    mappings: number;
    operations: number;
    syncApiKeys: number;
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
  const [characters, personas, chats, tags, files, connectionProfiles, imageProfiles, embeddingProfiles, apiKeys, promptTemplates, roleplayTemplates, syncInstances, syncOperations, syncApiKeys] =
    await Promise.all([
      repos.characters.findAll(),
      repos.personas.findAll(),
      repos.chats.findAll(),
      repos.tags.findAll(),
      repos.files.findAll(),
      repos.connections.findAll(),
      repos.imageProfiles.findAll(),
      repos.embeddingProfiles.findAll(),
      repos.connections.getAllApiKeys(),
      globalRepos.promptTemplates.findByUserId(userId),
      globalRepos.roleplayTemplates.findByUserId(userId),
      globalRepos.syncInstances.findByUserId(userId),
      globalRepos.syncOperations.findByUserId(userId, 10000), // High limit to get all
      globalRepos.userSyncApiKeys.findByUserId(userId),
    ]);

  // Count memories
  let memoriesCount = 0;
  for (const character of characters) {
    const memories = await repos.memories.findByCharacterId(character.id);
    memoriesCount += memories.length;
  }

  // Count sync mappings (need to count per instance)
  let syncMappingsCount = 0;
  for (const instance of syncInstances) {
    const mappings = await globalRepos.syncMappings.findAllForInstance(userId, instance.id);
    syncMappingsCount += mappings.length;
  }

  // List and count backups
  const backupKeys = await s3FileService.listUserFiles(userId, 'backups');
  const backupsCount = backupKeys.length;

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

  // Delete backups from S3
  for (const backupKey of backupKeys) {
    try {
      await s3FileService.deleteByS3Key(backupKey);
    } catch (error) {
      moduleLogger.warn('Failed to delete backup', {
        backupKey,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Reset sync data
  // Delete mappings for each instance (so entities get re-mapped on next sync)
  for (const instance of syncInstances) {
    try {
      await globalRepos.syncMappings.deleteByInstanceId(instance.id);
    } catch (error) {
      moduleLogger.warn('Failed to delete sync mappings for instance', {
        instanceId: instance.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Reset sync state on instances (clear lastSyncAt so next sync pulls all data)
  // We keep the instances themselves so user doesn't have to re-enter remote server info
  try {
    await globalRepos.syncInstances.resetSyncStateForUser(userId);
    moduleLogger.info('Reset sync state for all user instances', { userId });
  } catch (error) {
    moduleLogger.warn('Failed to reset sync state for instances', {
      userId,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  // Delete sync operations (clear history)
  for (const operation of syncOperations) {
    try {
      await globalRepos.syncOperations.delete(operation.id);
    } catch (error) {
      moduleLogger.warn('Failed to delete sync operation', {
        operationId: operation.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Keep sync API keys - they're needed for remote instances to sync to us

  const summary: DeleteSummary = {
    characters: characters.length,
    personas: personas.length,
    chats: chats.length,
    tags: tags.length,
    files: files.length,
    memories: memoriesCount,
    apiKeys: apiKeys.length,
    backups: backupsCount,
    profiles: {
      connection: connectionProfiles.length,
      image: imageProfiles.length,
      embedding: embeddingProfiles.length,
    },
    templates: {
      prompt: promptTemplates.length,
      roleplay: roleplayTemplates.length,
    },
    sync: {
      // Instances are reset (not deleted), so count shows how many were reset
      instances: syncInstances.length,
      mappings: syncMappingsCount,
      operations: syncOperations.length,
      // API keys are kept (not deleted)
      syncApiKeys: 0,
    },
  };

  moduleLogger.info('Complete user data deletion finished', { userId, summary });

  return summary;
}

/**
 * Preview what will be deleted (counts only, no actual deletion)
 */
export async function previewDeleteAllUserData(userId: string): Promise<DeleteSummary> {
  moduleLogger.debug('Previewing data to be deleted', { userId });

  const repos = getUserRepositories(userId);
  const globalRepos = getRepositories();

  const [characters, personas, chats, tags, files, connectionProfiles, imageProfiles, embeddingProfiles, apiKeys, promptTemplates, roleplayTemplates, syncInstances, syncOperations, syncApiKeys] =
    await Promise.all([
      repos.characters.findAll(),
      repos.personas.findAll(),
      repos.chats.findAll(),
      repos.tags.findAll(),
      repos.files.findAll(),
      repos.connections.findAll(),
      repos.imageProfiles.findAll(),
      repos.embeddingProfiles.findAll(),
      repos.connections.getAllApiKeys(),
      globalRepos.promptTemplates.findByUserId(userId),
      globalRepos.roleplayTemplates.findByUserId(userId),
      globalRepos.syncInstances.findByUserId(userId),
      globalRepos.syncOperations.findByUserId(userId, 10000), // High limit to get all
      globalRepos.userSyncApiKeys.findByUserId(userId),
    ]);

  // Count memories
  let memoriesCount = 0;
  for (const character of characters) {
    const memories = await repos.memories.findByCharacterId(character.id);
    memoriesCount += memories.length;
  }

  // Count sync mappings (need to count per instance)
  let syncMappingsCount = 0;
  for (const instance of syncInstances) {
    const mappings = await globalRepos.syncMappings.findAllForInstance(userId, instance.id);
    syncMappingsCount += mappings.length;
  }

  // List and count backups
  const backupKeys = await s3FileService.listUserFiles(userId, 'backups');

  return {
    characters: characters.length,
    personas: personas.length,
    chats: chats.length,
    tags: tags.length,
    files: files.length,
    memories: memoriesCount,
    apiKeys: apiKeys.length,
    backups: backupKeys.length,
    profiles: {
      connection: connectionProfiles.length,
      image: imageProfiles.length,
      embedding: embeddingProfiles.length,
    },
    templates: {
      prompt: promptTemplates.length,
      roleplay: roleplayTemplates.length,
    },
    sync: {
      // Instances will be reset (not deleted), count shows how many will be reset
      instances: syncInstances.length,
      mappings: syncMappingsCount,
      operations: syncOperations.length,
      // API keys are kept (not deleted)
      syncApiKeys: 0,
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
  moduleLogger.debug('Remapping backup data UUIDs', { targetUserId });

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
      ...remapper.remapFields(char, ['id', 'defaultImageId', 'defaultConnectionProfileId']),
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
    return remapped as Character;
  });

  // Remap personas
  const remappedPersonas = data.personas.map((persona) => {
    const remapped = {
      ...remapper.remapFields(persona, ['id', 'defaultImageId']),
      ...remapper.remapArrayFields(persona, ['tags', 'characterLinks']),
      userId: targetUserId,
    };
    // Handle physicalDescriptions
    if (remapped.physicalDescriptions) {
      remapped.physicalDescriptions = remapped.physicalDescriptions.map((desc: PhysicalDescription) => ({
        ...desc,
        id: remapper.remap(desc.id),
      }));
    }
    return remapped as Persona;
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
        'personaId',
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

  // Remap memories (including aboutCharacterId for Characters Not Personas)
  const remappedMemories = data.memories.map((memory) => ({
    ...remapper.remapFields(memory, ['id', 'characterId', 'personaId', 'aboutCharacterId', 'chatId', 'sourceMessageId']),
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

  return {
    manifest: data.manifest,
    characters: remappedCharacters,
    personas: remappedPersonas,
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
    moduleLogger.debug('UUID remapping complete', {
      mappingSize: remapper.getSize(),
    });
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
  const personaIdMap = new Map<string, string>();
  const chatIdMap = new Map<string, string>();

  // Restore in dependency order
  // 1. Tags (no dependencies)
  moduleLogger.debug('Restoring tags', { count: data.tags.length });
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
  moduleLogger.debug('Restoring connection profiles', { count: data.connectionProfiles.length });
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
  moduleLogger.debug('Restoring image profiles', { count: data.imageProfiles.length });
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
  moduleLogger.debug('Restoring embedding profiles', { count: data.embeddingProfiles.length });
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

  // 5. Files (upload to S3 and create metadata)
  moduleLogger.debug('Restoring files', { count: data.files.length });
  let filesRestored = 0;
  for (const file of data.files) {
    try {
      const fileBuffer = getFileFromZip(zipBuffer, file);
      if (fileBuffer) {
        // Upload to S3 using backup file ID for the key
        await s3FileService.uploadUserFile(
          targetUserId,
          file.id,
          file.originalFilename,
          file.category,
          fileBuffer,
          file.mimeType
        );

        // Create file metadata
        const { id: backupId, userId, createdAt, updatedAt, s3Key, s3Bucket, ...fileData } = file;
        const newS3Key = s3FileService.generateS3Key(targetUserId, file.id, file.originalFilename, file.category);
        const createdFile = await repos.files.create({ ...fileData, s3Key: newS3Key });
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
  moduleLogger.debug('Restoring characters', { count: data.characters.length });
  for (const character of data.characters) {
    try {
      const { id: backupId, userId, createdAt, updatedAt, ...charData } = character;
      const createdCharacter = await repos.characters.create(charData);
      // Track the mapping from backup ID to newly created ID
      characterIdMap.set(backupId, createdCharacter.id);
      moduleLogger.debug('Character ID mapping created', { backupId, newId: createdCharacter.id });
    } catch (error) {
      warnings.push(`Failed to restore character "${character.name}": ${error instanceof Error ? error.message : String(error)}`);
      moduleLogger.warn('Failed to restore character', { characterId: character.id, error });
    }
  }

  // 7. Personas
  moduleLogger.debug('Restoring personas', { count: data.personas.length });
  for (const persona of data.personas) {
    try {
      const { id: backupId, userId, createdAt, updatedAt, ...personaData } = persona;
      const createdPersona = await repos.personas.create(personaData);
      // Track the mapping from backup ID to newly created ID
      personaIdMap.set(backupId, createdPersona.id);
      moduleLogger.debug('Persona ID mapping created', { backupId, newId: createdPersona.id });
    } catch (error) {
      warnings.push(`Failed to restore persona "${persona.name}": ${error instanceof Error ? error.message : String(error)}`);
      moduleLogger.warn('Failed to restore persona', { personaId: persona.id, error });
    }
  }

  // 8. Chats (with messages)
  moduleLogger.debug('Restoring chats', { count: data.chats.length });
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
  moduleLogger.debug('Restoring memories', { count: data.memories.length });
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

      // Remap personaId if present (legacy backups)
      let newPersonaId = memoryData.personaId;
      if (memoryData.personaId) {
        newPersonaId = personaIdMap.get(memoryData.personaId) || null;
        if (!newPersonaId) {
          moduleLogger.debug('Memory personaId not found in restored personas, setting to null', {
            memoryId: memory.id,
            backupPersonaId: memoryData.personaId,
          });
        }
      }

      // Remap aboutCharacterId if present (new backups with Characters Not Personas)
      let newAboutCharacterId = memoryData.aboutCharacterId;
      if (memoryData.aboutCharacterId) {
        newAboutCharacterId = characterIdMap.get(memoryData.aboutCharacterId) ||
                              personaIdMap.get(memoryData.aboutCharacterId) || null;
        if (!newAboutCharacterId) {
          moduleLogger.debug('Memory aboutCharacterId not found in restored entities, setting to null', {
            memoryId: memory.id,
            backupAboutCharacterId: memoryData.aboutCharacterId,
          });
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
  moduleLogger.debug('Restoring prompt templates', { count: data.promptTemplates.length });
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
  moduleLogger.debug('Restoring roleplay templates', { count: data.roleplayTemplates.length });
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
  moduleLogger.debug('Restoring provider models', { count: data.providerModels.length });
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
      personas: personaIdMap.size,
      chats: chatIdMap.size,
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
  moduleLogger.debug('Reconciling character relationships');
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

      // Remap personaLinks
      if (originalChar.personaLinks && originalChar.personaLinks.length > 0) {
        updates.personaLinks = originalChar.personaLinks
          .map((link) => {
            const newPersonaId = remapId(link.personaId, personaIdMap);
            if (newPersonaId) {
              return { ...link, personaId: newPersonaId };
            }
            return null;
          })
          .filter((link) => link !== null) as { personaId: string; isDefault: boolean }[];
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
        moduleLogger.debug('Updated character relationships', { characterId: newId, updates: Object.keys(updates) });
      }
    } catch (error) {
      warnings.push(`Failed to reconcile character relationships: ${error instanceof Error ? error.message : String(error)}`);
      moduleLogger.warn('Failed to reconcile character relationships', { characterId: newId, error });
    }
  }

  // 14. Update personas with correct relationship IDs
  moduleLogger.debug('Reconciling persona relationships');
  for (const [backupId, newId] of personaIdMap) {
    try {
      const originalPersona = data.personas.find((p) => p.id === backupId);
      if (!originalPersona) continue;

      const updates: Partial<Persona> = {};
      let hasUpdates = false;

      // Remap defaultImageId
      if (originalPersona.defaultImageId) {
        const newImageId = remapId(originalPersona.defaultImageId, fileIdMap);
        if (newImageId) {
          updates.defaultImageId = newImageId;
          hasUpdates = true;
        }
      }

      // Remap characterLinks
      if (originalPersona.characterLinks && originalPersona.characterLinks.length > 0) {
        const remappedCharLinks = remapIdArray(originalPersona.characterLinks, characterIdMap);
        if (remappedCharLinks.length > 0) {
          updates.characterLinks = remappedCharLinks;
          hasUpdates = true;
        }
      }

      // Remap tags
      if (originalPersona.tags && originalPersona.tags.length > 0) {
        const remappedTags = remapIdArray(originalPersona.tags, tagIdMap);
        if (remappedTags.length > 0) {
          updates.tags = remappedTags;
          hasUpdates = true;
        }
      }

      if (hasUpdates) {
        await repos.personas.update(newId, updates);
        moduleLogger.debug('Updated persona relationships', { personaId: newId, updates: Object.keys(updates) });
      }
    } catch (error) {
      warnings.push(`Failed to reconcile persona relationships: ${error instanceof Error ? error.message : String(error)}`);
      moduleLogger.warn('Failed to reconcile persona relationships', { personaId: newId, error });
    }
  }

  // 15. Update chats with correct participant IDs
  moduleLogger.debug('Reconciling chat relationships');
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

          if (participant.personaId) {
            const newPersonaId = remapId(participant.personaId, personaIdMap);
            if (newPersonaId) remapped.personaId = newPersonaId;
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

      if (hasUpdates) {
        await repos.chats.update(newId, updates);
        moduleLogger.debug('Updated chat relationships', { chatId: newId, updates: Object.keys(updates) });
      }
    } catch (error) {
      warnings.push(`Failed to reconcile chat relationships: ${error instanceof Error ? error.message : String(error)}`);
      moduleLogger.warn('Failed to reconcile chat relationships', { chatId: newId, error });
    }
  }

  moduleLogger.info('Post-restore reconciliation phase completed');

  const summary: RestoreSummary = {
    characters: data.characters.length,
    personas: data.personas.length,
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
