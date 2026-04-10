/**
 * Shared avatar generation trigger for wardrobe changes.
 *
 * Checks whether a chat has avatar generation enabled, resolves the
 * appropriate image profile, and enqueues a character avatar generation job.
 * Failures are caught and logged — they must never affect the caller's result.
 */

import { logger } from '@/lib/logger';
import { enqueueCharacterAvatarGeneration } from '@/lib/background-jobs/queue-service';
import type { getRepositories } from '@/lib/repositories/factory';

interface AvatarGenerationParams {
  userId: string;
  chatId: string;
  characterId: string;
  /** Identifies the call site in log messages (e.g. 'wardrobe-create-item-handler') */
  callerContext: string;
}

/**
 * Trigger avatar generation if the chat has avatarGenerationEnabled.
 * Resolves the image profile from the chat-level setting or falls back to default.
 * Failures are caught and logged — they must not propagate to the caller.
 */
export async function triggerAvatarGenerationIfEnabled(
  repos: ReturnType<typeof getRepositories>,
  params: AvatarGenerationParams
): Promise<void> {
  const { userId, chatId, characterId, callerContext } = params;

  try {
    const chat = await repos.chats.findById(chatId);
    if (!chat?.avatarGenerationEnabled) {
      logger.debug('Avatar generation not enabled for chat, skipping', {
        context: callerContext,
        chatId,
      });
      return;
    }

    // Resolve image profile: chat-level first, then default
    let imageProfileId: string | null = null;

    if (chat.imageProfileId) {
      const profile = await repos.imageProfiles.findById(chat.imageProfileId);
      if (profile) {
        imageProfileId = profile.id;
      }
    }

    if (!imageProfileId) {
      const allProfiles = await repos.imageProfiles.findAll();
      const defaultProfile = allProfiles.find((p) => p.isDefault) || null;
      if (defaultProfile) {
        imageProfileId = defaultProfile.id;
      }
    }

    if (!imageProfileId) {
      logger.debug('No image profile available for avatar generation, skipping', {
        context: callerContext,
        chatId,
        characterId,
      });
      return;
    }

    await enqueueCharacterAvatarGeneration(userId, {
      chatId,
      characterId,
      imageProfileId,
    });

    logger.debug('Avatar generation enqueued after outfit change', {
      context: callerContext,
      chatId,
      characterId,
      imageProfileId,
    });
  } catch (error) {
    logger.warn('Failed to enqueue avatar generation after outfit change', {
      context: callerContext,
      chatId,
      characterId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
