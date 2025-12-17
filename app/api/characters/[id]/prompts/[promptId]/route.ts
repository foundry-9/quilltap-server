/**
 * Individual Character System Prompt API
 *
 * GET /api/characters/[id]/prompts/[promptId] - Get a specific system prompt
 * PUT /api/characters/[id]/prompts/[promptId] - Update a system prompt
 * DELETE /api/characters/[id]/prompts/[promptId] - Delete a system prompt
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getRepositories } from '@/lib/mongodb/repositories';
import { getServerSession } from '@/lib/auth/session';
import { logger } from '@/lib/logger';

const updatePromptSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  content: z.string().min(1).optional(),
  isDefault: z.boolean().optional(),
});

interface RouteContext {
  params: Promise<{ id: string; promptId: string }>;
}

export async function GET(request: Request, context: RouteContext) {
  try {
    const session = await getServerSession();
    if (!session?.user?.id) {
      logger.warn('Unauthorized access attempt to GET /api/characters/[id]/prompts/[promptId]');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id: characterId, promptId } = await context.params;
    logger.debug('Fetching character system prompt', {
      characterId,
      promptId,
      userId: session.user.id,
    });

    const repos = getRepositories();
    const character = await repos.characters.findById(characterId);

    if (!character) {
      logger.warn('Character not found for prompt fetch', {
        characterId,
        userId: session.user.id,
      });
      return NextResponse.json({ error: 'Character not found' }, { status: 404 });
    }

    if (character.userId !== session.user.id) {
      logger.warn('Forbidden access to character prompt', {
        characterId,
        userId: session.user.id,
        ownerId: character.userId,
      });
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const prompt = character.systemPrompts?.find((p) => p.id === promptId);

    if (!prompt) {
      logger.warn('System prompt not found on character', {
        characterId,
        promptId,
        userId: session.user.id,
      });
      return NextResponse.json({ error: 'Prompt not found' }, { status: 404 });
    }

    logger.debug('Retrieved character system prompt', {
      characterId,
      promptId,
      userId: session.user.id,
    });

    return NextResponse.json(prompt);
  } catch (error) {
    logger.error('Error fetching character system prompt', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    return NextResponse.json(
      { error: 'Failed to fetch character prompt' },
      { status: 500 }
    );
  }
}

export async function PUT(request: Request, context: RouteContext) {
  try {
    const session = await getServerSession();
    if (!session?.user?.id) {
      logger.warn('Unauthorized access attempt to PUT /api/characters/[id]/prompts/[promptId]');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id: characterId, promptId } = await context.params;
    const body = await request.json();
    const validated = updatePromptSchema.parse(body);

    logger.debug('Updating character system prompt', {
      characterId,
      promptId,
      userId: session.user.id,
    });

    const repos = getRepositories();

    // Verify character exists and belongs to user
    const character = await repos.characters.findById(characterId);

    if (!character) {
      logger.warn('Character not found for prompt update', {
        characterId,
        userId: session.user.id,
      });
      return NextResponse.json({ error: 'Character not found' }, { status: 404 });
    }

    if (character.userId !== session.user.id) {
      logger.warn('Forbidden attempt to update character prompt', {
        characterId,
        userId: session.user.id,
        ownerId: character.userId,
      });
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Verify prompt exists
    const existingPrompt = character.systemPrompts?.find((p) => p.id === promptId);
    if (!existingPrompt) {
      logger.warn('System prompt not found for update', {
        characterId,
        promptId,
        userId: session.user.id,
      });
      return NextResponse.json({ error: 'Prompt not found' }, { status: 404 });
    }

    const updates: any = {};
    if (validated.name !== undefined) updates.name = validated.name;
    if (validated.content !== undefined) updates.content = validated.content;
    if (validated.isDefault !== undefined) updates.isDefault = validated.isDefault;

    const prompt = await repos.characters.updateSystemPrompt(characterId, promptId, updates);

    if (!prompt) {
      logger.error('Failed to update system prompt', {
        characterId,
        promptId,
        userId: session.user.id,
      });
      return NextResponse.json(
        { error: 'Failed to update system prompt' },
        { status: 500 }
      );
    }

    logger.info('Character system prompt updated', {
      characterId,
      promptId,
      userId: session.user.id,
      updatedFields: Object.keys(updates),
    });

    return NextResponse.json(prompt);
  } catch (error) {
    if (error instanceof z.ZodError) {
      logger.warn('Invalid character prompt update data', { errors: error.errors });
      return NextResponse.json({ error: error.errors }, { status: 400 });
    }
    logger.error('Error updating character system prompt', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    return NextResponse.json(
      { error: 'Failed to update character prompt' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  try {
    const session = await getServerSession();
    if (!session?.user?.id) {
      logger.warn('Unauthorized access attempt to DELETE /api/characters/[id]/prompts/[promptId]');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id: characterId, promptId } = await context.params;
    logger.debug('Deleting character system prompt', {
      characterId,
      promptId,
      userId: session.user.id,
    });

    const repos = getRepositories();

    // Verify character exists and belongs to user
    const character = await repos.characters.findById(characterId);

    if (!character) {
      logger.warn('Character not found for prompt deletion', {
        characterId,
        userId: session.user.id,
      });
      return NextResponse.json({ error: 'Character not found' }, { status: 404 });
    }

    if (character.userId !== session.user.id) {
      logger.warn('Forbidden attempt to delete character prompt', {
        characterId,
        userId: session.user.id,
        ownerId: character.userId,
      });
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Verify prompt exists
    const existingPrompt = character.systemPrompts?.find((p) => p.id === promptId);
    if (!existingPrompt) {
      logger.warn('System prompt not found for deletion', {
        characterId,
        promptId,
        userId: session.user.id,
      });
      return NextResponse.json({ error: 'Prompt not found' }, { status: 404 });
    }

    const deleted = await repos.characters.deleteSystemPrompt(characterId, promptId);

    if (!deleted) {
      logger.error('Failed to delete system prompt', {
        characterId,
        promptId,
        userId: session.user.id,
      });
      return NextResponse.json(
        { error: 'Failed to delete system prompt' },
        { status: 500 }
      );
    }

    logger.info('Character system prompt deleted', {
      characterId,
      promptId,
      userId: session.user.id,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error('Error deleting character system prompt', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    return NextResponse.json(
      { error: 'Failed to delete character prompt' },
      { status: 500 }
    );
  }
}
