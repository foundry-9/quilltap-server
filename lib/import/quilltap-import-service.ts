/**
 * Quilltap Import Service
 *
 * Handles importing of Quilltap export format JSON files with conflict resolution.
 * Supports three conflict strategies: skip, overwrite, and duplicate.
 */

import { randomUUID } from 'crypto';
import { logger } from '@/lib/logger';
import { getUserRepositories } from '@/lib/repositories/factory';
import { getRepositories } from '@/lib/repositories/factory';
import { ensureCharacterVault } from '@/lib/mount-index/character-vault';
import type {
  Character,
  ChatMetadata,
  Tag,
  ConnectionProfile,
  ImageProfile,
  EmbeddingProfile,
  Memory,
  RoleplayTemplate,
  MessageEvent,
  ChatParticipantBase,
  Project,
} from '@/lib/schemas/types';
import type { WardrobeItem } from '@/lib/schemas/wardrobe.types';
import type {
  QuilltapExportManifest,
  QuilltapExport,
  QuilltapExportCounts,
  ConflictStrategy,
  ImportOptions as ExportImportOptions,
  ExportedCharacter,
  ExportedChat,
  ExportedRoleplayTemplate,
  ExportedProject,
  SanitizedConnectionProfile,
  SanitizedImageProfile,
  SanitizedEmbeddingProfile,
  ExportedDocumentStore,
  ExportedDocumentStoreDocument,
  ExportedDocumentStoreBlob,
  ExportedProjectDocMountLink,
} from '@/lib/export/types';

const moduleLogger = logger.child({ module: 'import:quilltap-import-service' });

/**
 * Combined export data type for easier access
 * Allows accessing any possible property from the union
 */
interface AnyExportData {
  characters?: ExportedCharacter[];
  chats?: ExportedChat[];
  tags?: Tag[];
  connectionProfiles?: SanitizedConnectionProfile[];
  imageProfiles?: SanitizedImageProfile[];
  embeddingProfiles?: SanitizedEmbeddingProfile[];
  roleplayTemplates?: ExportedRoleplayTemplate[];
  projects?: ExportedProject[];
  memories?: Memory[];
  // Document store export payload (Scriptorium)
  mountPoints?: ExportedDocumentStore[];
  folders?: any[];
  documents?: ExportedDocumentStoreDocument[];
  blobs?: ExportedDocumentStoreBlob[];
  projectLinks?: ExportedProjectDocMountLink[];
}

/**
 * Helper to get export data as the combined type for easier access
 */
function getExportData(exportData: QuilltapExport): AnyExportData {
  return exportData.data as AnyExportData;
}

// Re-export types for convenience
export type { ConflictStrategy } from '@/lib/export/types';
export type {
  QuilltapExportManifest,
  QuilltapExport,
  QuilltapExportCounts,
} from '@/lib/export/types';

export interface ImportPreviewEntity {
  id: string;
  name: string;
  exists: boolean;
  /** When a cross-instance name match is found, this holds the existing entity's ID */
  matchedExistingId?: string;
}

export interface ImportPreview {
  manifest: QuilltapExportManifest;
  entities: {
    characters?: ImportPreviewEntity[];
    chats?: ImportPreviewEntity[];
    roleplayTemplates?: ImportPreviewEntity[];
    connectionProfiles?: ImportPreviewEntity[];
    imageProfiles?: ImportPreviewEntity[];
    embeddingProfiles?: ImportPreviewEntity[];
    tags?: ImportPreviewEntity[];
    projects?: ImportPreviewEntity[];
    memories?: { count: number };
  };
  conflictCounts: Record<string, number>;
}

export interface ImportOptions extends ExportImportOptions {
  /** Which entity IDs to import (empty = import all) */
  selectedIds?: Record<string, string[]>;
}

export interface ImportResult {
  success: boolean;
  imported: QuilltapExportCounts;
  skipped: QuilltapExportCounts;
  warnings: string[];
}

interface IdMappingState {
  tags: Map<string, string>;
  characters: Map<string, string>;
  chats: Map<string, string>;
  connectionProfiles: Map<string, string>;
  imageProfiles: Map<string, string>;
  embeddingProfiles: Map<string, string>;
  roleplayTemplates: Map<string, string>;
  projects: Map<string, string>;
  mountPoints: Map<string, string>;
}

// ============================================================================
// VALIDATION FUNCTIONS
// ============================================================================

/**
 * Parses a JSON string as a QuilltapExport
 */
export function parseExportFile(jsonString: string): QuilltapExport {
  try {
    const data = JSON.parse(jsonString);
    validateExportFormat(data);
    return data;
  } catch (error) {
    moduleLogger.error('Failed to parse export file', {
      error: error instanceof Error ? error.message : String(error),
    });
    throw new Error(
      `Invalid export file: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Validates that data conforms to QuilltapExport schema
 */
export function validateExportFormat(data: unknown): asserts data is QuilltapExport {
  if (!data || typeof data !== 'object') {
    throw new Error('Export data must be a JSON object');
  }

  const obj = data as Record<string, unknown>;

  // Validate manifest exists
  if (!obj.manifest || typeof obj.manifest !== 'object') {
    throw new Error('Missing or invalid manifest');
  }

  const manifest = obj.manifest as Record<string, unknown>;

  // Validate manifest format
  if (manifest.format !== 'quilltap-export') {
    throw new Error(
      `Invalid format: expected 'quilltap-export', got '${manifest.format}'`
    );
  }

  // Validate version
  if (manifest.version !== '1.0') {
    throw new Error(
      `Unsupported version: ${manifest.version}. Only 1.0 is supported.`
    );
  }

  // Validate data exists
  if (!obj.data || typeof obj.data !== 'object') {
    throw new Error('Missing or invalid data section');
  }
}

// ============================================================================
// PREVIEW FUNCTION
// ============================================================================

/**
 * Previews what will be imported without actually importing
 */
export async function previewImport(
  userId: string,
  exportData: QuilltapExport
): Promise<ImportPreview> {
  moduleLogger.info('Starting import preview', { userId });

  const repos = getUserRepositories(userId);
  const conflictCounts: Record<string, number> = {};

  // Helper to check existence
  const checkExists = async <T extends { id: string }>(
    items: T[] | undefined,
    finder: (id: string) => Promise<T | null>,
    entityType: string
  ): Promise<ImportPreviewEntity[]> => {
    if (!items) return [];

    const results: ImportPreviewEntity[] = [];
    let conflicts = 0;

    for (const item of items) {
      const existing = await finder(item.id);
      const exists = !!existing;
      if (exists) conflicts++;

      results.push({
        id: item.id,
        name: ('name' in item ? item.name : 'title' in item ? (item as any).title : 'Unknown') as string,
        exists,
      });
    }

    if (conflicts > 0) {
      conflictCounts[entityType] = conflicts;
    }

    return results;
  };

  const data = getExportData(exportData);

  // Check characters with name-based fallback for cross-instance imports
  const checkCharacterExists = async (
    items: ExportedCharacter[] | undefined
  ): Promise<ImportPreviewEntity[]> => {
    if (!items) return [];

    const results: ImportPreviewEntity[] = [];
    let conflicts = 0;

    // Pre-fetch all existing characters for name matching
    const existingCharacters = await repos.characters.findAll();
    const existingByName = new Map<string, Character>();
    for (const char of existingCharacters) {
      existingByName.set(char.name.toLowerCase(), char);
    }

    for (const item of items) {
      // First check by ID (same instance re-import)
      const existingById = await repos.characters.findById(item.id);
      if (existingById) {
        conflicts++;
        results.push({ id: item.id, name: item.name, exists: true });
        continue;
      }

      // Fallback: check by name (cross-instance import)
      const existingByNameMatch = existingByName.get(item.name.toLowerCase());
      if (existingByNameMatch) {
        conflicts++;
        results.push({
          id: item.id,
          name: item.name,
          exists: true,
          matchedExistingId: existingByNameMatch.id,
        });
        continue;
      }

      results.push({ id: item.id, name: item.name, exists: false });
    }

    if (conflicts > 0) {
      conflictCounts.characters = conflicts;
    }

    return results;
  };

  // Preview all entity types
  const [characters, chats, tags, connectionProfiles, imageProfiles, embeddingProfiles, roleplayTemplates, projects] =
    await Promise.all([
      checkCharacterExists(data.characters),
      checkExists(
        data.chats,
        (id) => repos.chats.findById(id),
        'chats'
      ),
      checkExists(
        data.tags,
        (id) => repos.tags.findById(id),
        'tags'
      ),
      checkExists(
        data.connectionProfiles,
        (id) => repos.connections.findById(id),
        'connectionProfiles'
      ),
      checkExists(
        data.imageProfiles,
        (id) => repos.imageProfiles.findById(id),
        'imageProfiles'
      ),
      checkExists(
        data.embeddingProfiles,
        (id) => repos.embeddingProfiles.findById(id),
        'embeddingProfiles'
      ),
      checkExists(
        data.roleplayTemplates,
        (id) => {
          const globalRepos = getRepositories();
          return globalRepos.roleplayTemplates.findById(id);
        },
        'roleplayTemplates'
      ),
      checkExists(
        data.projects,
        (id) => repos.projects.findById(id),
        'projects'
      ),
    ]);

  const preview: ImportPreview = {
    manifest: exportData.manifest,
    entities: {
      ...(characters.length > 0 && { characters }),
      ...(chats.length > 0 && { chats }),
      ...(tags.length > 0 && { tags }),
      ...(connectionProfiles.length > 0 && { connectionProfiles }),
      ...(imageProfiles.length > 0 && { imageProfiles }),
      ...(embeddingProfiles.length > 0 && { embeddingProfiles }),
      ...(roleplayTemplates.length > 0 && { roleplayTemplates }),
      ...(projects.length > 0 && { projects }),
      ...(data.memories && {
        memories: { count: data.memories.length },
      }),
    },
    conflictCounts,
  };

  moduleLogger.info('Import preview completed', {
    userId,
    conflicts: Object.keys(conflictCounts).length,
  });

  return preview;
}

// ============================================================================
// IMPORT EXECUTION
// ============================================================================

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

// ============================================================================
// ENTITY-SPECIFIC IMPORT FUNCTIONS
// ============================================================================

interface ImportCounts {
  imported: number;
  skipped: number;
  messages?: number;
}

async function importTags(
  userId: string,
  tags: Tag[],
  options: ImportOptions,
  idMaps: IdMappingState,
  repos: ReturnType<typeof getUserRepositories>
): Promise<ImportCounts> {
  let imported = 0;
  let skipped = 0;

  for (const tag of tags) {
    try {
      const existing = await repos.tags.findById(tag.id);

      if (existing) {
        if (options.conflictStrategy === 'skip') {
          skipped++;
          idMaps.tags.set(tag.id, tag.id);
          continue;
        }

        if (options.conflictStrategy === 'overwrite') {
          await repos.tags.delete(tag.id);
        }

        if (options.conflictStrategy === 'duplicate') {
          const { id: _, userId: __, createdAt, updatedAt, ...tagData } = tag;
          const newTag = await repos.tags.create({
            ...tagData,
            name: `${tagData.name} (imported)`,
            nameLower: `${tagData.nameLower || tagData.name.toLowerCase()} (imported)`,
          });
          idMaps.tags.set(tag.id, newTag.id);
          imported++;
          continue;
        }
      }

      const { id: _, userId: __, createdAt, updatedAt, ...tagData } = tag;
      const newTag = await repos.tags.create(tagData);
      idMaps.tags.set(tag.id, newTag.id);
      imported++;
    } catch (error) {
      moduleLogger.warn('Failed to import tag', {
        tagId: tag.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { imported, skipped };
}

const LEGACY_IMAGE_CAPABLE_PROVIDERS = new Set(['OPENAI', 'ANTHROPIC', 'GOOGLE', 'GROK']);

async function importConnectionProfiles(
  userId: string,
  profiles: ConnectionProfile[],
  options: ImportOptions,
  idMaps: IdMappingState,
  repos: ReturnType<typeof getUserRepositories>
): Promise<ImportCounts> {
  let imported = 0;
  let skipped = 0;

  for (const rawProfile of profiles) {
    // Older exports predate the per-profile supportsImageUpload flag; seed it
    // from the historic provider capability map so image support round-trips.
    const profile: ConnectionProfile =
      (rawProfile as Partial<ConnectionProfile>).supportsImageUpload === undefined
        ? { ...rawProfile, supportsImageUpload: LEGACY_IMAGE_CAPABLE_PROVIDERS.has(rawProfile.provider) }
        : rawProfile;

    try {
      const existing = await repos.connections.findById(profile.id);

      if (existing) {
        if (options.conflictStrategy === 'skip') {
          skipped++;
          idMaps.connectionProfiles.set(profile.id, profile.id);
          continue;
        }

        if (options.conflictStrategy === 'overwrite') {
          await repos.connections.delete(profile.id);
        }

        if (options.conflictStrategy === 'duplicate') {
          const newId = randomUUID();
          idMaps.connectionProfiles.set(profile.id, newId);
          const { id: _, userId: __, createdAt, updatedAt, ...profileData } = profile;
          const newProfile = await repos.connections.create({
            ...profileData,
            apiKeyId: null, // Don't restore API keys
            name: `${profileData.name} (imported)`,
          });
          imported++;
          continue;
        }
      }

      const { id: _, userId: __, createdAt, updatedAt, ...profileData } = profile;
      const newProfile = await repos.connections.create({
        ...profileData,
        apiKeyId: null, // Don't restore API keys
      });
      idMaps.connectionProfiles.set(profile.id, newProfile.id);
      imported++;
    } catch (error) {
      moduleLogger.warn('Failed to import connection profile', {
        profileId: profile.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { imported, skipped };
}

async function importImageProfiles(
  userId: string,
  profiles: ImageProfile[],
  options: ImportOptions,
  idMaps: IdMappingState,
  repos: ReturnType<typeof getUserRepositories>
): Promise<ImportCounts> {
  let imported = 0;
  let skipped = 0;

  for (const profile of profiles) {
    try {
      const existing = await repos.imageProfiles.findById(profile.id);

      if (existing) {
        if (options.conflictStrategy === 'skip') {
          skipped++;
          idMaps.imageProfiles.set(profile.id, profile.id);
          continue;
        }

        if (options.conflictStrategy === 'overwrite') {
          await repos.imageProfiles.delete(profile.id);
        }

        if (options.conflictStrategy === 'duplicate') {
          const newId = randomUUID();
          idMaps.imageProfiles.set(profile.id, newId);
          const { id: _, userId: __, createdAt, updatedAt, ...profileData } = profile;
          const newProfile = await repos.imageProfiles.create({
            ...profileData,
            apiKeyId: null, // Don't restore API keys
            name: `${profileData.name} (imported)`,
          });
          imported++;
          continue;
        }
      }

      const { id: _, userId: __, createdAt, updatedAt, ...profileData } = profile;
      const newProfile = await repos.imageProfiles.create({
        ...profileData,
        apiKeyId: null, // Don't restore API keys
      });
      idMaps.imageProfiles.set(profile.id, newProfile.id);
      imported++;
    } catch (error) {
      moduleLogger.warn('Failed to import image profile', {
        profileId: profile.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { imported, skipped };
}

async function importEmbeddingProfiles(
  userId: string,
  profiles: EmbeddingProfile[],
  options: ImportOptions,
  idMaps: IdMappingState,
  repos: ReturnType<typeof getUserRepositories>
): Promise<ImportCounts> {
  let imported = 0;
  let skipped = 0;

  for (const profile of profiles) {
    try {
      const existing = await repos.embeddingProfiles.findById(profile.id);

      if (existing) {
        if (options.conflictStrategy === 'skip') {
          skipped++;
          idMaps.embeddingProfiles.set(profile.id, profile.id);
          continue;
        }

        if (options.conflictStrategy === 'overwrite') {
          await repos.embeddingProfiles.delete(profile.id);
        }

        if (options.conflictStrategy === 'duplicate') {
          const newId = randomUUID();
          idMaps.embeddingProfiles.set(profile.id, newId);
          const { id: _, userId: __, createdAt, updatedAt, ...profileData } = profile;
          const newProfile = await repos.embeddingProfiles.create({
            ...profileData,
            apiKeyId: null, // Don't restore API keys
            name: `${profileData.name} (imported)`,
          });
          imported++;
          continue;
        }
      }

      const { id: _, userId: __, createdAt, updatedAt, ...profileData } = profile;
      const newProfile = await repos.embeddingProfiles.create({
        ...profileData,
        apiKeyId: null, // Don't restore API keys
      });
      idMaps.embeddingProfiles.set(profile.id, newProfile.id);
      imported++;
    } catch (error) {
      moduleLogger.warn('Failed to import embedding profile', {
        profileId: profile.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { imported, skipped };
}

async function importRoleplayTemplates(
  userId: string,
  templates: RoleplayTemplate[],
  options: ImportOptions,
  idMaps: IdMappingState,
  globalRepos: ReturnType<typeof getRepositories>
): Promise<ImportCounts> {
  let imported = 0;
  let skipped = 0;

  for (const template of templates) {
    try {
      // Backward compatibility: convert old annotationButtons to delimiters format
      const templateAny = template as Record<string, unknown>;
      if (templateAny.annotationButtons && !template.delimiters?.length) {
        const oldButtons = templateAny.annotationButtons as Array<{ label?: string; abbrev?: string; prefix?: string; suffix?: string }>;
        const styleMap: Record<string, string> = {
          'Narration': 'qt-chat-narration', 'Nar': 'qt-chat-narration',
          'Internal Monologue': 'qt-chat-inner-monologue', 'Int': 'qt-chat-inner-monologue',
          'Out of Character': 'qt-chat-ooc', 'OOC': 'qt-chat-ooc',
        };
        template.delimiters = oldButtons.map(btn => ({
          name: btn.label || btn.abbrev || 'Unknown',
          buttonName: btn.abbrev || btn.label || '?',
          delimiters: (btn.prefix === btn.suffix) ? (btn.prefix || '') : [btn.prefix || '', btn.suffix || ''] as [string, string],
          style: styleMap[btn.label || ''] || styleMap[btn.abbrev || ''] || 'qt-chat-narration',
        }));
        delete templateAny.annotationButtons;
      }
      // Remove legacy pluginName field if present
      delete templateAny.pluginName;

      const existing = await globalRepos.roleplayTemplates.findById(template.id);

      if (existing) {
        if (options.conflictStrategy === 'skip') {
          skipped++;
          idMaps.roleplayTemplates.set(template.id, template.id);
          continue;
        }

        if (options.conflictStrategy === 'overwrite') {
          await globalRepos.roleplayTemplates.delete(template.id);
        }

        if (options.conflictStrategy === 'duplicate') {
          const newId = randomUUID();
          idMaps.roleplayTemplates.set(template.id, newId);
          const { id: _, createdAt, updatedAt, ...templateData } = template;
          const newTemplate = await globalRepos.roleplayTemplates.create({
            ...templateData,
            userId,
            name: `${templateData.name} (imported)`,
          });
          imported++;
          continue;
        }
      }

      const { id: _, createdAt, updatedAt, ...templateData } = template;
      const newTemplate = await globalRepos.roleplayTemplates.create({
        ...templateData,
        userId,
      });
      idMaps.roleplayTemplates.set(template.id, newTemplate.id);
      imported++;
    } catch (error) {
      moduleLogger.warn('Failed to import roleplay template', {
        templateId: template.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { imported, skipped };
}

async function importProjects(
  userId: string,
  projects: Project[],
  options: ImportOptions,
  idMaps: IdMappingState,
  repos: ReturnType<typeof getUserRepositories>,
  warnings: string[]
): Promise<ImportCounts> {
  let imported = 0;
  let skipped = 0;

  for (const project of projects) {
    try {
      const existing = await repos.projects.findById(project.id);

      if (existing) {
        if (options.conflictStrategy === 'skip') {
          skipped++;
          idMaps.projects.set(project.id, project.id);
          continue;
        }

        if (options.conflictStrategy === 'overwrite') {
          await repos.projects.delete(project.id);
        }

        if (options.conflictStrategy === 'duplicate') {
          const newId = randomUUID();
          idMaps.projects.set(project.id, newId);
          const { id: _, userId: __, createdAt, updatedAt, officialMountPointId: ___, ...projectData } = project;
          const newProject = await repos.projects.create({
            ...projectData,
            name: `${projectData.name} (imported)`,
          });
          imported++;
          continue;
        }
      }

      const { id: _, userId: __, createdAt, updatedAt, officialMountPointId: ___, ...projectData } = project;
      const newProject = await repos.projects.create(projectData);
      idMaps.projects.set(project.id, newProject.id);
      imported++;
    } catch (error) {
      warnings.push(
        `Failed to import project "${project.name}": ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      moduleLogger.warn('Failed to import project', {
        projectId: project.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { imported, skipped };
}

/**
 * Convert a legacy character with a `scenario` string field to the new `scenarios` array format.
 * Used when importing old .qtap files that predate the scenarios schema change.
 */
function migrateCharacterScenarios(character: any): any {
  // If already has scenarios array, nothing to do
  if (character.scenarios !== undefined) {
    return character;
  }
  // If has old scenario string, convert to scenarios array
  if (typeof character.scenario === 'string' && character.scenario) {
    const now = new Date().toISOString();
    return {
      ...character,
      scenarios: [{
        id: randomUUID(),
        title: 'Default',
        content: character.scenario,
        createdAt: now,
        updatedAt: now,
      }],
    };
  }
  // No scenario field at all — return with empty scenarios array
  return {
    ...character,
    scenarios: [],
  };
}

/**
 * Provision a character vault for a newly imported character. Awaited so the
 * import's reported success state matches reality (vault-aware features like
 * the Scriptorium can see the character immediately). Failures are recorded
 * as warnings rather than aborting the import — the startup backfill will
 * retry, since `ensureCharacterVault` is idempotent.
 */
async function provisionImportedCharacterVault(
  character: Character,
  warnings: string[]
): Promise<void> {
  try {
    await ensureCharacterVault(character);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    warnings.push(
      `Failed to provision character vault for "${character.name}": ${message}`
    );
    moduleLogger.warn('Failed to provision vault during import', {
      characterId: character.id,
      error: message,
    });
  }
}

async function importCharacters(
  userId: string,
  characters: Character[],
  options: ImportOptions,
  idMaps: IdMappingState,
  repos: ReturnType<typeof getUserRepositories>,
  warnings: string[]
): Promise<ImportCounts> {
  let imported = 0;
  let skipped = 0;

  // Pre-fetch existing characters for name-based matching (cross-instance imports)
  const existingCharacters = await repos.characters.findAll();
  const existingByName = new Map<string, Character>();
  for (const char of existingCharacters) {
    existingByName.set(char.name.toLowerCase(), char);
  }

  for (const rawCharacter of characters) {
    const character = migrateCharacterScenarios(rawCharacter);
    try {
      // Check by ID first (same-instance re-import), then by name (cross-instance)
      let existing = await repos.characters.findById(character.id);
      let nameMatched = false;

      if (!existing) {
        const nameMatch = existingByName.get(character.name.toLowerCase());
        if (nameMatch) {
          existing = nameMatch;
          nameMatched = true;
          moduleLogger.debug('Character matched by name for cross-instance import', {
            importedId: character.id,
            existingId: nameMatch.id,
            name: character.name,
          });
        }
      }

      if (existing) {
        if (options.conflictStrategy === 'skip') {
          skipped++;
          idMaps.characters.set(character.id, existing.id);
          continue;
        }

        if (options.conflictStrategy === 'overwrite') {
          // Map old import ID to the existing ID before deleting, so related
          // entities (chats, memories) get re-linked to the replacement
          idMaps.characters.set(character.id, existing.id);
          await repos.characters.delete(existing.id);
          // Remove from name map so we don't re-match
          existingByName.delete(character.name.toLowerCase());
        }

        if (options.conflictStrategy === 'duplicate') {
          const { id: _, userId: __, createdAt, updatedAt, ...charData } = character;
          const newCharacter = await repos.characters.create({
            ...charData,
            name: `${charData.name} (imported)`,
          });
          idMaps.characters.set(character.id, newCharacter.id);

          // Import wardrobe items for duplicated character
          await importCharacterWardrobeItems(
            (rawCharacter as ExportedCharacter).wardrobeItems,
            newCharacter.id,
            warnings
          );

          // Import plugin data for duplicated character
          await importCharacterPluginData(
            (rawCharacter as ExportedCharacter).pluginData,
            newCharacter.id,
            warnings
          );

          await provisionImportedCharacterVault(newCharacter, warnings);

          imported++;
          continue;
        }
      }

      const { id: _, userId: __, createdAt, updatedAt, ...charData } = character;
      const newCharacter = await repos.characters.create(charData);
      idMaps.characters.set(character.id, newCharacter.id);

      // Import wardrobe items for this character
      await importCharacterWardrobeItems(
        (rawCharacter as ExportedCharacter).wardrobeItems,
        newCharacter.id,
        warnings
      );

      // Import plugin data for this character
      await importCharacterPluginData(
        (rawCharacter as ExportedCharacter).pluginData,
        newCharacter.id,
        warnings
      );

      await provisionImportedCharacterVault(newCharacter, warnings);

      imported++;
    } catch (error) {
      warnings.push(
        `Failed to import character "${character.name}": ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      moduleLogger.warn('Failed to import character', {
        characterId: character.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { imported, skipped };
}

/**
 * Import wardrobe items for a character, assigning them to the new character ID.
 * Skips archetype items (characterId = null) since those are shared and not per-character.
 */
async function importCharacterWardrobeItems(
  wardrobeItems: WardrobeItem[] | undefined,
  newCharacterId: string,
  warnings: string[]
): Promise<number> {
  if (!wardrobeItems || wardrobeItems.length === 0) return 0;

  const globalRepos = getRepositories();
  let importedCount = 0;

  for (const item of wardrobeItems) {
    // Skip archetype items (characterId = null) — they are shared, not per-character
    if (!item.characterId) {
      moduleLogger.debug('Skipping archetype wardrobe item during import', {
        wardrobeItemId: item.id,
        title: item.title,
      });
      continue;
    }

    try {
      const { id: _, characterId: __, createdAt, updatedAt, migratedFromClothingRecordId, ...itemData } = item;
      await globalRepos.wardrobe.create({
        ...itemData,
        characterId: newCharacterId,
        migratedFromClothingRecordId: null,
      });
      importedCount++;

      moduleLogger.debug('Imported wardrobe item for character', {
        originalId: item.id,
        newCharacterId,
        title: item.title,
      });
    } catch (error) {
      warnings.push(
        `Failed to import wardrobe item "${item.title}": ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      moduleLogger.warn('Failed to import wardrobe item', {
        wardrobeItemId: item.id,
        characterId: newCharacterId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return importedCount;
}

/**
 * Import plugin data for a character, assigning entries to the new character ID.
 */
async function importCharacterPluginData(
  pluginData: Record<string, unknown> | undefined,
  newCharacterId: string,
  warnings: string[]
): Promise<number> {
  if (!pluginData || Object.keys(pluginData).length === 0) return 0;

  const globalRepos = getRepositories();
  let importedCount = 0;

  for (const [pluginName, data] of Object.entries(pluginData)) {
    try {
      await globalRepos.characterPluginData.upsert(newCharacterId, pluginName, data);
      importedCount++;

      moduleLogger.debug('Imported plugin data for character', {
        pluginName,
        newCharacterId,
      });
    } catch (error) {
      warnings.push(
        `Failed to import plugin data for "${pluginName}": ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      moduleLogger.warn('Failed to import plugin data', {
        pluginName,
        characterId: newCharacterId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return importedCount;
}

async function importChats(
  userId: string,
  chats: (ChatMetadata & { messages: MessageEvent[] })[],
  options: ImportOptions,
  idMaps: IdMappingState,
  repos: ReturnType<typeof getUserRepositories>,
  warnings: string[]
): Promise<ImportCounts> {
  let imported = 0;
  let skipped = 0;
  let messages = 0;

  for (const chat of chats) {
    try {
      const existing = await repos.chats.findById(chat.id);

      if (existing) {
        if (options.conflictStrategy === 'skip') {
          skipped++;
          idMaps.chats.set(chat.id, chat.id);
          continue;
        }

        if (options.conflictStrategy === 'overwrite') {
          await repos.chats.delete(chat.id);
        }

        if (options.conflictStrategy === 'duplicate') {
          const newId = randomUUID();
          idMaps.chats.set(chat.id, newId);
          const { id: _, userId: __, messages: _msgs, createdAt, updatedAt, ...chatData } = chat;
          const newChat = await repos.chats.create({
            ...chatData,
            title: `${chatData.title} (imported)`,
          });

          // Add messages
          for (const message of chat.messages) {
            try {
              await repos.chats.addMessage(newChat.id, message);
              messages++;
            } catch (msgError) {
              warnings.push(
                `Failed to import message in chat "${chat.title}": ${
                  msgError instanceof Error ? msgError.message : String(msgError)
                }`
              );
            }
          }

          imported++;
          continue;
        }
      }

      const { id: _, userId: __, messages: _msgs, createdAt, updatedAt, ...chatData } = chat;
      const newChat = await repos.chats.create(chatData);
      idMaps.chats.set(chat.id, newChat.id);

      // Add messages
      for (const message of chat.messages) {
        try {
          await repos.chats.addMessage(newChat.id, message);
          messages++;
        } catch (msgError) {
          warnings.push(
            `Failed to import message in chat "${chat.title}": ${
              msgError instanceof Error ? msgError.message : String(msgError)
            }`
          );
        }
      }

      imported++;
    } catch (error) {
      warnings.push(
        `Failed to import chat "${chat.title}": ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      moduleLogger.warn('Failed to import chat', {
        chatId: chat.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { imported, skipped, messages };
}

async function importMemories(
  userId: string,
  memories: Memory[],
  idMaps: IdMappingState,
  repos: ReturnType<typeof getUserRepositories>,
  warnings: string[]
): Promise<ImportCounts> {
  let imported = 0;
  let skipped = 0;

  for (const memory of memories) {
    try {
      // Remap character ID
      const newCharacterId = idMaps.characters.get(memory.characterId);
      if (!newCharacterId) {
        warnings.push(
          `Memory references non-existent character ${memory.characterId}`
        );
        skipped++;
        continue;
      }

      // Remap aboutCharacterId if present (Characters Not Personas: who the memory is about)
      let newAboutCharacterId = memory.aboutCharacterId;
      if (memory.aboutCharacterId) {
        // Try to map as a character first
        newAboutCharacterId = idMaps.characters.get(memory.aboutCharacterId) || null;
      }

      // Remap chat ID if present
      let newChatId = memory.chatId;
      if (memory.chatId) {
        newChatId = idMaps.chats.get(memory.chatId) || null;
      }

      // Remap project ID if present
      let newProjectId = memory.projectId;
      if (memory.projectId) {
        newProjectId = idMaps.projects.get(memory.projectId) || null;
      }

      // Remap tags if present
      let newTags = memory.tags;
      if (memory.tags && memory.tags.length > 0) {
        newTags = memory.tags
          .map((tagId) => idMaps.tags.get(tagId) || tagId)
          .filter((id) => id !== null) as string[];
      }

      const { id: _, createdAt, updatedAt, ...memoryData } = memory;
      await repos.memories.create({
        ...memoryData,
        characterId: newCharacterId,
        aboutCharacterId: newAboutCharacterId,
        chatId: newChatId,
        projectId: newProjectId,
        tags: newTags,
      });
      imported++;
    } catch (error) {
      warnings.push(
        `Failed to import memory: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      moduleLogger.warn('Failed to import memory', {
        memoryId: memory.id,
        error: error instanceof Error ? error.message : String(error),
      });
      skipped++;
    }
  }

  return { imported, skipped };
}

interface DocumentStoreImportCounts {
  mountPoints: number;
  folders: number;
  documents: number;
  blobs: number;
  projectLinks: number;
}

async function importDocumentStores(
  mountPoints: ExportedDocumentStore[],
  folders: any[],
  documents: ExportedDocumentStoreDocument[],
  blobs: ExportedDocumentStoreBlob[],
  projectLinks: ExportedProjectDocMountLink[],
  options: ImportOptions,
  _userRepos: ReturnType<typeof getUserRepositories>,
  idMaps: IdMappingState,
  warnings: string[]
): Promise<DocumentStoreImportCounts> {
  const counts: DocumentStoreImportCounts = { mountPoints: 0, folders: 0, documents: 0, blobs: 0, projectLinks: 0 };

  // Document stores are instance-scoped, not user-scoped — use the global
  // repository container.
  const globalRepos = getRepositories();

  // Map source mountPointId → target mountPointId so we can rewrite
  // documents/blobs to the mount points we end up creating or reusing.
  // Also promoted onto idMaps.mountPoints for cross-entity reconciliation
  // (e.g. characterDocumentMountPointId).
  const idMap = idMaps.mountPoints;

  const existingStores = await globalRepos.docMountPoints.findAll();
  const byName = new Map(existingStores.map(s => [s.name.toLowerCase(), s]));

  for (const mp of mountPoints) {
    try {
      const existing = byName.get(mp.name.toLowerCase());
      if (existing) {
        if (options.conflictStrategy === 'skip') {
          idMap.set(mp.id, existing.id);
          continue;
        }
        if (options.conflictStrategy === 'overwrite') {
          // Drop existing documents, blobs, files, chunks before replacing.
          await globalRepos.docMountDocuments.deleteByMountPointId(existing.id);
          await globalRepos.docMountBlobs.deleteByMountPointId(existing.id);
          await globalRepos.docMountChunks.deleteByMountPointId(existing.id);
          await globalRepos.docMountFiles.deleteByMountPointId(existing.id);
          await globalRepos.docMountPoints.update(existing.id, {
            name: mp.name,
            basePath: mp.mountType === 'database' ? '' : mp.basePath,
            mountType: mp.mountType,
            storeType: mp.storeType ?? 'documents',
            includePatterns: mp.includePatterns,
            excludePatterns: mp.excludePatterns,
            enabled: mp.enabled,
          });
          idMap.set(mp.id, existing.id);
          counts.mountPoints++;
          continue;
        }
        // 'duplicate' — fall through to create a freshly-named mount point.
      }

      const name = existing && options.conflictStrategy === 'duplicate'
        ? `${mp.name} (imported)`
        : mp.name;
      const created = await globalRepos.docMountPoints.create({
        name,
        basePath: mp.mountType === 'database' ? '' : mp.basePath,
        mountType: mp.mountType,
        storeType: mp.storeType ?? 'documents',
        includePatterns: mp.includePatterns,
        excludePatterns: mp.excludePatterns,
        enabled: mp.enabled,
        lastScannedAt: null,
        scanStatus: 'idle',
        lastScanError: null,
        conversionStatus: 'idle',
        conversionError: null,
        fileCount: 0,
        chunkCount: 0,
        totalSizeBytes: 0,
      });
      idMap.set(mp.id, created.id);
      counts.mountPoints++;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      warnings.push(`Failed to import mount point "${mp.name}": ${msg}`);
      moduleLogger.warn('Failed to import mount point', { name: mp.name, error: msg });
    }
  }

  // Folders — database-backed only; filesystem/obsidian sources don't export folders.
  // Import folders before documents so document folderId FKs resolve correctly.
  for (const folder of folders) {
    const targetMountId = idMap.get(folder.mountPointId);
    if (!targetMountId) continue;
    try {
      // Remap parentId if it exists
      let remappedParentId = folder.parentId;
      if (folder.parentId) {
        // Parent ID remapping: not applicable here since folder IDs are assigned new ones
        // For now, we'll create the folder structure but leave parentId as imported
        // The backfill process will handle this on first access
      }

      await globalRepos.docMountFolders.create({
        mountPointId: targetMountId,
        parentId: remappedParentId,
        name: folder.name,
        path: folder.path,
      });
      counts.folders++;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      warnings.push(`Failed to import folder "${folder.path}": ${msg}`);
    }
  }

  // Documents — database-backed only; filesystem/obsidian sources keep their
  // documents on disk.
  for (const doc of documents) {
    const targetMountId = idMap.get(doc.mountPointId);
    if (!targetMountId) continue;
    try {
      const nowIso = new Date().toISOString();
      await globalRepos.docMountDocuments.create({
        mountPointId: targetMountId,
        relativePath: doc.relativePath,
        fileName: doc.fileName,
        fileType: doc.fileType,
        content: doc.content,
        contentSha256: doc.contentSha256,
        plainTextLength: doc.plainTextLength,
        lastModified: doc.lastModified || nowIso,
        folderId: doc.folderId,
      });
      // Mirror into doc_mount_files so scan/search treat it uniformly.
      await globalRepos.docMountFiles.create({
        mountPointId: targetMountId,
        relativePath: doc.relativePath,
        fileName: doc.fileName,
        fileType: doc.fileType,
        sha256: doc.contentSha256,
        fileSizeBytes: Buffer.byteLength(doc.content, 'utf-8'),
        lastModified: doc.lastModified || nowIso,
        source: 'database',
        conversionStatus: 'converted',
        plainTextLength: doc.plainTextLength,
        chunkCount: 0,
        folderId: doc.folderId,
      });
      counts.documents++;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      warnings.push(`Failed to import document "${doc.relativePath}": ${msg}`);
    }
  }

  // Blobs — universal across mount types.
  for (const blob of blobs) {
    const targetMountId = idMap.get(blob.mountPointId);
    if (!targetMountId) continue;
    try {
      const data = Buffer.from(blob.dataBase64, 'base64');
      const created = await globalRepos.docMountBlobs.create({
        mountPointId: targetMountId,
        relativePath: blob.relativePath,
        originalFileName: blob.originalFileName,
        originalMimeType: blob.originalMimeType,
        storedMimeType: blob.storedMimeType,
        sha256: blob.sha256,
        description: blob.description,
        data,
      });
      // Restore the extractedText sidecar on imports from 4.3-dev+ exports.
      // Older exports omit these fields; keep the blob in the default 'none'
      // state so on-upload extraction has nothing to re-run.
      const hasExtractionMetadata =
        blob.extractedText !== undefined ||
        blob.extractionStatus !== undefined ||
        blob.extractionError !== undefined;
      if (hasExtractionMetadata) {
        await globalRepos.docMountBlobs.updateExtractedText(created.id, {
          extractedText: blob.extractedText ?? null,
          extractedTextSha256: blob.extractedTextSha256 ?? null,
          extractionStatus: blob.extractionStatus ?? 'none',
          extractionError: blob.extractionError ?? null,
        });
      }
      counts.blobs++;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      warnings.push(`Failed to import blob "${blob.relativePath}": ${msg}`);
    }
  }

  // Project ↔ mount-point links — remap both IDs through the respective
  // maps. Projects are imported earlier in the pipeline so idMaps.projects
  // is already populated by the time we get here. Skip any link whose
  // project or mount point didn't survive the import.
  const existingLinks = projectLinks.length > 0
    ? await globalRepos.projectDocMountLinks.findAll()
    : [];
  const existingLinkKeys = new Set(
    existingLinks.map(l => `${l.projectId}::${l.mountPointId}`)
  );
  for (const link of projectLinks) {
    const targetMountId = idMap.get(link.mountPointId);
    const targetProjectId = idMaps.projects.get(link.projectId);
    if (!targetMountId || !targetProjectId) {
      continue;
    }
    const key = `${targetProjectId}::${targetMountId}`;
    if (existingLinkKeys.has(key)) {
      // Already linked after an overwrite/skip on an existing mount point.
      continue;
    }
    try {
      await globalRepos.projectDocMountLinks.create({
        projectId: targetProjectId,
        mountPointId: targetMountId,
      });
      existingLinkKeys.add(key);
      counts.projectLinks++;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      warnings.push(
        `Failed to link project ${targetProjectId} to mount point ${targetMountId}: ${msg}`
      );
    }
  }

  return counts;
}

// ============================================================================
// POST-IMPORT RECONCILIATION
// ============================================================================

/**
 * Updates all entity relationships with correct remapped IDs
 */
async function reconcileRelationships(
  userId: string,
  repos: ReturnType<typeof getUserRepositories>,
  idMaps: IdMappingState,
  warnings: string[]
): Promise<void> {
  moduleLogger.info('Starting post-import reconciliation', { userId });

  const remapId = (id: string | null | undefined, idMap: Map<string, string>): string | null => {
    if (!id) return null;
    return idMap.get(id) || null;
  };

  const remapIdArray = (ids: string[] | undefined, idMap: Map<string, string>): string[] => {
    if (!ids) return [];
    return ids
      .map((id) => idMap.get(id) || id)
      .filter((id) => id !== null) as string[];
  };

  // Reconcile characters
  for (const [backupId, newId] of idMaps.characters) {
    try {
      const character = await repos.characters.findById(newId);
      if (!character) continue;

      const updates: Partial<Character> = {};
      let hasUpdates = false;

      // Remap tags
      if (character.tags && character.tags.length > 0) {
        const remappedTags = remapIdArray(character.tags, idMaps.tags);
        if (remappedTags.length > 0) {
          updates.tags = remappedTags;
          hasUpdates = true;
        }
      }

      // Remap defaultPartnerId (Characters Not Personas: default user-controlled character to pair with)
      if (character.defaultPartnerId) {
        const newPartnerId = remapId(character.defaultPartnerId, idMaps.characters);
        if (newPartnerId) {
          updates.defaultPartnerId = newPartnerId;
          hasUpdates = true;
        }
      }

      // Remap defaultConnectionProfileId
      if (character.defaultConnectionProfileId) {
        const newConnProfileId = remapId(character.defaultConnectionProfileId, idMaps.connectionProfiles);
        if (newConnProfileId) {
          updates.defaultConnectionProfileId = newConnProfileId;
          hasUpdates = true;
        }
      }

      // Remap defaultImageProfileId
      if (character.defaultImageProfileId) {
        const newImgProfileId = remapId(character.defaultImageProfileId, idMaps.imageProfiles);
        if (newImgProfileId) {
          updates.defaultImageProfileId = newImgProfileId;
          hasUpdates = true;
        }
      }

      // Remap defaultRoleplayTemplateId
      if (character.defaultRoleplayTemplateId) {
        const newTemplateId = remapId(character.defaultRoleplayTemplateId, idMaps.roleplayTemplates);
        if (newTemplateId) {
          updates.defaultRoleplayTemplateId = newTemplateId;
          hasUpdates = true;
        }
      }

      // Remap characterDocumentMountPointId
      if (character.characterDocumentMountPointId) {
        const newMountId = remapId(character.characterDocumentMountPointId, idMaps.mountPoints);
        if (newMountId) {
          updates.characterDocumentMountPointId = newMountId;
          hasUpdates = true;
        } else {
          // Referenced mount point was not part of the import — null the link
          // rather than leave a dangling reference.
          updates.characterDocumentMountPointId = null;
          hasUpdates = true;
        }
      }

      if (hasUpdates) {
        await repos.characters.update(newId, updates);
      }
    } catch (error) {
      warnings.push(
        `Failed to reconcile character relationships: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      moduleLogger.warn('Failed to reconcile character', {
        characterId: newId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Reconcile chats
  for (const [backupId, newId] of idMaps.chats) {
    try {
      const chat = await repos.chats.findById(newId);
      if (!chat) continue;

      const updates: Partial<ChatMetadata> = {};
      let hasUpdates = false;

      // Remap participants
      if (chat.participants && chat.participants.length > 0) {
        updates.participants = chat.participants
          .map((participant) => {
            const remapped: ChatParticipantBase = { ...participant };

            if (participant.characterId) {
              const newCharId = remapId(participant.characterId, idMaps.characters);
              if (newCharId) remapped.characterId = newCharId;
            }

            if (participant.connectionProfileId) {
              const newConnId = remapId(
                participant.connectionProfileId,
                idMaps.connectionProfiles
              );
              if (newConnId) remapped.connectionProfileId = newConnId;
            }

            if (participant.imageProfileId) {
              const newImgProfId = remapId(
                participant.imageProfileId,
                idMaps.imageProfiles
              );
              if (newImgProfId) remapped.imageProfileId = newImgProfId;
            }

            // Remap roleplayTemplateId
            if (participant.roleplayTemplateId) {
              const newTemplateId = remapId(
                participant.roleplayTemplateId,
                idMaps.roleplayTemplates
              );
              if (newTemplateId) remapped.roleplayTemplateId = newTemplateId;
            }

            return remapped;
          });
        hasUpdates = true;
      }

      // Remap tags
      if (chat.tags && chat.tags.length > 0) {
        const remappedTags = remapIdArray(chat.tags, idMaps.tags);
        if (remappedTags.length > 0) {
          updates.tags = remappedTags;
          hasUpdates = true;
        }
      }

      // Remap projectId
      if (chat.projectId) {
        const newProjectId = remapId(chat.projectId, idMaps.projects);
        if (newProjectId) {
          updates.projectId = newProjectId;
          hasUpdates = true;
        }
      }

      if (hasUpdates) {
        await repos.chats.update(newId, updates);
      }
    } catch (error) {
      warnings.push(
        `Failed to reconcile chat relationships: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      moduleLogger.warn('Failed to reconcile chat', {
        chatId: newId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Reconcile projects
  for (const [backupId, newId] of idMaps.projects) {
    try {
      const project = await repos.projects.findById(newId);
      if (!project) continue;

      const updates: Partial<Project> = {};
      let hasUpdates = false;

      // Remap characterRoster
      if (project.characterRoster && project.characterRoster.length > 0) {
        const remappedRoster = remapIdArray(project.characterRoster, idMaps.characters);
        if (remappedRoster.length > 0) {
          updates.characterRoster = remappedRoster;
          hasUpdates = true;
        }
      }

      if (hasUpdates) {
        await repos.projects.update(newId, updates);
      }
    } catch (error) {
      warnings.push(
        `Failed to reconcile project relationships: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      moduleLogger.warn('Failed to reconcile project', {
        projectId: newId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Reconcile connection profiles (tags)
  for (const [backupId, newId] of idMaps.connectionProfiles) {
    try {
      const profile = await repos.connections.findById(newId);
      if (!profile) continue;

      if (profile.tags && profile.tags.length > 0) {
        const remappedTags = remapIdArray(profile.tags, idMaps.tags);
        if (remappedTags.length > 0) {
          await repos.connections.update(newId, { tags: remappedTags });
        }
      }
    } catch (error) {
      warnings.push(
        `Failed to reconcile connection profile relationships: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      moduleLogger.warn('Failed to reconcile connection profile', {
        profileId: newId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Reconcile image profiles (tags)
  for (const [backupId, newId] of idMaps.imageProfiles) {
    try {
      const profile = await repos.imageProfiles.findById(newId);
      if (!profile) continue;

      if (profile.tags && profile.tags.length > 0) {
        const remappedTags = remapIdArray(profile.tags, idMaps.tags);
        if (remappedTags.length > 0) {
          await repos.imageProfiles.update(newId, { tags: remappedTags });
        }
      }
    } catch (error) {
      warnings.push(
        `Failed to reconcile image profile relationships: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      moduleLogger.warn('Failed to reconcile image profile', {
        profileId: newId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Reconcile embedding profiles (tags)
  for (const [backupId, newId] of idMaps.embeddingProfiles) {
    try {
      const profile = await repos.embeddingProfiles.findById(newId);
      if (!profile) continue;

      if (profile.tags && profile.tags.length > 0) {
        const remappedTags = remapIdArray(profile.tags, idMaps.tags);
        if (remappedTags.length > 0) {
          await repos.embeddingProfiles.update(newId, { tags: remappedTags });
        }
      }
    } catch (error) {
      warnings.push(
        `Failed to reconcile embedding profile relationships: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      moduleLogger.warn('Failed to reconcile embedding profile', {
        profileId: newId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Reconcile roleplay templates (tags)
  const globalRepos = getRepositories();
  for (const [backupId, newId] of idMaps.roleplayTemplates) {
    try {
      const template = await globalRepos.roleplayTemplates.findById(newId);
      if (!template) continue;

      if (template.tags && template.tags.length > 0) {
        const remappedTags = remapIdArray(template.tags, idMaps.tags);
        if (remappedTags.length > 0) {
          await globalRepos.roleplayTemplates.update(newId, { tags: remappedTags });
        }
      }
    } catch (error) {
      warnings.push(
        `Failed to reconcile roleplay template relationships: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      moduleLogger.warn('Failed to reconcile roleplay template', {
        templateId: newId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  moduleLogger.info('Post-import reconciliation completed');
}
