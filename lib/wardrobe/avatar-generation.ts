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
  /**
   * One-shot override: use this image profile instead of the chat's default.
   * The chat's stored `imageProfileId` is NOT mutated. Used when the user
   * picks a non-default model from the wardrobe dialog.
   */
  imageProfileIdOverride?: string | null;
  /**
   * One-shot equipped-slots override: when set, the avatar prompt is built
   * from these slots instead of whatever is stored on the chat. Used by the
   * dialog's "fitting room" — a transient outfit composition that has not
   * been committed to the chat's equipped state.
   */
  equippedSlotsOverride?: {
    top: string[];
    bottom: string[];
    footwear: string[];
    accessories: string[];
  } | null;
}

/**
 * Trigger avatar generation if the chat has avatarGenerationEnabled.
 * Resolves the image profile from the override first, then chat-level
 * setting, then global default. Failures are caught and logged — they must
 * not propagate to the caller.
 */
export async function triggerAvatarGenerationIfEnabled(
  repos: ReturnType<typeof getRepositories>,
  params: AvatarGenerationParams
): Promise<void> {
  const {
    userId,
    chatId,
    characterId,
    callerContext,
    imageProfileIdOverride,
    equippedSlotsOverride,
  } = params;

  try {
    const chat = await repos.chats.findById(chatId);
    if (!chat?.avatarGenerationEnabled) {
      logger.debug('Avatar generation not enabled for chat, skipping', {
        context: callerContext,
        chatId,
      });
      return;
    }

    // Resolve image profile: explicit override → chat-level → global default
    let imageProfileId: string | null = null;

    if (imageProfileIdOverride) {
      const profile = await repos.imageProfiles.findById(imageProfileIdOverride);
      if (profile) {
        imageProfileId = profile.id;
        logger.debug('Avatar generation using one-shot profile override', {
          context: callerContext,
          chatId,
          characterId,
          imageProfileId,
        });
      } else {
        logger.warn('Avatar generation override profile not found, falling back', {
          context: callerContext,
          chatId,
          imageProfileIdOverride,
        });
      }
    }

    if (!imageProfileId && chat.imageProfileId) {
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
      ...(equippedSlotsOverride ? { equippedSlotsOverride } : {}),
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
