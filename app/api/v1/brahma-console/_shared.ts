/**
 * Brahma Console API v1 - Shared Helpers
 *
 * Shared logic for the Brahma Console routes ([id] item endpoint and its
 * messages sub-endpoint).
 */

import { NextResponse } from 'next/server';
import type { RequestContext } from '@/lib/api/middleware';
import type { ChatMetadata } from '@/lib/schemas/types';
import { notFound } from '@/lib/api/responses';
import type { ConsoleContextRef } from '@/lib/schemas/chat.types';
import { CONTEXT_CHAT_TYPES } from '@/lib/brahma-console/writing-context';

/**
 * Verify the chat exists, belongs to the user, and is a Brahma Console chat.
 * Returns the typed chat on success, or a 404 NextResponse otherwise.
 */
export async function verifyBrahmaChat(
  id: string,
  context: RequestContext
): Promise<{ chat: ChatMetadata } | NextResponse> {
  const { user, repos } = context;
  const chat = await repos.chats.findById(id);

  if (!chat || chat.userId !== user.id || chat.chatType !== 'brahma') {
    return notFound('Brahma Console chat');
  }

  return { chat };
}

/**
 * Check every Writing Assistant context ref names something that exists and
 * belongs to the user: a `chat` must be a Salon or autonomous conversation, a
 * `project` a project, a `store` a document store. Returns the first problem
 * as a message, or null when all is well.
 */
export async function validateConsoleContextRefs(
  refs: readonly ConsoleContextRef[],
  context: RequestContext
): Promise<string | null> {
  const { user, repos } = context;
  for (const ref of refs) {
    if (ref.kind === 'general') continue;
    if (ref.kind === 'chat') {
      const chat = await repos.chats.findById(ref.id);
      if (!chat || chat.userId !== user.id) return `Conversation ${ref.id} not found`;
      if (!(CONTEXT_CHAT_TYPES as readonly string[]).includes(chat.chatType ?? 'salon')) {
        return `Conversation ${ref.id} is not a Salon or autonomous conversation`;
      }
      continue;
    }
    if (ref.kind === 'project') {
      const project = await repos.projects.findByIdRaw(ref.id);
      if (!project) return `Project ${ref.id} not found`;
      continue;
    }
    const store = await repos.docMountPoints.findById(ref.id);
    if (!store) return `Document store ${ref.id} not found`;
  }
  return null;
}
