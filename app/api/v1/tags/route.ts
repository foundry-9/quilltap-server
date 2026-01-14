/**
 * Tags API v1 - Collection Endpoint
 *
 * GET /api/v1/tags - List all tags or search tags
 * GET /api/v1/tags?search=query - Search tags by name
 * POST /api/v1/tags - Create a new tag
 */

import { NextRequest, NextResponse } from 'next/server';
import { createAuthenticatedHandler } from '@/lib/api/middleware';
import { z } from 'zod';
import { logger } from '@/lib/logger';
import { created, validationError, serverError, successResponse } from '@/lib/api/responses';

// ============================================================================
// Schemas
// ============================================================================

const createTagSchema = z.object({
  name: z.string().min(1, 'Tag name is required').max(50),
});

// ============================================================================
// GET Handler
// ============================================================================

export const GET = createAuthenticatedHandler(async (req: NextRequest, { user, repos }) => {
  try {
    logger.debug('[Tags v1] GET list', { userId: user.id });

    const searchParams = req.nextUrl.searchParams;
    const search = searchParams.get('search');

    // Get all tags for the user
    let tags = await repos.tags.findAll();

    // Filter by search if provided
    if (search) {
      const searchLower = search.toLowerCase();
      tags = tags.filter(tag => tag.nameLower.includes(searchLower));
    }

    // Sort by name
    tags.sort((a, b) => a.name.localeCompare(b.name));

    // Get usage counts for each tag
    const allCharacters = await repos.characters.findAll();
    const allChats = await repos.chats.findAll();
    const allConnections = await repos.connections.findAll();

    const tagsWithCounts = tags.map(tag => {
      const characterTags = allCharacters.filter(c => c.tags.includes(tag.id)).length;
      const chatTags = allChats.filter(c => c.tags.includes(tag.id)).length;
      const connectionProfileTags = allConnections.filter(c => c.tags.includes(tag.id)).length;

      return {
        id: tag.id,
        name: tag.name,
        quickHide: tag.quickHide,
        visualStyle: tag.visualStyle ?? null,
        createdAt: tag.createdAt,
        updatedAt: tag.updatedAt,
        _count: {
          characterTags,
          chatTags,
          connectionProfileTags,
        },
      };
    });

    logger.debug('[Tags v1] Tags fetched', { count: tagsWithCounts.length, searched: !!search });

    return successResponse({
      tags: tagsWithCounts,
      count: tagsWithCounts.length,
    });
  } catch (error) {
    logger.error('[Tags v1] Error fetching tags', {}, error instanceof Error ? error : undefined);
    return serverError('Failed to fetch tags');
  }
});

// ============================================================================
// POST Handler
// ============================================================================

export const POST = createAuthenticatedHandler(async (req: NextRequest, { user, repos }) => {
  try {
    const body = await req.json();
    const validatedData = createTagSchema.parse(body);

    logger.debug('[Tags v1] Creating tag', { userId: user.id, name: validatedData.name });

    const nameLower = validatedData.name.toLowerCase();

    // Check if tag already exists (case-insensitive)
    const existingTag = await repos.tags.findByName(user.id, validatedData.name);

    if (existingTag) {
      logger.debug('[Tags v1] Found existing tag, returning it', {
        userId: user.id,
        tagName: validatedData.name,
        tagId: existingTag.id,
      });
      // Return existing tag instead of creating duplicate
      return successResponse({ tag: existingTag });
    }

    // Create tag
    const tag = await repos.tags.create({
      userId: user.id,
      name: validatedData.name,
      nameLower,
      quickHide: false,
    });

    logger.info('[Tags v1] Tag created', {
      userId: user.id,
      tagId: tag.id,
      tagName: tag.name,
    });

    return created({ tag });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return validationError(error);
    }

    logger.error('[Tags v1] Error creating tag', {}, error instanceof Error ? error : undefined);
    return serverError('Failed to create tag');
  }
});
