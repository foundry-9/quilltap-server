/**
 * Import orchestrator: drive every entity importer in dependency order,
 * thread the shared id maps and warnings through them, run the inline
 * chat-sidecar imports (conversation annotations + Document Mode pane state),
 * and finish with a reconciliation pass.
 *
 * @module import/quilltap-import/execute
 */

import { logger } from '@/lib/logger';
import { getUserRepositories, getRepositories } from '@/lib/repositories/factory';
import type { QuilltapExport, QuilltapExportCounts } from '@/lib/export/types';
import {
  type ImportOptions,
  type ImportResult,
  type IdMappingState,
  getExportData,
} from './types';
import {
  importConnectionProfiles,
  importImageProfiles,
  importEmbeddingProfiles,
} from './import-profiles';
import { importCharacters } from './import-characters';
import {
  importTags,
  importRoleplayTemplates,
  importProjects,
  importGroups,
  importChats,
  importMemories,
} from './import-entities';
import { importDocumentStores } from './import-document-stores';
import { reconcileRelationships } from './reconcile';

const moduleLogger = logger.child({ module: 'import:quilltap-import-service' });

/**
 * Executes the import of QuilltapExport data
 */
export async function executeImport(
  userId: string,
  exportData: QuilltapExport,
  options: ImportOptions
): Promise<ImportResult> {
  moduleLogger.info('Starting import execution', {
    userId,
    conflictStrategy: options.conflictStrategy,
    includeMemories: options.includeMemories,
  });

  const repos = getUserRepositories(userId);
  const globalRepos = getRepositories();
  const warnings: string[] = [];

  // Initialize ID mapping state
  const idMaps: IdMappingState = {
    tags: new Map(),
    characters: new Map(),
    chats: new Map(),
    connectionProfiles: new Map(),
    imageProfiles: new Map(),
    embeddingProfiles: new Map(),
    roleplayTemplates: new Map(),
    projects: new Map(),
    groups: new Map(),
    mountPoints: new Map(),
  };

  // Initialize counts
  const imported: QuilltapExportCounts = {
    characters: 0,
    chats: 0,
    messages: 0,
    roleplayTemplates: 0,
    connectionProfiles: 0,
    imageProfiles: 0,
    embeddingProfiles: 0,
    tags: 0,
    memories: 0,
    projects: 0,
    groups: 0,
  };

  const skipped: QuilltapExportCounts = {
    characters: 0,
    chats: 0,
    messages: 0,
    roleplayTemplates: 0,
    connectionProfiles: 0,
    imageProfiles: 0,
    embeddingProfiles: 0,
    tags: 0,
    memories: 0,
    projects: 0,
    groups: 0,
  };

  const data = getExportData(exportData);

  try {
    // Import in dependency order
    // 1. Tags (no dependencies)
    if (data.tags && data.tags.length > 0) {
      const tagCounts = await importTags(
        userId,
        data.tags,
        options,
        idMaps,
        repos
      );
      imported.tags = tagCounts.imported;
      skipped.tags = tagCounts.skipped;
    }

    // 2. Connection Profiles
    if (data.connectionProfiles && data.connectionProfiles.length > 0) {
      const counts = await importConnectionProfiles(
        userId,
        data.connectionProfiles,
        options,
        idMaps,
        repos
      );
      imported.connectionProfiles = counts.imported;
      skipped.connectionProfiles = counts.skipped;
    }

    // 3. Image Profiles
    if (data.imageProfiles && data.imageProfiles.length > 0) {
      const counts = await importImageProfiles(
        userId,
        data.imageProfiles,
        options,
        idMaps,
        repos
      );
      imported.imageProfiles = counts.imported;
      skipped.imageProfiles = counts.skipped;
    }

    // 4. Embedding Profiles
    if (data.embeddingProfiles && data.embeddingProfiles.length > 0) {
      const counts = await importEmbeddingProfiles(
        userId,
        data.embeddingProfiles,
        options,
        idMaps,
        repos
      );
      imported.embeddingProfiles = counts.imported;
      skipped.embeddingProfiles = counts.skipped;
    }

    // 5. Roleplay Templates
    if (data.roleplayTemplates && data.roleplayTemplates.length > 0) {
      const counts = await importRoleplayTemplates(
        userId,
        data.roleplayTemplates,
        options,
        idMaps,
        globalRepos
      );
      imported.roleplayTemplates = counts.imported;
      skipped.roleplayTemplates = counts.skipped;
    }

    // 5.5. Projects (before characters since projects reference characters in roster)
    if (data.projects && data.projects.length > 0) {
      const counts = await importProjects(
        userId,
        data.projects,
        options,
        idMaps,
        repos,
        warnings
      );
      imported.projects = counts.imported;
      skipped.projects = counts.skipped;
    }

    // 5.6. Groups (before characters since groups reference characters in membership)
    if (data.groups && data.groups.length > 0) {
      const counts = await importGroups(
        userId,
        data.groups,
        options,
        idMaps,
        repos,
        warnings
      );
      imported.groups = counts.imported;
      skipped.groups = counts.skipped;
    }

    // 6. Characters
    if (data.characters && data.characters.length > 0) {
      const counts = await importCharacters(
        userId,
        data.characters,
        options,
        idMaps,
        repos,
        warnings
      );
      imported.characters = counts.imported;
      skipped.characters = counts.skipped;
    }

    // 7. Chats
    if (data.chats && data.chats.length > 0) {
      const counts = await importChats(
        userId,
        data.chats,
        options,
        idMaps,
        repos,
        warnings
      );
      imported.chats = counts.imported;
      imported.messages = counts.messages;
      skipped.chats = counts.skipped;
    }

    // 7a. Conversation annotations attached to imported chats. Remap chatId
    // through idMaps.chats; sourceMessageId stays as-is because the message
    // import preserves message IDs.
    if (data.conversationAnnotations && data.conversationAnnotations.length > 0) {
      const globalRepos = getRepositories();
      let annotationsImported = 0;
      for (const annotation of data.conversationAnnotations) {
        const remappedChatId = idMaps.chats.get(annotation.chatId) ?? annotation.chatId;
        try {
          const { id, createdAt, updatedAt, ...annotationData } = annotation;
          await globalRepos.conversationAnnotations.create({
            ...annotationData,
            chatId: remappedChatId,
          });
          annotationsImported++;
        } catch (error) {
          warnings.push(
            `Failed to import conversation annotation: ${
              error instanceof Error ? error.message : String(error)
            }`
          );
        }
      }
      imported.conversationAnnotations = annotationsImported;
    }

    // 7b. Chat documents (Document Mode pane state). Remap chatId; the rest
    // is opaque path/scope metadata that survives without remapping.
    if (data.chatDocuments && data.chatDocuments.length > 0) {
      const globalRepos = getRepositories();
      let chatDocsImported = 0;
      for (const cd of data.chatDocuments) {
        const remappedChatId = idMaps.chats.get(cd.chatId) ?? cd.chatId;
        try {
          const { id, createdAt, updatedAt, ...cdData } = cd;
          await globalRepos.chatDocuments.create({
            ...cdData,
            chatId: remappedChatId,
          });
          chatDocsImported++;
        } catch (error) {
          warnings.push(
            `Failed to import chat document: ${
              error instanceof Error ? error.message : String(error)
            }`
          );
        }
      }
      imported.chatDocuments = chatDocsImported;
    }

    // 7c. Group character membership and linked document stores. Remap
    // group and character IDs; skip members/links that don't exist in the import.
    if (data.groups && data.groups.length > 0) {
      const groupsData = data.groups as Array<{
        id: string;
        _memberCharacterIds?: string[];
        _linkedStoreMountPointIds?: string[];
      }>;

      for (const groupExport of groupsData) {
        const remappedGroupId = idMaps.groups.get(groupExport.id) ?? groupExport.id;

        // Re-establish character membership
        if (groupExport._memberCharacterIds && groupExport._memberCharacterIds.length > 0) {
          for (const characterId of groupExport._memberCharacterIds) {
            const remappedCharacterId = idMaps.characters.get(characterId);
            if (!remappedCharacterId) {
              moduleLogger.debug('Skipping group member — character not in import', {
                groupId: groupExport.id,
                characterId,
              });
              continue;
            }
            try {
              await repos.groupCharacterMembers.addMember(remappedGroupId, remappedCharacterId);
            } catch (error) {
              moduleLogger.warn('Failed to add group member', {
                groupId: remappedGroupId,
                characterId: remappedCharacterId,
                error: error instanceof Error ? error.message : String(error),
              });
            }
          }
        }

        // Link additional document stores (beyond the official mount point)
        if (groupExport._linkedStoreMountPointIds && groupExport._linkedStoreMountPointIds.length > 0) {
          for (const mountPointId of groupExport._linkedStoreMountPointIds) {
            const remappedMountPointId = idMaps.mountPoints.get(mountPointId);
            if (!remappedMountPointId) {
              moduleLogger.debug('Skipping group linked store — mount point not in import', {
                groupId: groupExport.id,
                mountPointId,
              });
              continue;
            }
            try {
              await repos.groupDocMountLinks.link(remappedGroupId, remappedMountPointId);
            } catch (error) {
              moduleLogger.warn('Failed to link document store to group', {
                groupId: remappedGroupId,
                mountPointId: remappedMountPointId,
                error: error instanceof Error ? error.message : String(error),
              });
            }
          }
        }
      }
    }

    // 8. Memories (if includeMemories option is enabled)
    if (options.includeMemories && data.memories && data.memories.length > 0) {
      const counts = await importMemories(
        userId,
        data.memories,
        idMaps,
        repos,
        warnings
      );
      imported.memories = counts.imported;
      skipped.memories = counts.skipped;
    }

    // 9. Document stores (Scriptorium) — mount point configs plus, for
    //    database-backed mounts, folder structures, document bodies and blobs.
    if (data.mountPoints && data.mountPoints.length > 0) {
      const counts = await importDocumentStores(
        data.mountPoints,
        data.folders ?? [],
        data.documents ?? [],
        data.blobs ?? [],
        data.projectLinks ?? [],
        options,
        repos,
        idMaps,
        warnings
      );
      imported.documentStores = counts.mountPoints;
      imported.documentStoreFolders = counts.folders;
      imported.documentStoreDocuments = counts.documents;
      imported.documentStoreBlobs = counts.blobs;
      imported.documentStoreProjectLinks = counts.projectLinks;
    }

    // Post-import reconciliation
    await reconcileRelationships(userId, repos, idMaps, warnings);

    moduleLogger.info('Import execution completed successfully', {
      userId,
      imported,
      skipped,
      warningCount: warnings.length,
    });

    return {
      success: true,
      imported,
      skipped,
      warnings,
    };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : String(error);
    moduleLogger.error('Import execution failed', {
      userId,
      error: errorMessage,
    });

    return {
      success: false,
      imported,
      skipped,
      warnings: [
        ...warnings,
        `Import failed: ${errorMessage}`,
      ],
    };
  }
}
