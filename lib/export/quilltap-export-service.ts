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
  ExportedPersona,
  ExportedChat,
  ExportedRoleplayTemplate,
  ExportedProject,
  SanitizedConnectionProfile,
  SanitizedImageProfile,
  SanitizedEmbeddingProfile,
  CharactersExportData,
  PersonasExportData,
  ChatsExportData,
  RoleplayTemplatesExportData,
  ConnectionProfilesExportData,
  ImageProfilesExportData,
  EmbeddingProfilesExportData,
  TagsExportData,
  ProjectsExportData,
  MemoryCollection,
} from './types';
import type {
  Character,
  Persona,
  ChatMetadata,
  Memory,
  MessageEvent,
  RoleplayTemplate,
} from '@/lib/schemas/types';

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
    logger.debug('Error resolving tag names', { tagIds, error: error instanceof Error ? error.message : String(error) });
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
    logger.debug('Error resolving API key label', { apiKeyId, error: error instanceof Error ? error.message : String(error) });
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
    logger.debug('Error collecting character memories', { characterId, error: error instanceof Error ? error.message : String(error) });
    return [];
  }
}

/**
 * Collect all memories for a persona
 * Note: Memories are stored per character, so we check the personaId field
 */
async function collectPersonaMemories(
  repos: ReturnType<typeof getUserRepositories>,
  personaId: string
): Promise<Memory[]> {
  try {
    // Get all characters and collect their memories filtered by personaId
    const characters = await repos.characters.findAll();
    const memoriesArrays = await Promise.all(
      characters.map(char => repos.memories.findByCharacterId(char.id))
    );
    const allMemories = memoriesArrays.flat();
    return allMemories.filter(m => m.personaId === personaId);
  } catch (error) {
    logger.debug('Error collecting persona memories', { personaId, error: error instanceof Error ? error.message : String(error) });
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
    logger.debug('Error collecting chat memories', { chatId, error: error instanceof Error ? error.message : String(error) });
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
    logger.debug('Error getting chat messages', { chatId, error: error instanceof Error ? error.message : String(error) });
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
  logger.debug('Exporting characters', { userId, characterCount: characterIds.length, includeMemories });

  const repos = getUserRepositories(userId);
  const globalRepos = getRepositories();

  // Fetch characters
  const characters: ExportedCharacter[] = [];
  for (const id of characterIds) {
    const character = await repos.characters.findById(id);
    if (character) {
      const tagNames = await resolveTagNames(repos, character.tags);
      const linkedPersonaIds = character.personaLinks?.map(p => p.personaId) ?? [];
      const linkedPersonaNames: string[] = [];

      for (const personaId of linkedPersonaIds) {
        const persona = await repos.personas.findById(personaId);
        if (persona) linkedPersonaNames.push(persona.name);
      }

      characters.push({
        ...character,
        ...(tagNames.length > 0 && { _tagNames: tagNames }),
        ...(linkedPersonaNames.length > 0 && { _linkedPersonaNames: linkedPersonaNames }),
      });
    }
  }

  logger.debug('Exported characters', { count: characters.length });

  // Collect memories if requested
  let memories: Memory[] | undefined;
  if (includeMemories) {
    const memoriesArrays = await Promise.all(
      characterIds.map(id => collectCharacterMemories(repos, id))
    );
    memories = memoriesArrays.flat();
    logger.debug('Collected character memories', { count: memories.length });
  }

  return {
    characters,
    ...(memories && { memories }),
  };
}

/**
 * Export personas with optional memories
 */
export async function exportPersonas(
  userId: string,
  personaIds: string[],
  includeMemories: boolean
): Promise<PersonasExportData> {
  logger.debug('Exporting personas', { userId, personaCount: personaIds.length, includeMemories });

  const repos = getUserRepositories(userId);

  // Fetch personas
  const personas: ExportedPersona[] = [];
  for (const id of personaIds) {
    const persona = await repos.personas.findById(id);
    if (persona) {
      const tagNames = await resolveTagNames(repos, persona.tags);
      const linkedCharacterNames: string[] = [];

      for (const characterId of persona.characterLinks ?? []) {
        const character = await repos.characters.findById(characterId);
        if (character) linkedCharacterNames.push(character.name);
      }

      personas.push({
        ...persona,
        ...(tagNames.length > 0 && { _tagNames: tagNames }),
        ...(linkedCharacterNames.length > 0 && { _linkedCharacterNames: linkedCharacterNames }),
      });
    }
  }

  logger.debug('Exported personas', { count: personas.length });

  // Collect memories if requested
  let memories: Memory[] | undefined;
  if (includeMemories) {
    const memoriesArrays = await Promise.all(
      personaIds.map(id => collectPersonaMemories(repos, id))
    );
    memories = memoriesArrays.flat();
    logger.debug('Collected persona memories', { count: memories.length });
  }

  return {
    personas,
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
  logger.debug('Exporting chats', { userId, chatCount: chatIds.length, includeMemories });

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
          let personaName: string | undefined;

          if (p.type === 'CHARACTER' && p.characterId) {
            const char = await repos.characters.findById(p.characterId);
            characterName = char?.name;
          } else if (p.type === 'PERSONA' && p.personaId) {
            const persona = await repos.personas.findById(p.personaId);
            personaName = persona?.name;
          }

          return {
            participantId: p.id,
            characterName,
            personaName,
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

  logger.debug('Exported chats', { count: chats.length, messages: totalMessages });

  // Collect memories if requested
  let memories: Memory[] | undefined;
  if (includeMemories) {
    const memoriesArrays = await Promise.all(
      chatIds.map(id => collectChatMemories(repos, id))
    );
    memories = memoriesArrays.flat();
    logger.debug('Collected chat memories', { count: memories.length });
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
  logger.debug('Exporting roleplay templates', { userId, templateCount: templateIds.length });

  const repos = getUserRepositories(userId);
  const globalRepos = getRepositories();

  // Fetch templates and filter to user-created only (exclude built-in and plugin templates)
  const templates: ExportedRoleplayTemplate[] = [];
  for (const id of templateIds) {
    const template = await globalRepos.roleplayTemplates.findById(id);
    // Verify user owns template (userId is null for built-in, or matches for user-created)
    if (template && !template.isBuiltIn && !template.pluginName && template.userId === userId) {
      const tagNames = await resolveTagNames(repos, template.tags);
      templates.push({
        ...template,
        ...(tagNames.length > 0 && { _tagNames: tagNames }),
      });
    }
  }

  logger.debug('Exported roleplay templates', { count: templates.length });

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
  logger.debug('Exporting connection profiles', { userId, profileCount: profileIds.length });

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

  logger.debug('Exported connection profiles', { count: profiles.length });

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
  logger.debug('Exporting image profiles', { userId, profileCount: profileIds.length });

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

  logger.debug('Exported image profiles', { count: profiles.length });

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
  logger.debug('Exporting embedding profiles', { userId, profileCount: profileIds.length });

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

  logger.debug('Exported embedding profiles', { count: profiles.length });

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
  logger.debug('Exporting tags', { userId, tagCount: tagIds.length });

  const repos = getUserRepositories(userId);

  // Fetch tags
  const tags = [];
  for (const id of tagIds) {
    const tag = await repos.tags.findById(id);
    if (tag) {
      tags.push(tag);
    }
  }

  logger.debug('Exported tags', { count: tags.length });

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
  logger.debug('Exporting projects', { userId, projectCount: projectIds.length });

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

  logger.debug('Exported projects', { count: projects.length });

  return {
    projects,
  };
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

      case 'personas': {
        const allPersonas = options.scope === 'all'
          ? await repos.personas.findAll()
          : [];
        const ids = options.scope === 'all'
          ? allPersonas.map(p => p.id)
          : entityIds;

        data = await exportPersonas(userId, ids, options.includeMemories ?? false);
        entityCount = data.personas.length;
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
              .filter(t => !t.isBuiltIn && !t.pluginName && t.userId === userId)
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

      default:
        throw new Error(`Unknown export type: ${options.type}`);
    }

    // Create manifest with counts
    const counts: Record<string, number> = {};
    counts[options.type] = entityCount;
    if (memoryCount > 0) {
      counts.memories = memoryCount;
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
  logger.debug('Previewing export', { userId, type: options.type, scope: options.scope });

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

      case 'personas': {
        const allPersonas = options.scope === 'all'
          ? await repos.personas.findAll()
          : [];
        const ids = options.scope === 'all'
          ? allPersonas.map(p => p.id)
          : entityIds;

        for (const id of ids) {
          const persona = await repos.personas.findById(id);
          if (persona) {
            entities.push({ id: persona.id, name: persona.name });
            if (options.includeMemories) {
              const memories = await collectPersonaMemories(repos, id);
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
              .filter(t => !t.isBuiltIn && !t.pluginName && t.userId === userId)
              .map(t => t.id)
          : entityIds;

        for (const id of ids) {
          const template = await globalRepos.roleplayTemplates.findById(id);
          if (template && !template.isBuiltIn && !template.pluginName && template.userId === userId) {
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

      default:
        throw new Error(`Unknown export type: ${options.type}`);
    }

    logger.debug('Export preview generated', {
      userId,
      type: options.type,
      entityCount: entities.length,
      memoryCount,
    });

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
