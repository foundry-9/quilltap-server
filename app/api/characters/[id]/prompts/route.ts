/**
 * Character System Prompts API
 *
 * GET /api/characters/[id]/prompts - Get all system prompts for a character
 * POST /api/characters/[id]/prompts - Add a new system prompt to a character
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getRepositories } from '@/lib/mongodb/repositories';
import { getServerSession } from '@/lib/auth/session';
import { logger } from '@/lib/logger';

const createPromptSchema = z.object({
  name: z.string().min(1).max(100),
  content: z.string().min(1),
  isDefault: z.boolean().optional().default(false),
});

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(request: Request, context: RouteContext) {
  try {
    const session = await getServerSession();
    if (!session?.user?.id) {
      logger.warn('Unauthorized access attempt to GET /api/characters/[id]/prompts');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id: characterId } = await context.params;
    logger.debug('Fetching character prompts', { characterId, userId: session.user.id });

    const repos = getRepositories();
    const character = await repos.characters.findById(characterId);

    if (!character) {
      logger.warn('Character not found for prompts fetch', {
        characterId,
        userId: session.user.id,
      });
      return NextResponse.json({ error: 'Character not found' }, { status: 404 });
    }

    if (character.userId !== session.user.id) {
      logger.warn('Forbidden access to character prompts', {
        characterId,
        userId: session.user.id,
        ownerId: character.userId,
      });
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const prompts = character.systemPrompts || [];
    logger.debug('Retrieved character prompts', {
      characterId,
      userId: session.user.id,
      count: prompts.length,
    });

    return NextResponse.json(prompts);
  } catch (error) {
    logger.error('Error fetching character prompts', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    return NextResponse.json(
      { error: 'Failed to fetch character prompts' },
      { status: 500 }
    );
  }
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const session = await getServerSession();
    if (!session?.user?.id) {
      logger.warn('Unauthorized access attempt to POST /api/characters/[id]/prompts');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id: characterId } = await context.params;
    const body = await request.json();
    const validated = createPromptSchema.parse(body);

    logger.debug('Adding system prompt to character', {
      characterId,
      userId: session.user.id,
      promptName: validated.name,
      isDefault: validated.isDefault,
    });

    const repos = getRepositories();

    // First verify the character exists and belongs to the user
    const character = await repos.characters.findById(characterId);

    if (!character) {
      logger.warn('Character not found for adding prompt', {
        characterId,
        userId: session.user.id,
      });
      return NextResponse.json({ error: 'Character not found' }, { status: 404 });
    }

    if (character.userId !== session.user.id) {
      logger.warn('Forbidden attempt to add prompt to character', {
        characterId,
        userId: session.user.id,
        ownerId: character.userId,
      });
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const prompt = await repos.characters.addSystemPrompt(characterId, {
      name: validated.name,
      content: validated.content,
      isDefault: validated.isDefault,
    });

    if (!prompt) {
      logger.error('Failed to add system prompt to character', {
        characterId,
        userId: session.user.id,
      });
      return NextResponse.json(
        { error: 'Failed to add system prompt' },
        { status: 500 }
      );
    }

    logger.info('System prompt added to character', {
      characterId,
      userId: session.user.id,
      promptId: prompt.id,
      promptName: validated.name,
    });

    return NextResponse.json(prompt, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      logger.warn('Invalid character prompt data', { errors: error.errors });
      return NextResponse.json({ error: error.errors }, { status: 400 });
    }
    logger.error('Error adding character prompt', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    return NextResponse.json(
      { error: 'Failed to add character prompt' },
      { status: 500 }
    );
  }
}
