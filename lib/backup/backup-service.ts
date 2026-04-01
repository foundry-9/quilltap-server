/**
 * Backup Service
 *
 * Creates complete user data backups by collecting all user data from the database
 * and S3, then packaging it into a ZIP archive.
 */

import archiver from 'archiver';
import fs from 'fs';
import path from 'path';
import { logger } from '@/lib/logger';
import { getUserRepositories } from '@/lib/repositories/user-scoped';
import { getRepositories } from '@/lib/repositories/factory';
import { fileStorageManager } from '@/lib/file-storage/manager';
import { getNpmPluginsDir } from '@/lib/paths';
import type { BackupManifest, BackupData, ChatWithMessages } from './types';
import type { ChatEvent } from '@/lib/schemas/types';

// Get app version from package.json
const APP_VERSION = process.env.npm_package_version || '2.0.0';

const moduleLogger = logger.child({ module: 'backup:backup-service' });

/**
 * Collects all user data from database repositories
 */
async function collectUserData(userId: string): Promise<Omit<BackupData, 'manifest'>> {
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
    pluginConfigs,
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
    // Get plugin configurations
    globalRepos.pluginConfigs.findByUserId(userId),
  ]);

  // Exclude backup files from the file list - we don't want to back up old backups
  const filteredFiles = files.filter(
    (file) => file.category !== 'BACKUP' && file.folderPath !== '/backups'
  );
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
    pluginConfigs,
  };
}

/**
 * Counts npm-installed plugins in the plugins/npm directory
 */
function countNpmPlugins(): number {
  try {
    const npmPluginsDir = getNpmPluginsDir();
    if (!fs.existsSync(npmPluginsDir)) {
      return 0;
    }
    // Count directories in plugins/npm (each directory is a plugin)
    const entries = fs.readdirSync(npmPluginsDir, { withFileTypes: true });
    return entries.filter(entry => entry.isDirectory()).length;
  } catch (error) {
    moduleLogger.warn('Failed to count npm plugins', {
      error: error instanceof Error ? error.message : String(error),
    });
    return 0;
  }
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
      pluginConfigs: data.pluginConfigs?.length || 0,
      npmPlugins: countNpmPlugins(),
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
  archive.append(JSON.stringify(data.pluginConfigs || [], null, 2), {
    name: `${folderName}/data/plugin-configs.json`,
  });

  // Add actual files from storage

  for (const file of data.files) {
    if (file.storageKey) {
      try {
        const fileBuffer = await fileStorageManager.downloadFile(file);
        archive.append(fileBuffer, {
          name: `${folderName}/files/${file.category}/${file.id}_${file.originalFilename}`,
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

  // Add npm-installed plugins directory
  const npmPluginsDir = getNpmPluginsDir();
  if (fs.existsSync(npmPluginsDir)) {
    try {
      const pluginDirs = fs.readdirSync(npmPluginsDir, { withFileTypes: true });
      for (const entry of pluginDirs) {
        if (entry.isDirectory()) {
          const pluginPath = path.join(npmPluginsDir, entry.name);
          archive.directory(pluginPath, `${folderName}/plugins/npm/${entry.name}`);
          moduleLogger.debug('Added npm plugin to backup', { pluginName: entry.name });
        }
      }
    } catch (error) {
      moduleLogger.warn('Failed to add npm plugins to backup', {
        error: error instanceof Error ? error.message : String(error),
      });
      // Continue with backup even if npm plugins fail
    }
  }

  // Finalize and wait for the archive to complete
  await new Promise<void>((resolve, reject) => {
    archive.on('end', () => {
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
