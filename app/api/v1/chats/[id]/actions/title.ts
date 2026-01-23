/**
 * Chats API v1 - Title Actions
 *
 * Handles regenerate-title action
 */

import { NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { badRequest, serverError } from '@/lib/api/responses';
import { getCheapLLMProvider } from '@/lib/llm/cheap-llm';
import { titleChat, ChatMessage } from '@/lib/memory/cheap-llm-tasks';
import type { AuthenticatedContext } from '@/lib/api/middleware';
import type { ChatMetadata } from '@/lib/schemas/types';

/**
 * Regenerate a chat's title using LLM
 */
export async function handleRegenerateTitle(
  chatId: string,
  chat: ChatMetadata,
  { user, repos }: AuthenticatedContext
): Promise<NextResponse> {
  try {
    logger.debug('[Chats v1] Regenerating title', { chatId });

    const chatSettings = await repos.chatSettings.findByUserId(user.id);
    if (!chatSettings?.cheapLLMSettings) {
      return badRequest('Cheap LLM settings not configured');
    }

    const availableProfiles = await repos.connections.findByUserId(user.id);
    if (availableProfiles.length === 0) {
      return badRequest('No connection profiles available');
    }

    const characterParticipant = chat.participants.find((p) => p.type === 'CHARACTER');
    let connectionProfile = availableProfiles[0];

    if (characterParticipant?.connectionProfileId) {
      const participantProfile = availableProfiles.find((p) => p.id === characterParticipant.connectionProfileId);
      if (participantProfile) {
        connectionProfile = participantProfile;
      }
    }

    const cheapLLM = getCheapLLMProvider(
      connectionProfile,
      {
        strategy: chatSettings.cheapLLMSettings.strategy,
        userDefinedProfileId: chatSettings.cheapLLMSettings.userDefinedProfileId ?? undefined,
        defaultCheapProfileId: chatSettings.cheapLLMSettings.defaultCheapProfileId ?? undefined,
        fallbackToLocal: chatSettings.cheapLLMSettings.fallbackToLocal,
      },
      availableProfiles
    );

    if (!cheapLLM) {
      return badRequest('No cheap LLM available for title generation');
    }

    const allMessages = await repos.chats.getMessages(chatId);
    const conversationMessages: ChatMessage[] = allMessages
      .filter((msg) => msg.type === 'message')
      .filter((msg) => {
        const role = (msg as { role: string }).role;
        return role === 'USER' || role === 'ASSISTANT';
      })
      .map((msg) => ({
        role: (msg as { role: string }).role.toLowerCase() as 'user' | 'assistant',
        content: (msg as { content: string }).content,
      }));

    if (conversationMessages.length === 0) {
      return badRequest('No messages in chat to generate title from');
    }

    const result = await titleChat(conversationMessages, undefined, cheapLLM, user.id);

    if (!result.success || !result.result) {
      logger.error('[Chats v1] Title generation failed', { chatId, error: result.error });
      return serverError(result.error || 'Failed to generate title');
    }

    const newTitle = result.result;

    await repos.chats.update(chatId, {
      title: newTitle,
      isManuallyRenamed: false,
      updatedAt: new Date().toISOString(),
    });

    logger.info('[Chats v1] Title regenerated', { chatId, newTitle });

    return NextResponse.json({ success: true, title: newTitle });
  } catch (error) {
    logger.error('[Chats v1] Error regenerating title', { chatId }, error instanceof Error ? error : undefined);
    return serverError('Failed to regenerate title');
  }
}
