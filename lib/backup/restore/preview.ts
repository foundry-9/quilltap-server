/**
 * Restore preview: extract the archive, count what each entity would restore,
 * then clean up — without writing anything to the database or file storage.
 *
 * @module backup/restore/preview
 */

import path from 'path';
import type { RestoreSummary } from '../types';
import {
  parseBackupZip,
  countNpmPluginsInExtractedBackup,
  cleanupDir,
} from './archive';

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
      chatSettings: data.chatSettings?.length || 0,
      folders: data.folders?.length || 0,
      wardrobeItems: data.wardrobeItems?.length || 0,
      npmPlugins: npmPluginCount,
      characterPluginData: data.characterPluginData?.length || 0,
      conversationAnnotations: data.conversationAnnotations?.length || 0,
      userInstalledThemes: 0, // Counted after zip extraction; not shown in preview
      chatDocuments: data.chatDocuments?.length || 0,
      instanceSettings: data.instanceSettings?.length || 0,
      embeddingStatus: data.embeddingStatus?.length || 0,
      conversationChunks: data.conversationChunks?.length || 0,
      tfidfVocabularies: data.tfidfVocabularies?.length || 0,
      vectorIndexMetas: data.vectorIndexMetas?.length || 0,
      vectorEntries: data.vectorEntries?.length || 0,
      docMountPoints: data.docMountPoints?.length || 0,
      docMountFolders: data.docMountFolders?.length || 0,
      docMountFiles: data.docMountFiles?.length || 0,
      docMountFileLinks: data.docMountFileLinks?.length || 0,
      docMountChunks: data.docMountChunks?.length || 0,
      docMountDocuments: data.docMountDocuments?.length || 0,
      docMountBlobs: data.docMountBlobs?.length || 0,
      projectDocMountLinks: data.projectDocMountLinks?.length || 0,
      warnings: [],
    };
  } finally {
    await cleanupDir(extractDir);
  }
}
