/**
 * Characters API v1 - DELETE Handler
 *
 * DELETE /api/v1/characters/[id] - Delete a character (supports cascade)
 */

import { NextRequest, NextResponse } from 'next/server';
import { checkOwnership } from '@/lib/api/middleware';
import { executeCascadeDelete } from '@/lib/cascade-delete';
import { logger } from '@/lib/logger';
import { notFound, serverError } from '@/lib/api/responses';
import type { AuthenticatedContext } from '@/lib/api/middleware';

export async function handleDelete(
  req: NextRequest,
  ctx: AuthenticatedContext,
  id: string
): Promise<NextResponse> {
  const { user, repos } = ctx;

  try {
    const existingCharacter = await repos.characters.findById(id);

    if (!checkOwnership(existingCharacter, user.id)) {
      return notFound('Character');
    }

    // Parse cascade options
    const { searchParams } = req.nextUrl;
    const cascadeChats = searchParams.get('cascadeChats') === 'true';
    const cascadeImages = searchParams.get('cascadeImages') === 'true';

    const result = await executeCascadeDelete(id, {
      deleteExclusiveChats: cascadeChats,
      deleteExclusiveImages: cascadeImages,
    });

    if (!result.success) {
      return serverError('Failed to delete character');
    }

    logger.info('[Characters v1] Character deleted', {
      characterId: id,
      deletedChats: result.deletedChats,
      deletedImages: result.deletedImages,
      deletedMemories: result.deletedMemories,
    });

    return NextResponse.json({
      success: true,
      deletedChats: result.deletedChats,
      deletedImages: result.deletedImages,
      deletedMemories: result.deletedMemories,
    });
  } catch (error) {
    logger.error('[Characters v1] Error deleting character', { characterId: id }, error instanceof Error ? error : undefined);
    return serverError('Failed to delete character');
  }
}
