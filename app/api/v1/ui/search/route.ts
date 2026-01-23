/**
 * UI API v1 - Global Search Endpoint
 *
 * GET /api/v1/ui/search?q=query - Global search across entities
 */

import { NextRequest, NextResponse } from 'next/server';
import { createAuthenticatedHandler } from '@/lib/api/middleware';
import { logger } from '@/lib/logger';
import {
  badRequest,
  serverError,
  successResponse,
} from '@/lib/api/responses';

// ============================================================================
// GET Handler
// ============================================================================

export const GET = createAuthenticatedHandler(async (req, context) => {
  try {
    const { searchParams } = new URL(req.url);
    const query = searchParams.get('q')?.trim();

    if (!query) {
      return badRequest('Search query required');
    }

    if (query.length < 2) {
      return badRequest('Search query must be at least 2 characters');
    }

    logger.debug('[UI Search v1] Search', { query, userId: context.user.id });

    const { repos, user } = context;
    const results = {
      characters: [] as any[],
      chats: [] as any[],
      memories: [] as any[],
      tags: [] as any[],
      query,
    };

    // Search characters
    const characters = await repos.characters.findByUserId(user.id);
    results.characters = characters
      .filter(
        (c) =>
          c.name.toLowerCase().includes(query.toLowerCase()) ||
          c.description?.toLowerCase().includes(query.toLowerCase())
      )
      .slice(0, 10)
      .map((c) => ({
        id: c.id,
        type: 'character',
        name: c.name,
        description: c.description?.substring(0, 100),
      }));

    // Search chats
    const chats = await repos.chats.findByUserId(user.id);
    results.chats = chats
      .filter((c) =>
        c.title?.toLowerCase().includes(query.toLowerCase())
      )
      .slice(0, 10)
      .map((c) => ({
        id: c.id,
        type: 'chat',
        title: c.title,
      }));

    // Search memories across all user's characters
    const memoryResults: any[] = [];
    for (const character of characters) {
      const characterMemories = await repos.memories.searchByContent(character.id, query);
      for (const memory of characterMemories.slice(0, 5)) {
        memoryResults.push({
          id: memory.id,
          type: 'memory',
          summary: memory.summary,
          characterId: memory.characterId,
          characterName: character.name,
          importance: memory.importance,
        });
      }
      if (memoryResults.length >= 10) break;
    }
    results.memories = memoryResults.slice(0, 10);

    // Search tags
    const tags = await repos.tags.findByUserId(user.id);
    results.tags = tags
      .filter((t) => t.name.toLowerCase().includes(query.toLowerCase()))
      .slice(0, 10)
      .map((t) => ({
        id: t.id,
        type: 'tag',
        name: t.name,
      }));

    const totalResults =
      results.characters.length +
      results.chats.length +
      results.memories.length +
      results.tags.length;

    logger.info('[UI Search v1] Search completed', {
      query,
      results: totalResults,
    });

    return successResponse({
      ...results,
      totalResults,
    });
  } catch (error) {
    logger.error(
      '[UI Search v1] Error during search',
      {},
      error instanceof Error ? error : undefined
    );
    return serverError('Search failed');
  }
});
