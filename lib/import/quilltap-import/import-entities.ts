/**
 * Conflict-strategy importers for the remaining user-data entities: tags,
 * roleplay templates, projects, chats (with messages), and memories. Memories
 * are remap-only — they always insert, rewriting their character/chat/project/
 * tag FKs through the id maps populated by the earlier import phases.
 *
 * @module import/quilltap-import/import-entities
 */

import { randomUUID } from 'crypto';
import { logger } from '@/lib/logger';
import { getUserRepositories, getRepositories } from '@/lib/repositories/factory';
import type {
  Tag,
  ChatMetadata,
  Memory,
  RoleplayTemplate,
  MessageEvent,
  Project,
} from '@/lib/schemas/types';
import type { ImportOptions, IdMappingState, ImportCounts } from './types';

const moduleLogger = logger.child({ module: 'import:quilltap-import-service' });

export async function importTags(
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

export async function importRoleplayTemplates(
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

export async function importProjects(
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

export async function importChats(
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

export async function importMemories(
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
