/**
 * Quilltap Export Service
 *
 * Implements export logic for creating selective entity exports with optional
 * memory inclusion. Supports all entity types with proper sanitization and
 * metadata resolution.
 */

import { logger as baseLogger } from '@/lib/logger';
import { getUserRepositories } from '@/lib/repositories/factory';
import { getRepositories } from '@/lib/repositories/factory';
import packageJson from '@/package.json';
import type {
  ExportOptions,
  ExportPreview,
  QuilltapExport,
  QuilltapExportManifest,
  ExportedCharacter,
  ExportedChat,
  ExportedRoleplayTemplate,
  ExportedProject,
  SanitizedConnectionProfile,
  SanitizedImageProfile,
  SanitizedEmbeddingProfile,
  CharactersExportData,
  ChatsExportData,
  RoleplayTemplatesExportData,
  ConnectionProfilesExportData,
  ImageProfilesExportData,
  EmbeddingProfilesExportData,
  TagsExportData,
  ProjectsExportData,
  MemoryCollection,
  DocumentStoresExportData,
  ExportedDocumentStore,
  ExportedDocumentStoreDocument,
  ExportedDocumentStoreBlob,
} from './types';
import type {
  Character,
  ChatMetadata,
  Memory,
  MessageEvent,
  RoleplayTemplate,
} from '@/lib/schemas/types';
import type { WardrobeItem } from '@/lib/schemas/wardrobe.types';

const logger = baseLogger.child({ module: 'export:quilltap-export-service' });
const APP_VERSION = packageJson.version;

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Sanitize a profile by removing apiKeyId and adding a label reference
 */
function sanitizeProfile<T extends { apiKeyId?: string | null }>(
  profile: T,
  apiKeyLabel?: string
): Omit<T, 'apiKeyId'> & { _apiKeyLabel?: string } {
  const { apiKeyId, ...sanitized } = profile;
  return {
    ...sanitized,
    ...(apiKeyLabel && { _apiKeyLabel: apiKeyLabel }),
  } as Omit<T, 'apiKeyId'> & { _apiKeyLabel?: string };
}

/**
 * Resolve tag names from tag IDs
 */
async function resolveTagNames(
  repos: ReturnType<typeof getUserRepositories>,
  tagIds: string[]
): Promise<string[]> {
  if (!tagIds || tagIds.length === 0) return [];

  try {
    const tagNames: string[] = [];
    for (const tagId of tagIds) {
      const tag = await repos.tags.findById(tagId);
      if (tag) {
        tagNames.push(tag.name);
      }
    }
    return tagNames;
  } catch (error) {
    return [];
  }
}

/**
 * Resolve API key labels from API key IDs
 */
async function resolveApiKeyLabel(
  repos: ReturnType<typeof getUserRepositories>,
  apiKeyId?: string | null
): Promise<string | undefined> {
  if (!apiKeyId) return undefined;

  try {
    const apiKey = await repos.connections.findApiKeyById(apiKeyId);
    return apiKey?.label;
  } catch (error) {
    return undefined;
  }
}

/**
 * Collect all memories for a character
 */
async function collectCharacterMemories(
  repos: ReturnType<typeof getUserRepositories>,
  characterId: string
): Promise<Memory[]> {
  try {
    return await repos.memories.findByCharacterId(characterId);
  } catch (error) {
    return [];
  }
}

/**
 * Collect all memories for a chat
 */
async function collectChatMemories(
  repos: ReturnType<typeof getUserRepositories>,
  chatId: string
): Promise<Memory[]> {
  try {
    // Get all characters and collect their memories filtered by chatId
    const characters = await repos.characters.findAll();
    const memoriesArrays = await Promise.all(
      characters.map(char => repos.memories.findByCharacterId(char.id))
    );
    const allMemories = memoriesArrays.flat();
    return allMemories.filter(m => m.chatId === chatId);
  } catch (error) {
    return [];
  }
}

/**
 * Get messages for a chat
 */
async function getChatMessages(
  repos: ReturnType<typeof getUserRepositories>,
  chatId: string
): Promise<MessageEvent[]> {
  try {
    const messages = await repos.chats.getMessages(chatId);
    return messages.filter(
      (event): event is MessageEvent => event.type === 'message'
    );
  } catch (error) {
    return [];
  }
}

/**
 * Generate a timestamp-based export filename
 */
export function generateExportFilename(type: string): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('Z')[0];
  return `quilltap-${type}-${timestamp}.qtap`;
}

/**
 * Create the export manifest
 */
function createManifest(
  type: string,
  settings: ExportOptions,
  counts: Record<string, number>
): QuilltapExportManifest {
  return {
    format: 'quilltap-export',
    version: '1.0',
    exportType: type as any,
    createdAt: new Date().toISOString(),
    appVersion: APP_VERSION,
    settings: {
      includeMemories: settings.includeMemories ?? false,
      scope: settings.scope,
      selectedIds: settings.selectedIds ?? [],
    },
    counts: counts,
  };
}

// ============================================================================
// EXPORT FUNCTIONS BY ENTITY TYPE
// ============================================================================

/**
 * Export characters with optional memories
 */
export async function exportCharacters(
  userId: string,
  characterIds: string[],
  includeMemories: boolean
): Promise<CharactersExportData> {
  const repos = getUserRepositories(userId);
  const globalRepos = getRepositories();

  // Fetch characters
  const characters: ExportedCharacter[] = [];
  for (const id of characterIds) {
    const character = await repos.characters.findById(id);
    if (character) {
      const tagNames = await resolveTagNames(repos, character.tags);

      // Load wardrobe items for this character (skip archetypes — characterId=null)
      let wardrobeItems: WardrobeItem[] = [];
      try {
        wardrobeItems = await globalRepos.wardrobe.findByCharacterId(id);
        logger.debug('Loaded wardrobe items for character export', {
          characterId: id,
          wardrobeItemCount: wardrobeItems.length,
        });
      } catch (error) {
        logger.warn('Failed to load wardrobe items for character export', {
          characterId: id,
          error: error instanceof Error ? error.message : String(error),
        });
      }

      // Load plugin data for this character
      let pluginData: Record<string, unknown> = {};
      try {
        pluginData = await globalRepos.characterPluginData.getPluginDataMap(id);
        if (Object.keys(pluginData).length > 0) {
          logger.debug('Loaded plugin data for character export', {
            characterId: id,
            pluginCount: Object.keys(pluginData).length,
          });
        }
      } catch (error) {
        logger.warn('Failed to load plugin data for character export', {
          characterId: id,
          error: error instanceof Error ? error.message : String(error),
        });
      }

      characters.push({
        ...character,
        ...(tagNames.length > 0 && { _tagNames: tagNames }),
        ...(wardrobeItems.length > 0 && { wardrobeItems }),
        ...(Object.keys(pluginData).length > 0 && { pluginData }),
      });
    }
  }
  // Collect memories if requested
  let memories: Memory[] | undefined;
  if (includeMemories) {
    const memoriesArrays = await Promise.all(
      characterIds.map(id => collectCharacterMemories(repos, id))
    );
    memories = memoriesArrays.flat();
  }

  return {
    characters,
    ...(memories && { memories }),
  };
}

/**
 * Export chats with messages and optional memories
 */
export async function exportChats(
  userId: string,
  chatIds: string[],
  includeMemories: boolean
): Promise<ChatsExportData> {
  const repos = getUserRepositories(userId);

  // Fetch chats with messages
  const chats: ExportedChat[] = [];
  let totalMessages = 0;

  for (const id of chatIds) {
    const chat = await repos.chats.findById(id);
    if (chat) {
      const messages = await getChatMessages(repos, id);
      totalMessages += messages.length;

      const tagNames = await resolveTagNames(repos, chat.tags);

      // Resolve participant information
      const participantInfo = await Promise.all(
        chat.participants.map(async (p) => {
          let characterName: string | undefined;

          if (p.type === 'CHARACTER' && p.characterId) {
            const char = await repos.characters.findById(p.characterId);
            characterName = char?.name;
          }

          return {
            participantId: p.id,
            characterName,
            type: p.type,
          };
        })
      );

      chats.push({
        ...chat,
        messages,
        ...(tagNames.length > 0 && { _tagNames: tagNames }),
        ...(participantInfo.length > 0 && { _participantInfo: participantInfo }),
      });
    }
  }
  // Collect memories if requested
  let memories: Memory[] | undefined;
  if (includeMemories) {
    const memoriesArrays = await Promise.all(
      chatIds.map(id => collectChatMemories(repos, id))
    );
    memories = memoriesArrays.flat();
  }

  return {
    chats,
    ...(memories && { memories }),
  };
}

/**
 * Export roleplay templates (user-created only)
 */
export async function exportRoleplayTemplates(
  userId: string,
  templateIds: string[]
): Promise<RoleplayTemplatesExportData> {
  const repos = getUserRepositories(userId);
  const globalRepos = getRepositories();

  // Fetch templates and filter to user-created only (exclude built-in and plugin templates)
  const templates: ExportedRoleplayTemplate[] = [];
  for (const id of templateIds) {
    const template = await globalRepos.roleplayTemplates.findById(id);
    // Verify user owns template (userId is null for built-in, or matches for user-created)
    if (template && !template.isBuiltIn && template.userId === userId) {
      const tagNames = await resolveTagNames(repos, template.tags);
      templates.push({
        ...template,
        ...(tagNames.length > 0 && { _tagNames: tagNames }),
      });
    }
  }
  return {
    roleplayTemplates: templates,
  };
}

/**
 * Export connection profiles with sanitized API key references
 */
export async function exportConnectionProfiles(
  userId: string,
  profileIds: string[]
): Promise<ConnectionProfilesExportData> {
  const repos = getUserRepositories(userId);

  // Fetch profiles and sanitize
  const profiles: SanitizedConnectionProfile[] = [];
  for (const id of profileIds) {
    const profile = await repos.connections.findById(id);
    if (profile) {
      const apiKeyLabel = profile.apiKeyId
        ? await resolveApiKeyLabel(repos, profile.apiKeyId)
        : undefined;

      profiles.push(
        sanitizeProfile(profile, apiKeyLabel) as SanitizedConnectionProfile
      );
    }
  }
  return {
    connectionProfiles: profiles,
  };
}

/**
 * Export image profiles with sanitized API key references
 */
export async function exportImageProfiles(
  userId: string,
  profileIds: string[]
): Promise<ImageProfilesExportData> {
  const repos = getUserRepositories(userId);

  // Fetch profiles and sanitize
  const profiles: SanitizedImageProfile[] = [];
  for (const id of profileIds) {
    const profile = await repos.imageProfiles.findById(id);
    if (profile) {
      const apiKeyLabel = profile.apiKeyId
        ? await resolveApiKeyLabel(repos, profile.apiKeyId)
        : undefined;

      profiles.push(
        sanitizeProfile(profile, apiKeyLabel) as SanitizedImageProfile
      );
    }
  }
  return {
    imageProfiles: profiles,
  };
}

/**
 * Export embedding profiles with sanitized API key references
 */
export async function exportEmbeddingProfiles(
  userId: string,
  profileIds: string[]
): Promise<EmbeddingProfilesExportData> {
  const repos = getUserRepositories(userId);

  // Fetch profiles and sanitize
  const profiles: SanitizedEmbeddingProfile[] = [];
  for (const id of profileIds) {
    const profile = await repos.embeddingProfiles.findById(id);
    if (profile) {
      const apiKeyLabel = profile.apiKeyId
        ? await resolveApiKeyLabel(repos, profile.apiKeyId)
        : undefined;

      profiles.push(
        sanitizeProfile(profile, apiKeyLabel) as SanitizedEmbeddingProfile
      );
    }
  }
  return {
    embeddingProfiles: profiles,
  };
}

/**
 * Export tags
 */
export async function exportTags(
  userId: string,
  tagIds: string[]
): Promise<TagsExportData> {
  const repos = getUserRepositories(userId);

  // Fetch tags
  const tags = [];
  for (const id of tagIds) {
    const tag = await repos.tags.findById(id);
    if (tag) {
      tags.push(tag);
    }
  }
  return {
    tags,
  };
}

/**
 * Export projects with resolved relationships
 */
export async function exportProjects(
  userId: string,
  projectIds: string[]
): Promise<ProjectsExportData> {
  const repos = getUserRepositories(userId);

  // Fetch projects
  const projects: ExportedProject[] = [];
  for (const id of projectIds) {
    const project = await repos.projects.findById(id);
    if (project) {
      // Resolve character roster names
      const characterRosterNames: string[] = [];
      for (const characterId of project.characterRoster ?? []) {
        const character = await repos.characters.findById(characterId);
        if (character) characterRosterNames.push(character.name);
      }

      // Count chats and files associated with this project
      const allChats = await repos.chats.findAll();
      const projectChats = allChats.filter(c => c.projectId === id);
      const chatCount = projectChats.length;

      const allFiles = await repos.files.findAll();
      const projectFiles = allFiles.filter(f => f.linkedTo?.includes(id));
      const fileCount = projectFiles.length;

      projects.push({
        ...project,
        ...(characterRosterNames.length > 0 && { _characterRosterNames: characterRosterNames }),
        _chatCount: chatCount,
        _fileCount: fileCount,
      });
    }
  }
  return {
    projects,
  };
}

/**
 * Export document stores (Scriptorium mount points).
 *
 * Returns every mount point's configuration plus — for database-backed
 * mounts — the document bodies and blobs that live inside
 * quilltap-mount-index.db. Filesystem/obsidian mounts export their
 * configuration only; the user keeps the files on disk.
 *
 * Blob bytes are base64-encoded for JSON safety.
 */
export async function exportDocumentStores(
  _userId: string,
  mountPointIds: string[]
): Promise<DocumentStoresExportData> {
  // Document stores are instance-scoped (Quilltap is single-user) so we use
  // the global repository container — UserScopedRepositoryContainer does not
  // wrap the docMount* repos on purpose.
  const repos = getRepositories();

  const mountPoints: ExportedDocumentStore[] = [];
  const documents: ExportedDocumentStoreDocument[] = [];
  const blobs: ExportedDocumentStoreBlob[] = [];

  for (const id of mountPointIds) {
    const mp = await repos.docMountPoints.findById(id);
    if (!mp) continue;
    mountPoints.push({
      id: mp.id,
      name: mp.name,
      basePath: mp.basePath,
      mountType: mp.mountType,
      includePatterns: mp.includePatterns,
      excludePatterns: mp.excludePatterns,
      enabled: mp.enabled,
    });

    if (mp.mountType === 'database') {
      const docs = await repos.docMountDocuments.findByMountPointId(mp.id);
      for (const d of docs) {
        documents.push({
          mountPointId: d.mountPointId,
          relativePath: d.relativePath,
          fileName: d.fileName,
          fileType: d.fileType,
          content: d.content,
          contentSha256: d.contentSha256,
          plainTextLength: d.plainTextLength,
          lastModified: d.lastModified,
        });
      }
    }

    // Blobs are universal — export for every mount type so uploads persist.
    const blobMetas = await repos.docMountBlobs.listByMountPoint(mp.id);
    for (const meta of blobMetas) {
      const data = await repos.docMountBlobs.readData(meta.id);
      if (!data) continue;
      blobs.push({
        mountPointId: meta.mountPointId,
        relativePath: meta.relativePath,
        originalFileName: meta.originalFileName,
        originalMimeType: meta.originalMimeType,
        storedMimeType: meta.storedMimeType,
        sizeBytes: meta.sizeBytes,
        sha256: meta.sha256,
        description: meta.description,
        dataBase64: data.toString('base64'),
      });
    }
  }

  return { mountPoints, documents, blobs };
}

// ============================================================================
// PUBLIC API FUNCTIONS
// ============================================================================

/**
 * Create an export based on the provided options
 * Returns the complete export structure ready for serialization
 */
export async function createExport(
  userId: string,
  options: ExportOptions
): Promise<QuilltapExport> {
  logger.info('Creating export', { userId, type: options.type, scope: options.scope });

  try {
    const repos = getUserRepositories(userId);
    let data: any;
    let entityCount = 0;
    let memoryCount = 0;

    // Determine entity IDs based on scope
    const entityIds = options.scope === 'all'
      ? [] // Will be filled by entity-specific exporters
      : (options.selectedIds ?? []);

    switch (options.type) {
      case 'characters': {
        const allCharacters = options.scope === 'all'
          ? await repos.characters.findAll()
          : [];
        const ids = options.scope === 'all'
          ? allCharacters.map(c => c.id)
          : entityIds;

        data = await exportCharacters(userId, ids, options.includeMemories ?? false);
        entityCount = data.characters.length;
        memoryCount = data.memories?.length ?? 0;
        break;
      }

      case 'chats': {
        const allChats = options.scope === 'all'
          ? await repos.chats.findAll()
          : [];
        const ids = options.scope === 'all'
          ? allChats.map(c => c.id)
          : entityIds;

        data = await exportChats(userId, ids, options.includeMemories ?? false);
        entityCount = data.chats.length;
        memoryCount = data.memories?.length ?? 0;
        break;
      }

      case 'roleplay-templates': {
        const globalRepos = getRepositories();
        const allTemplates = options.scope === 'all'
          ? await globalRepos.roleplayTemplates.findAll()
          : [];
        const ids = options.scope === 'all'
          ? allTemplates
              .filter(t => !t.isBuiltIn && t.userId === userId)
              .map(t => t.id)
          : entityIds;

        data = await exportRoleplayTemplates(userId, ids);
        entityCount = data.roleplayTemplates.length;
        break;
      }

      case 'connection-profiles': {
        const allProfiles = options.scope === 'all'
          ? await repos.connections.findAll()
          : [];
        const ids = options.scope === 'all'
          ? allProfiles.map(p => p.id)
          : entityIds;

        data = await exportConnectionProfiles(userId, ids);
        entityCount = data.connectionProfiles.length;
        break;
      }

      case 'image-profiles': {
        const allProfiles = options.scope === 'all'
          ? await repos.imageProfiles.findAll()
          : [];
        const ids = options.scope === 'all'
          ? allProfiles.map(p => p.id)
          : entityIds;

        data = await exportImageProfiles(userId, ids);
        entityCount = data.imageProfiles.length;
        break;
      }

      case 'embedding-profiles': {
        const allProfiles = options.scope === 'all'
          ? await repos.embeddingProfiles.findAll()
          : [];
        const ids = options.scope === 'all'
          ? allProfiles.map(p => p.id)
          : entityIds;

        data = await exportEmbeddingProfiles(userId, ids);
        entityCount = data.embeddingProfiles.length;
        break;
      }

      case 'tags': {
        const allTags = options.scope === 'all'
          ? await repos.tags.findAll()
          : [];
        const ids = options.scope === 'all'
          ? allTags.map(t => t.id)
          : entityIds;

        data = await exportTags(userId, ids);
        entityCount = data.tags.length;
        break;
      }

      case 'projects': {
        const allProjects = options.scope === 'all'
          ? await repos.projects.findAll()
          : [];
        const ids = options.scope === 'all'
          ? allProjects.map(p => p.id)
          : entityIds;

        data = await exportProjects(userId, ids);
        entityCount = data.projects.length;
        break;
      }

      case 'document-stores': {
        const globalReposDS = getRepositories();
        const allStores = options.scope === 'all'
          ? await globalReposDS.docMountPoints.findAll()
          : [];
        const ids = options.scope === 'all'
          ? allStores.map(s => s.id)
          : entityIds;

        data = await exportDocumentStores(userId, ids);
        entityCount = data.mountPoints.length;
        break;
      }

      default:
        throw new Error(`Unknown export type: ${options.type}`);
    }

    // Create manifest with counts
    const counts: Record<string, number> = {};
    counts[options.type] = entityCount;
    if (memoryCount > 0) {
      counts.memories = memoryCount;
    }
    // Document stores carry two extra counts for document bodies and blobs —
    // surface them in the manifest so importers know what they're about to load.
    if (options.type === 'document-stores' && data && 'documents' in data && 'blobs' in data) {
      counts.documentStores = entityCount;
      counts.documentStoreDocuments = (data as DocumentStoresExportData).documents.length;
      counts.documentStoreBlobs = (data as DocumentStoresExportData).blobs.length;
    }

    const manifest = createManifest(options.type, options, counts);

    logger.info('Export created successfully', {
      userId,
      type: options.type,
      entityCount,
      memoryCount,
    });

    return {
      manifest,
      data,
    };
  } catch (error) {
    logger.error('Error creating export', { userId, type: options.type }, error as Error);
    throw error;
  }
}

/**
 * Preview what will be exported before creation
 * Returns entity names and counts for UI display
 */
export async function previewExport(
  userId: string,
  options: ExportOptions
): Promise<ExportPreview> {
  try {
    const repos = getUserRepositories(userId);
    const entities: Array<{ id: string; name: string }> = [];
    let memoryCount = 0;

    const entityIds = options.scope === 'all' ? [] : (options.selectedIds ?? []);

    switch (options.type) {
      case 'characters': {
        const allCharacters = options.scope === 'all'
          ? await repos.characters.findAll()
          : [];
        const ids = options.scope === 'all'
          ? allCharacters.map(c => c.id)
          : entityIds;

        for (const id of ids) {
          const char = await repos.characters.findById(id);
          if (char) {
            entities.push({ id: char.id, name: char.name });
            if (options.includeMemories) {
              const memories = await collectCharacterMemories(repos, id);
              memoryCount += memories.length;
            }
          }
        }
        break;
      }

      case 'chats': {
        const allChats = options.scope === 'all'
          ? await repos.chats.findAll()
          : [];
        const ids = options.scope === 'all'
          ? allChats.map(c => c.id)
          : entityIds;

        for (const id of ids) {
          const chat = await repos.chats.findById(id);
          if (chat) {
            entities.push({ id: chat.id, name: chat.title });
            if (options.includeMemories) {
              const memories = await collectChatMemories(repos, id);
              memoryCount += memories.length;
            }
          }
        }
        break;
      }

      case 'roleplay-templates': {
        const globalRepos = getRepositories();
        const allTemplates = options.scope === 'all'
          ? await globalRepos.roleplayTemplates.findAll()
          : [];
        const ids = options.scope === 'all'
          ? allTemplates
              .filter(t => !t.isBuiltIn && t.userId === userId)
              .map(t => t.id)
          : entityIds;

        for (const id of ids) {
          const template = await globalRepos.roleplayTemplates.findById(id);
          if (template && !template.isBuiltIn && template.userId === userId) {
            entities.push({ id: template.id, name: template.name });
          }
        }
        break;
      }

      case 'connection-profiles': {
        const allProfiles = options.scope === 'all'
          ? await repos.connections.findAll()
          : [];
        const ids = options.scope === 'all'
          ? allProfiles.map(p => p.id)
          : entityIds;

        for (const id of ids) {
          const profile = await repos.connections.findById(id);
          if (profile) {
            entities.push({ id: profile.id, name: profile.name });
          }
        }
        break;
      }

      case 'image-profiles': {
        const allProfiles = options.scope === 'all'
          ? await repos.imageProfiles.findAll()
          : [];
        const ids = options.scope === 'all'
          ? allProfiles.map(p => p.id)
          : entityIds;

        for (const id of ids) {
          const profile = await repos.imageProfiles.findById(id);
          if (profile) {
            entities.push({ id: profile.id, name: profile.name });
          }
        }
        break;
      }

      case 'embedding-profiles': {
        const allProfiles = options.scope === 'all'
          ? await repos.embeddingProfiles.findAll()
          : [];
        const ids = options.scope === 'all'
          ? allProfiles.map(p => p.id)
          : entityIds;

        for (const id of ids) {
          const profile = await repos.embeddingProfiles.findById(id);
          if (profile) {
            entities.push({ id: profile.id, name: profile.name });
          }
        }
        break;
      }

      case 'tags': {
        const allTags = options.scope === 'all'
          ? await repos.tags.findAll()
          : [];
        const ids = options.scope === 'all'
          ? allTags.map(t => t.id)
          : entityIds;

        for (const id of ids) {
          const tag = await repos.tags.findById(id);
          if (tag) {
            entities.push({ id: tag.id, name: tag.name });
          }
        }
        break;
      }

      case 'projects': {
        const allProjects = options.scope === 'all'
          ? await repos.projects.findAll()
          : [];
        const ids = options.scope === 'all'
          ? allProjects.map(p => p.id)
          : entityIds;

        for (const id of ids) {
          const project = await repos.projects.findById(id);
          if (project) {
            entities.push({ id: project.id, name: project.name });
          }
        }
        break;
      }

      case 'document-stores': {
        const globalReposDS = getRepositories();
        const allStores = options.scope === 'all'
          ? await globalReposDS.docMountPoints.findAll()
          : [];
        const ids = options.scope === 'all'
          ? allStores.map(s => s.id)
          : entityIds;
        for (const id of ids) {
          const store = await globalReposDS.docMountPoints.findById(id);
          if (store) {
            entities.push({ id: store.id, name: store.name });
          }
        }
        break;
      }

      default:
        throw new Error(`Unknown export type: ${options.type}`);
    }
    return {
      type: options.type,
      entities,
      ...(memoryCount > 0 && { memoryCount }),
    };
  } catch (error) {
    logger.error('Error previewing export', { userId, type: options.type }, error as Error);
    throw error;
  }
}
