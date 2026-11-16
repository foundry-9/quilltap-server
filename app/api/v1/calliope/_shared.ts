/**
 * Calliope API v1 - Shared Helpers
 *
 * Shared logic for the Calliope routes ([id] item endpoint and its messages
 * sub-endpoint).
 */

import { NextResponse } from 'next/server';
import type { RequestContext } from '@/lib/api/middleware';
import type { ChatMetadata } from '@/lib/schemas/types';
import { notFound } from '@/lib/api/responses';

/**
 * Verify the chat exists, belongs to the user, and is a Calliope conversation
 * about a draft. Returns the typed chat on success, or a 404 otherwise.
 */
export async function verifyCalliopeChat(
  id: string,
  context: RequestContext
): Promise<{ chat: ChatMetadata & { themeDraftId: string } } | NextResponse> {
  const { user, repos } = context;
  const chat = await repos.chats.findById(id);

  if (!chat || chat.userId !== user.id || chat.chatType !== 'calliope' || !chat.themeDraftId) {
    return notFound('Calliope conversation');
  }

  return { chat: chat as ChatMetadata & { themeDraftId: string } };
}
