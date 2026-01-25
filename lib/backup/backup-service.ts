/**
 * Backup Service
 *
 * Creates complete user data backups by collecting all user data from MongoDB
 * and S3, then packaging it into a ZIP archive.
 */

import archiver from 'archiver';
import { createHash, randomUUID } from 'crypto';
import { logger } from '@/lib/logger';
import { getUserRepositories } from '@/lib/repositories/user-scoped';
import { getRepositories } from '@/lib/repositories/factory';
import { fileStorageManager } from '@/lib/file-storage/manager';
import type { BackupManifest, BackupData, BackupInfo, ChatWithMessages } from './types';
import type { ChatEvent, ProviderModel } from '@/lib/schemas/types';

// Get app version from package.json
const APP_VERSION = process.env.npm_package_version || '2.0.0';

const moduleLogger = logger.child({ module: 'backup:backup-service' });

/**
 * Collects all user data from MongoDB repositories
 */
async function collectUserData(userId: string): Promise<Omit<BackupData, 'manifest'>> {
  moduleLogger.debug('Collecting user data', { userId });

  const repos = getUserRepositories(userId);
  const globalRepos = getRepositories();

  // Collect all entities in parallel
  const [
    characters,
    chatMetadatas,
    tags,
    connectionProfiles,
    imageProfiles,
    embeddingProfiles,
    files,
    promptTemplates,
    roleplayTemplates,
    providerModels,
    projects,
    llmLogs,
  ] = await Promise.all([
    repos.characters.findAll(),
    repos.chats.findAll(),
    repos.tags.findAll(),
    repos.connections.findAll(),
    repos.imageProfiles.findAll(),
    repos.embeddingProfiles.findAll(),
    repos.files.findAll(),
    // Get user-created templates (excludes built-in templates)
    globalRepos.promptTemplates.findByUserId(userId),
    globalRepos.roleplayTemplates.findByUserId(userId),
    // Get provider models
    globalRepos.providerModels.findAll(),
    // Get projects
    repos.projects.findAll(),
    // Get LLM logs
    repos.llmLogs.findAll(10000), // High limit to get all user logs
  ]);

  // Exclude backup files from the file list - we don't want to back up old backups
  const filteredFiles = files.filter(
    (file) => file.category !== 'BACKUP' && file.folderPath !== '/backups'
  );

  moduleLogger.debug('Collected base entities', {
    userId,
    characters: characters.length,
    chats: chatMetadatas.length,
    tags: tags.length,
    connectionProfiles: connectionProfiles.length,
    imageProfiles: imageProfiles.length,
    embeddingProfiles: embeddingProfiles.length,
    files: filteredFiles.length,
    filesExcluded: files.length - filteredFiles.length,
    promptTemplates: promptTemplates.length,
    roleplayTemplates: roleplayTemplates.length,
    providerModels: providerModels.length,
    projects: projects.length,
    llmLogs: llmLogs.length,
  });

  // Collect messages for each chat
  const chats: ChatWithMessages[] = await Promise.all(
    chatMetadatas.map(async (chat) => {
      const messages = await repos.chats.getMessages(chat.id);
      // Filter to only include message events (not context-summary events)
      const messageEvents = messages.filter(
        (event): event is ChatEvent & { type: 'message' } => event.type === 'message'
      );
      return {
        ...chat,
        messages: messageEvents,
      } as ChatWithMessages;
    })
  );

  // Collect memories for all characters
  const memoriesArrays = await Promise.all(
    characters.map((char) => repos.memories.findByCharacterId(char.id))
  );
  const memories = memoriesArrays.flat();

  moduleLogger.debug('Collected messages and memories', {
    userId,
    totalMessages: chats.reduce((sum, chat) => sum + chat.messages.length, 0),
    totalMemories: memories.length,
  });

  // Strip encrypted API key data from connection profiles for security
  // API keys are encrypted with user-specific keys and can't be restored to another account
  const sanitizedConnectionProfiles = connectionProfiles.map((profile) => ({
    ...profile,
    // Keep apiKeyId reference but note that actual keys aren't backed up
  }));

  return {
    characters,
    chats,
    tags,
    connectionProfiles: sanitizedConnectionProfiles,
    imageProfiles,
    embeddingProfiles,
    memories,
    files: filteredFiles,
    promptTemplates,
    roleplayTemplates,
    providerModels,
    projects,
    llmLogs,
  };
}

/**
 * Creates a backup manifest with entity counts
 */
function createManifest(userId: string, data: Omit<BackupData, 'manifest'>): BackupManifest {
  const totalMessages = data.chats.reduce((sum, chat) => sum + chat.messages.length, 0);

  return {
    version: '1.0',
    createdAt: new Date().toISOString(),
    userId,
    appVersion: APP_VERSION,
    counts: {
      characters: data.characters.length,
      chats: data.chats.length,
      messages: totalMessages,
      tags: data.tags.length,
      connectionProfiles: data.connectionProfiles.length,
      imageProfiles: data.imageProfiles.length,
      embeddingProfiles: data.embeddingProfiles.length,
      memories: data.memories.length,
      files: data.files.length,
      promptTemplates: data.promptTemplates.length,
      roleplayTemplates: data.roleplayTemplates.length,
      providerModels: data.providerModels.length,
      projects: data.projects.length,
      llmLogs: data.llmLogs.length,
    },
  };
}

/**
 * Creates a complete backup as a ZIP buffer
 */
export async function createBackup(userId: string): Promise<{
  zipBuffer: Buffer;
  manifest: BackupManifest;
}> {
  moduleLogger.info('Starting backup creation', { userId });

  // Collect all user data
  const data = await collectUserData(userId);
  const manifest = createManifest(userId, data);

  const fullData: BackupData = {
    manifest,
    ...data,
  };

  moduleLogger.debug('Creating ZIP archive', { userId, manifest });

  // Create ZIP archive
  const archive = archiver('zip', {
    zlib: { level: 9 }, // Maximum compression
  });

  const chunks: Buffer[] = [];

  // Collect data chunks from the archive
  archive.on('data', (chunk: Buffer) => {
    chunks.push(chunk);
  });

  // Handle archive errors
  archive.on('error', (err) => {
    moduleLogger.error('Archive error', { userId, error: err.message }, err);
    throw err;
  });

  archive.on('warning', (err) => {
    moduleLogger.warn('Archive warning', { userId, error: err.message });
  });

  // Generate backup folder name
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const folderName = `quilltap-backup-${timestamp}`;

  // Add manifest.json
  archive.append(JSON.stringify(manifest, null, 2), {
    name: `${folderName}/manifest.json`,
  });

  // Add data files
  archive.append(JSON.stringify(data.characters, null, 2), {
    name: `${folderName}/data/characters.json`,
  });
  archive.append(JSON.stringify(data.chats, null, 2), {
    name: `${folderName}/data/chats.json`,
  });
  archive.append(JSON.stringify(data.tags, null, 2), {
    name: `${folderName}/data/tags.json`,
  });
  archive.append(JSON.stringify(data.connectionProfiles, null, 2), {
    name: `${folderName}/data/connection-profiles.json`,
  });
  archive.append(JSON.stringify(data.imageProfiles, null, 2), {
    name: `${folderName}/data/image-profiles.json`,
  });
  archive.append(JSON.stringify(data.embeddingProfiles, null, 2), {
    name: `${folderName}/data/embedding-profiles.json`,
  });
  archive.append(JSON.stringify(data.memories, null, 2), {
    name: `${folderName}/data/memories.json`,
  });
  archive.append(JSON.stringify(data.files, null, 2), {
    name: `${folderName}/data/files.json`,
  });
  archive.append(JSON.stringify(data.promptTemplates, null, 2), {
    name: `${folderName}/data/prompt-templates.json`,
  });
  archive.append(JSON.stringify(data.roleplayTemplates, null, 2), {
    name: `${folderName}/data/roleplay-templates.json`,
  });
  archive.append(JSON.stringify(data.providerModels, null, 2), {
    name: `${folderName}/data/provider-models.json`,
  });
  archive.append(JSON.stringify(data.projects, null, 2), {
    name: `${folderName}/data/projects.json`,
  });
  archive.append(JSON.stringify(data.llmLogs, null, 2), {
    name: `${folderName}/data/llm-logs.json`,
  });

  // Add actual files from storage
  moduleLogger.debug('Adding files from storage', { userId, fileCount: data.files.length });
  moduleLogger.debug('Added provider models to archive', {
    userId,
    providerModelCount: data.providerModels.length,
  });

  for (const file of data.files) {
    if (file.storageKey) {
      try {
        const fileBuffer = await fileStorageManager.downloadFile(file);
        archive.append(fileBuffer, {
          name: `${folderName}/files/${file.category}/${file.id}_${file.originalFilename}`,
        });
        moduleLogger.debug('Added file to backup', {
          fileId: file.id,
          filename: file.originalFilename,
        });
      } catch (error) {
        moduleLogger.warn('Failed to download file for backup, skipping', {
          fileId: file.id,
          storageKey: file.storageKey,
          error: error instanceof Error ? error.message : String(error),
        });
        // Continue with backup even if some files fail
      }
    }
  }

  // Finalize and wait for the archive to complete
  await new Promise<void>((resolve, reject) => {
    archive.on('end', () => {
      moduleLogger.debug('Archive stream ended', { userId });
      resolve();
    });
    archive.on('error', reject);
    archive.finalize();
  });

  const zipBuffer = Buffer.concat(chunks.map(c => new Uint8Array(c)));

  moduleLogger.info('Backup creation completed', {
    userId,
    zipSize: zipBuffer.length,
    manifest,
  });

  return { zipBuffer, manifest };
}

/**
 * Saves a backup ZIP to storage
 */
export async function saveBackupToS3(
  userId: string,
  zipBuffer: Buffer,
  customFilename?: string
): Promise<string> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const fileId = randomUUID();
  const filename = customFilename || `backup-${timestamp}.zip`;

  moduleLogger.debug('Saving backup to storage', { userId, filename, size: zipBuffer.length });

  // Upload to S3 storage
  const result = await fileStorageManager.uploadFile({
    userId,
    fileId,
    filename,
    content: zipBuffer,
    contentType: 'application/zip',
    folderPath: '/backups',
  });

  // Calculate SHA256 hash
  const sha256 = createHash('sha256').update(new Uint8Array(zipBuffer)).digest('hex');

  // Create file metadata entry in MongoDB so backups appear in listings
  // Note: userId is automatically added by the user-scoped repository
  const repos = getUserRepositories(userId);
  await repos.files.create(
    {
      originalFilename: filename,
      mimeType: 'application/zip',
      size: zipBuffer.length,
      sha256,
      source: 'GENERATED',
      category: 'BACKUP',
      storageKey: result.storageKey,
      mountPointId: result.mountPointId,
      folderPath: '/backups',
      linkedTo: [],
      tags: [],
    },
    { id: fileId }
  );

  moduleLogger.info('Backup saved to storage', {
    userId,
    fileId,
    storageKey: result.storageKey,
    mountPointId: result.mountPointId,
  });

  return result.storageKey;
}

/**
 * Lists all backups stored in storage for a user
 */
export async function listS3Backups(userId: string): Promise<BackupInfo[]> {
  moduleLogger.debug('Listing user backups', { userId });

  const repos = getUserRepositories(userId);

  try {
    // Get all user files and filter for backups by category or folder path
    const allFiles = await repos.files.findAll();
    const backupFiles = allFiles.filter(
      (file) =>
        file.storageKey &&
        (file.category === 'BACKUP' ||
        file.folderPath === '/backups' ||
        file.originalFilename?.endsWith('.zip'))
    );

    const backups: BackupInfo[] = backupFiles
      .filter((file) => file.storageKey) // Ensure storageKey exists
      .map((file) => ({
        key: file.storageKey as string,
        filename: file.originalFilename,
        createdAt: new Date(file.createdAt),
        size: file.size || 0,
      }));

    // Sort by creation date, newest first
    backups.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    moduleLogger.debug('Listed user backups', { userId, count: backups.length });

    return backups;
  } catch (error) {
    moduleLogger.warn('Failed to list backups', {
      userId,
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

/**
 * Downloads a backup from storage
 *
 * @param userId - User ID to scope the backup lookup
 * @param storageKey - Storage key of the backup file
 */
export async function downloadBackupFromS3(userId: string, storageKey: string): Promise<Buffer> {
  moduleLogger.debug('Downloading backup from storage', { userId, storageKey });

  const repos = getUserRepositories(userId);

  try {
    // Find the backup file by storage key
    const allFiles = await repos.files.findAll();
    const backupFile = allFiles.find((f) => f.storageKey === storageKey);

    if (!backupFile) {
      throw new Error(`Backup file not found: ${storageKey}`);
    }

    const buffer = await fileStorageManager.downloadFile(backupFile);

    moduleLogger.debug('Downloaded backup from storage', { userId, storageKey, size: buffer.length });

    return buffer;
  } catch (error) {
    moduleLogger.error('Failed to download backup', {
      userId,
      storageKey,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Deletes a backup from storage
 *
 * @param userId - User ID to scope the backup lookup
 * @param storageKey - Storage key of the backup file
 */
export async function deleteBackupFromS3(userId: string, storageKey: string): Promise<void> {
  moduleLogger.debug('Deleting backup from storage', { userId, storageKey });

  const repos = getUserRepositories(userId);

  try {
    // Find the backup file by storage key
    const allFiles = await repos.files.findAll();
    const backupFile = allFiles.find((f) => f.storageKey === storageKey);

    if (!backupFile) {
      moduleLogger.warn('Backup file not found for deletion', { userId, storageKey });
      return;
    }

    // Delete from storage
    await fileStorageManager.deleteFile(backupFile);

    // Delete metadata from database
    await repos.files.delete(backupFile.id);

    moduleLogger.info('Deleted backup from storage', { userId, fileId: backupFile.id, storageKey });
  } catch (error) {
    moduleLogger.error('Failed to delete backup', {
      userId,
      storageKey,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
