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
import type {
  Character,
  Persona,
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
import type {
  QuilltapExportManifest,
  QuilltapExport,
  QuilltapExportCounts,
  ConflictStrategy,
  ImportOptions as ExportImportOptions,
  ExportedCharacter,
  ExportedPersona,
  ExportedChat,
  ExportedRoleplayTemplate,
  ExportedProject,
  SanitizedConnectionProfile,
  SanitizedImageProfile,
  SanitizedEmbeddingProfile,
} from '@/lib/export/types';

const moduleLogger = logger.child({ module: 'import:quilltap-import-service' });

/**
 * Combined export data type for easier access
 * Allows accessing any possible property from the union
 */
interface AnyExportData {
  characters?: ExportedCharacter[];
  personas?: ExportedPersona[];
  chats?: ExportedChat[];
  tags?: Tag[];
  connectionProfiles?: SanitizedConnectionProfile[];
  imageProfiles?: SanitizedImageProfile[];
  embeddingProfiles?: SanitizedEmbeddingProfile[];
  roleplayTemplates?: ExportedRoleplayTemplate[];
  projects?: ExportedProject[];
  memories?: Memory[];
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
}

export interface ImportPreview {
  manifest: QuilltapExportManifest;
  entities: {
    characters?: ImportPreviewEntity[];
    personas?: ImportPreviewEntity[];
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
  personas: Map<string, string>;
  chats: Map<string, string>;
  connectionProfiles: Map<string, string>;
  imageProfiles: Map<string, string>;
  embeddingProfiles: Map<string, string>;
  roleplayTemplates: Map<string, string>;
  projects: Map<string, string>;
}

// ============================================================================
// VALIDATION FUNCTIONS
// ============================================================================

/**
 * Parses a JSON string as a QuilltapExport
 */
export function parseExportFile(jsonString: string): QuilltapExport {
  moduleLogger.debug('Parsing export file JSON');

  try {
    const data = JSON.parse(jsonString);
    validateExportFormat(data);
    moduleLogger.debug('Export file parsed successfully', {
      format: data.manifest.format,
      version: data.manifest.version,
    });
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

  moduleLogger.debug('Export format validation passed');
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

  // Preview all entity types
  const [characters, personas, chats, tags, connectionProfiles, imageProfiles, embeddingProfiles, roleplayTemplates, projects] =
    await Promise.all([
      checkExists(
        data.characters,
        (id) => repos.characters.findById(id),
        'characters'
      ),
      checkExists(
        data.personas,
        (id) => repos.personas.findById(id),
        'personas'
      ),
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
      ...(personas.length > 0 && { personas }),
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
    personas: new Map(),
    chats: new Map(),
    connectionProfiles: new Map(),
    imageProfiles: new Map(),
    embeddingProfiles: new Map(),
    roleplayTemplates: new Map(),
    projects: new Map(),
  };

  // Initialize counts
  const imported: QuilltapExportCounts = {
    characters: 0,
    personas: 0,
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
    personas: 0,
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

    // 7. Personas
    if (data.personas && data.personas.length > 0) {
      const counts = await importPersonas(
        userId,
        data.personas,
        options,
        idMaps,
        repos,
        warnings
      );
      imported.personas = counts.imported;
      skipped.personas = counts.skipped;
    }

    // 8. Chats
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

    // 9. Memories (if includeMemories option is enabled)
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
  moduleLogger.debug('Importing tags', { count: tags.length });
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

async function importConnectionProfiles(
  userId: string,
  profiles: ConnectionProfile[],
  options: ImportOptions,
  idMaps: IdMappingState,
  repos: ReturnType<typeof getUserRepositories>
): Promise<ImportCounts> {
  moduleLogger.debug('Importing connection profiles', { count: profiles.length });
  let imported = 0;
  let skipped = 0;

  for (const profile of profiles) {
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
  moduleLogger.debug('Importing image profiles', { count: profiles.length });
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
  moduleLogger.debug('Importing embedding profiles', { count: profiles.length });
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
  moduleLogger.debug('Importing roleplay templates', { count: templates.length });
  let imported = 0;
  let skipped = 0;

  for (const template of templates) {
    try {
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
  moduleLogger.debug('Importing projects', { count: projects.length });
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
          const { id: _, userId: __, createdAt, updatedAt, ...projectData } = project;
          const newProject = await repos.projects.create({
            ...projectData,
            name: `${projectData.name} (imported)`,
          });
          imported++;
          continue;
        }
      }

      const { id: _, userId: __, createdAt, updatedAt, ...projectData } = project;
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

async function importCharacters(
  userId: string,
  characters: Character[],
  options: ImportOptions,
  idMaps: IdMappingState,
  repos: ReturnType<typeof getUserRepositories>,
  warnings: string[]
): Promise<ImportCounts> {
  moduleLogger.debug('Importing characters', { count: characters.length });
  let imported = 0;
  let skipped = 0;

  for (const character of characters) {
    try {
      const existing = await repos.characters.findById(character.id);

      if (existing) {
        if (options.conflictStrategy === 'skip') {
          skipped++;
          idMaps.characters.set(character.id, character.id);
          continue;
        }

        if (options.conflictStrategy === 'overwrite') {
          await repos.characters.delete(character.id);
        }

        if (options.conflictStrategy === 'duplicate') {
          const newId = randomUUID();
          idMaps.characters.set(character.id, newId);
          const { id: _, userId: __, createdAt, updatedAt, ...charData } = character;
          const newCharacter = await repos.characters.create({
            ...charData,
            name: `${charData.name} (imported)`,
          });
          imported++;
          continue;
        }
      }

      const { id: _, userId: __, createdAt, updatedAt, ...charData } = character;
      const newCharacter = await repos.characters.create(charData);
      idMaps.characters.set(character.id, newCharacter.id);
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

async function importPersonas(
  userId: string,
  personas: Persona[],
  options: ImportOptions,
  idMaps: IdMappingState,
  repos: ReturnType<typeof getUserRepositories>,
  warnings: string[]
): Promise<ImportCounts> {
  moduleLogger.debug('Importing personas', { count: personas.length });
  let imported = 0;
  let skipped = 0;

  for (const persona of personas) {
    try {
      const existing = await repos.personas.findById(persona.id);

      if (existing) {
        if (options.conflictStrategy === 'skip') {
          skipped++;
          idMaps.personas.set(persona.id, persona.id);
          continue;
        }

        if (options.conflictStrategy === 'overwrite') {
          await repos.personas.delete(persona.id);
        }

        if (options.conflictStrategy === 'duplicate') {
          const newId = randomUUID();
          idMaps.personas.set(persona.id, newId);
          const { id: _, userId: __, createdAt, updatedAt, ...personaData } = persona;
          const newPersona = await repos.personas.create({
            ...personaData,
            name: `${personaData.name} (imported)`,
          });
          imported++;
          continue;
        }
      }

      const { id: _, userId: __, createdAt, updatedAt, ...personaData } = persona;
      const newPersona = await repos.personas.create(personaData);
      idMaps.personas.set(persona.id, newPersona.id);
      imported++;
    } catch (error) {
      warnings.push(
        `Failed to import persona "${persona.name}": ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      moduleLogger.warn('Failed to import persona', {
        personaId: persona.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { imported, skipped };
}

async function importChats(
  userId: string,
  chats: (ChatMetadata & { messages: MessageEvent[] })[],
  options: ImportOptions,
  idMaps: IdMappingState,
  repos: ReturnType<typeof getUserRepositories>,
  warnings: string[]
): Promise<ImportCounts> {
  moduleLogger.debug('Importing chats', { count: chats.length });
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
  moduleLogger.debug('Importing memories', { count: memories.length });
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

      // Remap persona ID if present (legacy, for backwards compatibility)
      let newPersonaId = memory.personaId;
      if (memory.personaId) {
        newPersonaId = idMaps.personas.get(memory.personaId) || null;
      }

      // Remap aboutCharacterId if present (Characters Not Personas: who the memory is about)
      let newAboutCharacterId = memory.aboutCharacterId;
      if (memory.aboutCharacterId) {
        // Try to map as a character first, then as a persona (for migrated data)
        newAboutCharacterId = idMaps.characters.get(memory.aboutCharacterId) ||
                              idMaps.personas.get(memory.aboutCharacterId) || null;
      }

      // Remap chat ID if present
      let newChatId = memory.chatId;
      if (memory.chatId) {
        newChatId = idMaps.chats.get(memory.chatId) || null;
      }

      const { id: _, createdAt, updatedAt, ...memoryData } = memory;
      await repos.memories.create({
        ...memoryData,
        characterId: newCharacterId,
        personaId: newPersonaId,
        aboutCharacterId: newAboutCharacterId,
        chatId: newChatId,
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

      // Remap personaLinks
      if (character.personaLinks && character.personaLinks.length > 0) {
        updates.personaLinks = character.personaLinks
          .map((link) => {
            const newPersonaId = remapId(link.personaId, idMaps.personas);
            if (newPersonaId) {
              return { ...link, personaId: newPersonaId };
            }
            return null;
          })
          .filter((link) => link !== null) as { personaId: string; isDefault: boolean }[];
        hasUpdates = true;
      }

      if (hasUpdates) {
        await repos.characters.update(newId, updates);
        moduleLogger.debug('Reconciled character relationships', {
          characterId: newId,
        });
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

  // Reconcile personas
  for (const [backupId, newId] of idMaps.personas) {
    try {
      const persona = await repos.personas.findById(newId);
      if (!persona) continue;

      const updates: Partial<Persona> = {};
      let hasUpdates = false;

      // Remap tags
      if (persona.tags && persona.tags.length > 0) {
        const remappedTags = remapIdArray(persona.tags, idMaps.tags);
        if (remappedTags.length > 0) {
          updates.tags = remappedTags;
          hasUpdates = true;
        }
      }

      // Remap characterLinks
      if (persona.characterLinks && persona.characterLinks.length > 0) {
        const remappedCharLinks = remapIdArray(persona.characterLinks, idMaps.characters);
        if (remappedCharLinks.length > 0) {
          updates.characterLinks = remappedCharLinks;
          hasUpdates = true;
        }
      }

      if (hasUpdates) {
        await repos.personas.update(newId, updates);
        moduleLogger.debug('Reconciled persona relationships', {
          personaId: newId,
        });
      }
    } catch (error) {
      warnings.push(
        `Failed to reconcile persona relationships: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      moduleLogger.warn('Failed to reconcile persona', {
        personaId: newId,
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

            if (participant.personaId) {
              const newPersonaId = remapId(participant.personaId, idMaps.personas);
              if (newPersonaId) remapped.personaId = newPersonaId;
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
        moduleLogger.debug('Reconciled chat relationships', { chatId: newId });
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
        moduleLogger.debug('Reconciled project relationships', { projectId: newId });
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

  moduleLogger.info('Post-import reconciliation completed');
}
