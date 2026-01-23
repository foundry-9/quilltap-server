/**
 * Chats API v1 - Tag Actions
 *
 * Handles add-tag and remove-tag actions
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { logger } from '@/lib/logger';
import { notFound, forbidden, validationError, serverError } from '@/lib/api/responses';
import { addTagSchema, removeTagSchema } from '../schemas';
import type { AuthenticatedContext } from '@/lib/api/middleware';

/**
 * Add a tag to a chat
 */
export async function handleAddTag(
  req: NextRequest,
  chatId: string,
  { user, repos }: AuthenticatedContext
): Promise<NextResponse> {
  try {
    const body = await req.json();
    const validatedData = addTagSchema.parse(body);

    const tag = await repos.tags.findById(validatedData.tagId);
    if (!tag) {
      return notFound('Tag');
    }

    if (tag.userId !== user.id) {
      return forbidden();
    }

    await repos.chats.addTag(chatId, validatedData.tagId);

    logger.info('[Chats v1] Tag added', { chatId, tagId: validatedData.tagId });

    return NextResponse.json({ success: true, tag }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return validationError(error);
    }
    logger.error('[Chats v1] Error adding tag', { chatId }, error instanceof Error ? error : undefined);
    return serverError('Failed to add tag to chat');
  }
}

/**
 * Remove a tag from a chat
 */
export async function handleRemoveTag(
  req: NextRequest,
  chatId: string,
  { repos }: AuthenticatedContext
): Promise<NextResponse> {
  try {
    const body = await req.json();
    const validatedData = removeTagSchema.parse(body);

    await repos.chats.removeTag(chatId, validatedData.tagId);

    logger.info('[Chats v1] Tag removed', { chatId, tagId: validatedData.tagId });

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return validationError(error);
    }
    logger.error('[Chats v1] Error removing tag', { chatId }, error instanceof Error ? error : undefined);
    return serverError('Failed to remove tag from chat');
  }
}
