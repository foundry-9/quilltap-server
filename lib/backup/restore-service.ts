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
  ChatParticipantBase,
  PhysicalDescription,
  PromptTemplate,
  RoleplayTemplate,
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
  const [characters, personas, chats, tags, files, connectionProfiles, imageProfiles, embeddingProfiles, apiKeys, promptTemplates, roleplayTemplates] =
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
    ]);

  // Count memories
  let memoriesCount = 0;
  for (const character of characters) {
    const memories = await repos.memories.findByCharacterId(character.id);
    memoriesCount += memories.length;
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

  const [characters, personas, chats, tags, files, connectionProfiles, imageProfiles, embeddingProfiles, apiKeys, promptTemplates, roleplayTemplates] =
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
    ]);

  // Count memories
  let memoriesCount = 0;
  for (const character of characters) {
    const memories = await repos.memories.findByCharacterId(character.id);
    memoriesCount += memories.length;
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
      ...remapper.remapFields(chat, ['id']),
      ...remapper.remapArrayFields(chat, ['tags']),
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

  // Remap memories
  const remappedMemories = data.memories.map((memory) => ({
    ...remapper.remapFields(memory, ['id', 'characterId', 'personaId', 'chatId', 'sourceMessageId']),
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
  const characterIdMap = new Map<string, string>();
  const personaIdMap = new Map<string, string>();

  // Restore in dependency order
  // 1. Tags (no dependencies)
  moduleLogger.debug('Restoring tags', { count: data.tags.length });
  for (const tag of data.tags) {
    try {
      const { id, userId, createdAt, updatedAt, ...tagData } = tag;
      await repos.tags.create({ ...tagData, nameLower: tagData.nameLower || tagData.name.toLowerCase() });
    } catch (error) {
      warnings.push(`Failed to restore tag "${tag.name}": ${error instanceof Error ? error.message : String(error)}`);
      moduleLogger.warn('Failed to restore tag', { tagId: tag.id, error });
    }
  }

  // 2. Connection profiles (no entity dependencies, but have tag refs)
  moduleLogger.debug('Restoring connection profiles', { count: data.connectionProfiles.length });
  for (const profile of data.connectionProfiles) {
    try {
      const { id, userId, createdAt, updatedAt, apiKeyId, ...profileData } = profile;
      // Note: apiKeyId is not restored as API keys are encrypted and can't be restored
      await repos.connections.create({ ...profileData, apiKeyId: null });
    } catch (error) {
      warnings.push(`Failed to restore connection profile "${profile.name}": ${error instanceof Error ? error.message : String(error)}`);
      moduleLogger.warn('Failed to restore connection profile', { profileId: profile.id, error });
    }
  }

  // 3. Image profiles
  moduleLogger.debug('Restoring image profiles', { count: data.imageProfiles.length });
  for (const profile of data.imageProfiles) {
    try {
      const { id, userId, createdAt, updatedAt, apiKeyId, ...profileData } = profile;
      await repos.imageProfiles.create({ ...profileData, apiKeyId: null });
    } catch (error) {
      warnings.push(`Failed to restore image profile "${profile.name}": ${error instanceof Error ? error.message : String(error)}`);
      moduleLogger.warn('Failed to restore image profile', { profileId: profile.id, error });
    }
  }

  // 4. Embedding profiles
  moduleLogger.debug('Restoring embedding profiles', { count: data.embeddingProfiles.length });
  for (const profile of data.embeddingProfiles) {
    try {
      const { id, userId, createdAt, updatedAt, apiKeyId, ...profileData } = profile;
      await repos.embeddingProfiles.create({ ...profileData, apiKeyId: null });
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
        // Upload to S3
        await s3FileService.uploadUserFile(
          targetUserId,
          file.id,
          file.originalFilename,
          file.category,
          fileBuffer,
          file.mimeType
        );

        // Create file metadata
        const { id, userId, createdAt, updatedAt, s3Key, s3Bucket, ...fileData } = file;
        const newS3Key = s3FileService.generateS3Key(targetUserId, file.id, file.originalFilename, file.category);
        await repos.files.create({ ...fileData, s3Key: newS3Key });
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
      const { id, userId, createdAt, updatedAt, messages, ...chatData } = chat;
      const createdChat = await repos.chats.create(chatData);

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

      // Remap personaId if present
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

      await repos.memories.create({
        ...memoryData,
        characterId: newCharacterId,
        personaId: newPersonaId,
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
