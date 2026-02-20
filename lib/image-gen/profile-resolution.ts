/**
 * Image Profile Resolution
 *
 * Shared utility for resolving which image profile to use for story
 * background generation. Used by both the title-update background job
 * handler and the story-background API action.
 */

import type { ChatMetadata, ChatSettings } from '@/lib/schemas/types';
import { logger } from '@/lib/logger';

/** Minimal profile shape returned by findById/findDefault */
interface ProfileResult {
  id: string;
  userId: string;
  apiKeyId?: string | null;
}

/** Minimal repository interface for image profile resolution */
interface ImageProfileRepo {
  findById(id: string): Promise<ProfileResult | null>;
  findDefault(userId: string): Promise<ProfileResult | null>;
}

/**
 * Resolve the image profile to use for story background generation.
 *
 * Priority order:
 * 1. Chat-level image profile (most specific)
 * 2. Story backgrounds default image profile from chat settings
 * 3. User's default image profile
 *
 * Each candidate is verified to exist, belong to the user, and have an API key.
 *
 * @param userId - The user ID
 * @param chat - The chat metadata
 * @param chatSettings - The chat settings (nullable for API route contexts)
 * @param repos - User-scoped repositories (or an object with imageProfiles)
 * @returns The image profile ID to use, or null if none available
 */
export async function resolveImageProfileForChat(
  userId: string,
  chat: ChatMetadata,
  chatSettings: ChatSettings | null,
  repos: { imageProfiles: ImageProfileRepo }
): Promise<string | null> {
  // First, check the chat's image profile (most specific, chat-level)
  if (chat.imageProfileId) {
    const profile = await repos.imageProfiles.findById(chat.imageProfileId);
    if (profile && profile.userId === userId && profile.apiKeyId) {
      logger.debug('[ImageProfileResolution] Using chat-level image profile', {
        context: 'image-gen.profile-resolution',
        chatId: chat.id,
        profileId: profile.id,
      });
      return profile.id;
    }
  }

  // Second, check if story backgrounds settings has a default profile
  const storyBackgroundsSettings = chatSettings?.storyBackgroundsSettings;
  if (storyBackgroundsSettings?.defaultImageProfileId) {
    const profile = await repos.imageProfiles.findById(storyBackgroundsSettings.defaultImageProfileId);
    if (profile && profile.userId === userId && profile.apiKeyId) {
      logger.debug('[ImageProfileResolution] Using story backgrounds default profile', {
        context: 'image-gen.profile-resolution',
        chatId: chat.id,
        profileId: profile.id,
      });
      return profile.id;
    }
  }

  // Third, try the user's default image profile
  const defaultProfile = await repos.imageProfiles.findDefault(userId);
  if (defaultProfile && defaultProfile.apiKeyId) {
    logger.debug('[ImageProfileResolution] Using user default image profile', {
      context: 'image-gen.profile-resolution',
      chatId: chat.id,
      profileId: defaultProfile.id,
    });
    return defaultProfile.id;
  }

  logger.debug('[ImageProfileResolution] No suitable image profile found', {
    context: 'image-gen.profile-resolution',
    chatId: chat.id,
  });
  return null;
}
