/**
 * GET /api/tools/quilltap-export/entities
 *
 * Returns available entities for export selection
 */

import { NextResponse } from 'next/server';
import { createAuthenticatedHandler } from '@/lib/api/middleware';
import { getUserRepositories, getRepositories } from '@/lib/repositories/factory';
import { logger } from '@/lib/logger';
import { badRequest, serverError } from '@/lib/api/responses';
import type { ExportEntityType } from '@/lib/export/types';

const moduleLogger = logger.child({ module: 'api:quilltap-export-entities' });

export const GET = createAuthenticatedHandler(async (req, { user }) => {
  try {
    const userId = user.id;
    const { searchParams } = new URL(req.url);
    const type = searchParams.get('type') as ExportEntityType | null;

    if (!type) {
      return badRequest('Missing type parameter');
    }

    moduleLogger.debug('Fetching entities for export', { userId, type });

    const repos = getUserRepositories(userId);
    const globalRepos = getRepositories();

    let entities: Array<{ id: string; name: string; memoryCount?: number }> = [];
    let totalMemoryCount = 0;

    switch (type) {
      case 'characters': {
        const characters = await repos.characters.findAll();
        // Count memories per character
        for (const char of characters) {
          const memories = await repos.memories.findByCharacterId(char.id);
          const charMemoryCount = memories.length;
          totalMemoryCount += charMemoryCount;
          entities.push({
            id: char.id,
            name: char.name,
            memoryCount: charMemoryCount,
          });
        }
        break;
      }

      case 'personas': {
        const personas = await repos.personas.findAll();
        // Get all memories once to count per persona
        const characters = await repos.characters.findAll();
        const allMemoriesArrays = await Promise.all(
          characters.map((char) => repos.memories.findByCharacterId(char.id))
        );
        const allMemories = allMemoriesArrays.flat();

        for (const persona of personas) {
          const personaMemories = allMemories.filter((m) => m.personaId === persona.id);
          const personaMemoryCount = personaMemories.length;
          totalMemoryCount += personaMemoryCount;
          entities.push({
            id: persona.id,
            name: persona.name,
            memoryCount: personaMemoryCount,
          });
        }
        break;
      }

      case 'chats': {
        const chats = await repos.chats.findAll();
        // Get all memories once to count per chat
        const characters = await repos.characters.findAll();
        const allMemoriesArrays = await Promise.all(
          characters.map((char) => repos.memories.findByCharacterId(char.id))
        );
        const allMemories = allMemoriesArrays.flat();

        for (const chat of chats) {
          const chatMemories = allMemories.filter((m) => m.chatId === chat.id);
          const chatMemoryCount = chatMemories.length;
          totalMemoryCount += chatMemoryCount;
          entities.push({
            id: chat.id,
            name: chat.title,
            memoryCount: chatMemoryCount,
          });
        }
        break;
      }

      case 'roleplay-templates': {
        const templates = await globalRepos.roleplayTemplates.findAll();
        // Only include user-created templates (not built-in or plugin)
        const userTemplates = templates.filter(
          (t) => !t.isBuiltIn && !t.pluginName && t.userId === userId
        );
        entities = userTemplates.map((t) => ({ id: t.id, name: t.name }));
        break;
      }

      case 'connection-profiles': {
        const profiles = await repos.connections.findAll();
        entities = profiles.map((p) => ({ id: p.id, name: p.name }));
        break;
      }

      case 'image-profiles': {
        const profiles = await repos.imageProfiles.findAll();
        entities = profiles.map((p) => ({ id: p.id, name: p.name }));
        break;
      }

      case 'embedding-profiles': {
        const profiles = await repos.embeddingProfiles.findAll();
        entities = profiles.map((p) => ({ id: p.id, name: p.name }));
        break;
      }

      case 'tags': {
        const tags = await repos.tags.findAll();
        entities = tags.map((t) => ({ id: t.id, name: t.name }));
        break;
      }

      default:
        return badRequest(`Unknown entity type: ${type}`);
    }

    moduleLogger.info('Entities fetched for export', {
      userId,
      type,
      count: entities.length,
      totalMemoryCount,
    });

    return NextResponse.json({
      entities,
      memoryCount: totalMemoryCount,
    });
  } catch (error) {
    moduleLogger.error('Failed to fetch entities for export', {
      error: error instanceof Error ? error.message : String(error),
    });
    return serverError('Failed to fetch entities');
  }
});
