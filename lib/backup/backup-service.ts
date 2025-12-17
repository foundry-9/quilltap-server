/**
 * Backup Service
 *
 * Creates complete user data backups by collecting all user data from MongoDB
 * and S3, then packaging it into a ZIP archive.
 */

import archiver from 'archiver';
import { logger } from '@/lib/logger';
import { getUserRepositories } from '@/lib/repositories/user-scoped';
import { getRepositories } from '@/lib/mongodb/repositories';
import { s3FileService } from '@/lib/s3/file-service';
import { downloadFile } from '@/lib/s3/operations';
import type { BackupManifest, BackupData, BackupInfo, ChatWithMessages } from './types';
import type { ChatEvent } from '@/lib/schemas/types';

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
    personas,
    chatMetadatas,
    tags,
    connectionProfiles,
    imageProfiles,
    embeddingProfiles,
    files,
    promptTemplates,
    roleplayTemplates,
  ] = await Promise.all([
    repos.characters.findAll(),
    repos.personas.findAll(),
    repos.chats.findAll(),
    repos.tags.findAll(),
    repos.connections.findAll(),
    repos.imageProfiles.findAll(),
    repos.embeddingProfiles.findAll(),
    repos.files.findAll(),
    // Get user-created templates (excludes built-in templates)
    globalRepos.promptTemplates.findByUserId(userId),
    globalRepos.roleplayTemplates.findByUserId(userId),
  ]);

  moduleLogger.debug('Collected base entities', {
    userId,
    characters: characters.length,
    personas: personas.length,
    chats: chatMetadatas.length,
    tags: tags.length,
    connectionProfiles: connectionProfiles.length,
    imageProfiles: imageProfiles.length,
    embeddingProfiles: embeddingProfiles.length,
    files: files.length,
    promptTemplates: promptTemplates.length,
    roleplayTemplates: roleplayTemplates.length,
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
    personas,
    chats,
    tags,
    connectionProfiles: sanitizedConnectionProfiles,
    imageProfiles,
    embeddingProfiles,
    memories,
    files,
    promptTemplates,
    roleplayTemplates,
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
      personas: data.personas.length,
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
  archive.append(JSON.stringify(data.personas, null, 2), {
    name: `${folderName}/data/personas.json`,
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

  // Add actual files from S3
  moduleLogger.debug('Adding files from S3', { userId, fileCount: data.files.length });

  for (const file of data.files) {
    if (file.s3Key) {
      try {
        const fileBuffer = await downloadFile(file.s3Key);
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
          s3Key: file.s3Key,
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
 * Saves a backup ZIP to S3
 */
export async function saveBackupToS3(
  userId: string,
  zipBuffer: Buffer,
  customFilename?: string
): Promise<string> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = customFilename || `backup-${timestamp}.zip`;

  // Store in the user's backups folder
  const s3Key = `users/${userId}/backups/${filename}`;

  moduleLogger.debug('Saving backup to S3', { userId, s3Key, size: zipBuffer.length });

  await s3FileService.uploadUserFile(
    userId,
    `backup-${timestamp}`,
    filename,
    'backups',
    zipBuffer,
    'application/zip'
  );

  moduleLogger.info('Backup saved to S3', { userId, s3Key });

  return s3Key;
}

/**
 * Lists all backups stored in S3 for a user
 */
export async function listS3Backups(userId: string): Promise<BackupInfo[]> {
  moduleLogger.debug('Listing S3 backups', { userId });

  const keys = await s3FileService.listUserFiles(userId, 'backups');

  const backups: BackupInfo[] = [];

  for (const key of keys) {
    try {
      const metadata = await s3FileService.getFileInfo(key);
      if (metadata) {
        // Extract filename from key
        const parts = key.split('/');
        const filename = parts[parts.length - 1];

        backups.push({
          key,
          filename,
          createdAt: metadata.lastModified,
          size: metadata.size,
        });
      }
    } catch (error) {
      moduleLogger.warn('Failed to get metadata for backup', {
        key,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Sort by creation date, newest first
  backups.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  moduleLogger.debug('Listed S3 backups', { userId, count: backups.length });

  return backups;
}

/**
 * Downloads a backup from S3
 */
export async function downloadBackupFromS3(s3Key: string): Promise<Buffer> {
  moduleLogger.debug('Downloading backup from S3', { s3Key });

  const buffer = await downloadFile(s3Key);

  moduleLogger.debug('Downloaded backup from S3', { s3Key, size: buffer.length });

  return buffer;
}

/**
 * Deletes a backup from S3
 */
export async function deleteBackupFromS3(s3Key: string): Promise<void> {
  moduleLogger.debug('Deleting backup from S3', { s3Key });

  await s3FileService.deleteByS3Key(s3Key);

  moduleLogger.info('Deleted backup from S3', { s3Key });
}
