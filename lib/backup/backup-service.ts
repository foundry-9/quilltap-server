/**
 * Backup Service
 *
 * Creates complete user data backups by collecting all user data from the database
 * and file storage, then packaging it into a ZIP archive on disk using shell `zip`.
 * No in-memory zip operations — files are staged in a temp directory and compressed
 * by the `zip` binary to avoid OOM in memory-constrained VMs.
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
import { getRawDatabase } from '@/lib/database/backends/sqlite/client';
import { runBackupCheckpoint } from '@/lib/database/backends/sqlite/protection';
import { getRawLLMLogsDatabase } from '@/lib/database/backends/sqlite/llm-logs-client';
import { runLLMLogsBackupCheckpoint } from '@/lib/database/backends/sqlite/llm-logs-protection';
import type { BackupManifest, BackupData, ChatWithMessages } from './types';
import type { ChatEvent } from '@/lib/schemas/types';

const execFileAsync = promisify(execFile);

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
    chatSettingsResult,
    folders,
    wardrobeItems,
    outfitPresets,
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
    // Get chat settings (returns single object or null)
    globalRepos.chatSettings.findByUserId(userId),
    // Get folders
    globalRepos.folders.findByUserId(userId),
    // Get wardrobe items and outfit presets
    globalRepos.wardrobe.findAll(),
    globalRepos.outfitPresets.findAll(),
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

  // Wrap chatSettings in an array for backup (it's a single record per user)
  const chatSettings = chatSettingsResult ? [chatSettingsResult] : [];

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
    chatSettings,
    folders,
    wardrobeItems,
    outfitPresets,
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
    backupFormat: 2,
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
      chatSettings: data.chatSettings?.length || 0,
      folders: data.folders?.length || 0,
      wardrobeItems: data.wardrobeItems?.length || 0,
      outfitPresets: data.outfitPresets?.length || 0,
      npmPlugins: countNpmPlugins(),
    },
  };
}

/**
 * Writes a JSON file to the staging directory
 */
async function writeJsonFile(filePath: string, data: unknown): Promise<void> {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  await fs.promises.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
}

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
 * Creates a complete backup as a ZIP file on disk.
 *
 * Stages all data in a temp directory and shells out to `zip -r` to create
 * the archive. At no point is more than one user file buffer in memory.
 *
 * @returns The path to the zip file on disk and the backup manifest
 */
export async function createBackup(userId: string): Promise<{
  zipPath: string;
  manifest: BackupManifest;
}> {
  moduleLogger.info('Starting backup creation', { userId });

  // Flush WAL to ensure logical backup reads consistent data
  const rawDb = getRawDatabase();
  if (rawDb) {
    runBackupCheckpoint(rawDb);
  }

  // Also checkpoint the LLM logs database
  const rawLLMLogsDb = getRawLLMLogsDatabase();
  if (rawLLMLogsDb) {
    runLLMLogsBackupCheckpoint(rawLLMLogsDb);
  }

  // Collect all user data
  const data = await collectUserData(userId);
  const manifest = createManifest(userId, data);

  // Create temp directory for staging
  const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'quilltap-backup-'));
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const folderName = `quilltap-backup-${timestamp}`;
  const stagingDir = path.join(tempDir, folderName);

  moduleLogger.debug('Created staging directory', { tempDir, folderName });

  try {
    // Create staging directory structure
    await fs.promises.mkdir(path.join(stagingDir, 'data'), { recursive: true });

    // Write data files sequentially to limit memory pressure
    await writeJsonFile(path.join(stagingDir, 'data', 'characters.json'), data.characters);
    await writeJsonFile(path.join(stagingDir, 'data', 'chats.json'), data.chats);
    await writeJsonFile(path.join(stagingDir, 'data', 'tags.json'), data.tags);
    await writeJsonFile(path.join(stagingDir, 'data', 'connection-profiles.json'), data.connectionProfiles);
    await writeJsonFile(path.join(stagingDir, 'data', 'image-profiles.json'), data.imageProfiles);
    await writeJsonFile(path.join(stagingDir, 'data', 'embedding-profiles.json'), data.embeddingProfiles);
    await writeJsonFile(path.join(stagingDir, 'data', 'memories.json'), data.memories);
    await writeJsonFile(path.join(stagingDir, 'data', 'files.json'), data.files);
    await writeJsonFile(path.join(stagingDir, 'data', 'prompt-templates.json'), data.promptTemplates);
    await writeJsonFile(path.join(stagingDir, 'data', 'roleplay-templates.json'), data.roleplayTemplates);
    await writeJsonFile(path.join(stagingDir, 'data', 'provider-models.json'), data.providerModels);
    await writeJsonFile(path.join(stagingDir, 'data', 'projects.json'), data.projects);
    await writeJsonFile(path.join(stagingDir, 'data', 'llm-logs.json'), data.llmLogs);
    await writeJsonFile(path.join(stagingDir, 'data', 'plugin-configs.json'), data.pluginConfigs || []);
    await writeJsonFile(path.join(stagingDir, 'data', 'chat-settings.json'), data.chatSettings || []);
    await writeJsonFile(path.join(stagingDir, 'data', 'folders.json'), data.folders || []);
    await writeJsonFile(path.join(stagingDir, 'data', 'wardrobe-items.json'), data.wardrobeItems || []);
    await writeJsonFile(path.join(stagingDir, 'data', 'outfit-presets.json'), data.outfitPresets || []);

    moduleLogger.debug('Wrote all JSON data files to staging directory');

    // Download and stage user files one at a time to limit memory
    let filesStaged = 0;
    for (const file of data.files) {
      if (file.storageKey) {
        try {
          const fileBuffer = await fileStorageManager.downloadFile(file);
          // Use storageKey as path in backup (preserves real folder structure)
          const fileDest = path.join(stagingDir, 'files', file.storageKey);
          await fs.promises.mkdir(path.dirname(fileDest), { recursive: true });
          await fs.promises.writeFile(fileDest, fileBuffer);
          filesStaged++;
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

    moduleLogger.debug('Staged user files', { filesStaged, totalFiles: data.files.length });

    // Copy npm-installed plugins
    const npmPluginsDir = getNpmPluginsDir();
    if (fs.existsSync(npmPluginsDir)) {
      try {
        const pluginDirs = fs.readdirSync(npmPluginsDir, { withFileTypes: true });
        for (const entry of pluginDirs) {
          if (entry.isDirectory()) {
            const srcPath = path.join(npmPluginsDir, entry.name);
            const destPath = path.join(stagingDir, 'plugins', 'npm', entry.name);
            await fs.promises.cp(srcPath, destPath, { recursive: true });
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

    // Write manifest last (after all data is staged)
    await writeJsonFile(path.join(stagingDir, 'manifest.json'), manifest);

    // Create the zip using shell `zip -r`
    const zipFilePath = path.join(tempDir, `${folderName}.zip`);

    moduleLogger.debug('Running shell zip command', { cwd: tempDir, folderName });

    await execFileAsync('zip', ['-r', zipFilePath, folderName], {
      cwd: tempDir,
      maxBuffer: 10 * 1024 * 1024, // 10MB for zip stdout (progress output)
    });

    // Clean up the staging folder (keep only the zip)
    await cleanupDir(stagingDir);

    // Get final zip size for logging
    const zipStat = await fs.promises.stat(zipFilePath);

    moduleLogger.info('Backup creation completed', {
      userId,
      zipPath: zipFilePath,
      zipSize: zipStat.size,
      manifest,
    });

    return { zipPath: zipFilePath, manifest };
  } catch (error) {
    // Clean up the entire temp dir on failure
    await cleanupDir(tempDir);
    throw error;
  }
}
