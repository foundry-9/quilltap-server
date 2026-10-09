/**
 * Chats API v1 - Toggle Avatar Generation Action
 *
 * POST /api/v1/chats/[id]?action=toggle-avatar-generation
 * Toggles avatarGenerationEnabled on the chat. When toggling ON,
 * enqueues avatar generation for all LLM-controlled character participants.
 */

import { NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { serverError, successResponse } from '@/lib/api/responses';
import { enqueueCharacterAvatarGeneration } from '@/lib/background-jobs/queue-service';
import { resolveAvatarImageProfile } from '@/lib/image-gen/profile-resolution';
import type { RequestContext } from '@/lib/api/middleware';

/**
 * Toggle avatar generation for a chat.
 *
 * Reads the current avatarGenerationEnabled value, flips it, and persists.
 * When toggling ON (to true), enqueues avatar generation jobs for every
 * LLM-controlled character participant in the chat.
 */
export async function handleToggleAvatarGeneration(
  chatId: string,
  { user, repos }: RequestContext
): Promise<NextResponse> {
  try {
    const chat = await repos.chats.findById(chatId);
    if (!chat) {
      // Should not happen — caller already verified ownership
      return serverError('Chat not found');
    }

    // Toggle: null/false → true, true → false
    const newValue = !chat.avatarGenerationEnabled;

    const updatedChat = await repos.chats.update(chatId, {
      avatarGenerationEnabled: newValue,
    });

    if (!updatedChat) {
      return serverError('Failed to update chat');
    }

    logger.info('[Chats v1] Avatar generation toggled', {
      chatId,
      avatarGenerationEnabled: newValue,
      context: 'avatar-generation',
    });

    // When toggling ON, generate initial avatars for all LLM-controlled characters
    if (newValue) {
      try {
        // Chat-level first, then the user's default, each checked for an API key.
        const imageProfileId =
          (await resolveAvatarImageProfile(user.id, repos, { chat }))?.id ?? null;

        if (!imageProfileId) {
          logger.debug('[Chats v1] No usable image profile; skipping initial avatar generation', {
            chatId,
            context: 'avatar-generation',
          });
        } else {
          // Find all LLM-controlled character participants
          const llmCharacterParticipants = (updatedChat.participants || []).filter(
            (p) => p.type === 'CHARACTER' && p.characterId && p.controlledBy !== 'user'
          );

          for (const participant of llmCharacterParticipants) {
            try {
              await enqueueCharacterAvatarGeneration(user.id, {
                chatId,
                characterId: participant.characterId!,
                imageProfileId,
              });
            } catch (charError) {
              logger.warn('[Chats v1] Failed to enqueue avatar generation for character', {
                chatId,
                characterId: participant.characterId,
                error: charError instanceof Error ? charError.message : String(charError),
                context: 'avatar-generation',
              });
            }
          }
        }
      } catch (genError) {
        // Non-fatal — toggle succeeded, generation is best-effort
        logger.warn('[Chats v1] Failed to enqueue initial avatar generation after toggle-on', {
          chatId,
          error: genError instanceof Error ? genError.message : String(genError),
          context: 'avatar-generation',
        });
      }
    }

    return successResponse({ avatarGenerationEnabled: newValue });
  } catch (error) {
    logger.error('[Chats v1] Error toggling avatar generation', { chatId, context: 'avatar-generation' }, error instanceof Error ? error : undefined);
    return serverError('Failed to toggle avatar generation');
  }
}
