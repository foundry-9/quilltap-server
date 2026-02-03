/**
 * Chats API v1 - Story Background Actions
 *
 * POST /api/v1/chats/[id]?action=regenerate-background - Queue regeneration of story background
 */

import { NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { badRequest, serverError, successResponse } from '@/lib/api/responses';
import { enqueueStoryBackgroundGeneration } from '@/lib/background-jobs/queue-service';
import type { AuthenticatedContext } from '@/lib/api/middleware';
import type { ChatMetadata, ChatSettings } from '@/lib/schemas/types';

/**
 * Resolve the image profile to use for story background generation
 * Priority: Story backgrounds default > Chat image profile > User default
 */
async function resolveImageProfileForChat(
  userId: string,
  chat: ChatMetadata,
  chatSettings: ChatSettings | null,
  repos: AuthenticatedContext['repos']
): Promise<string | null> {
  // First, check if story backgrounds settings has a default profile
  const storyBackgroundsSettings = chatSettings?.storyBackgroundsSettings;
  if (storyBackgroundsSettings?.defaultImageProfileId) {
    const profile = await repos.imageProfiles.findById(storyBackgroundsSettings.defaultImageProfileId);
    if (profile && profile.userId === userId && profile.apiKeyId) {
      return profile.id;
    }
  }

  // Second, check the chat's image profile
  if (chat.imageProfileId) {
    const profile = await repos.imageProfiles.findById(chat.imageProfileId);
    if (profile && profile.userId === userId && profile.apiKeyId) {
      return profile.id;
    }
  }

  // Third, try the user's default image profile
  const defaultProfile = await repos.imageProfiles.findDefault(userId);
  if (defaultProfile && defaultProfile.apiKeyId) {
    return defaultProfile.id;
  }

  return null;
}

/**
 * Handle regenerate-background action
 * Queues a background job to regenerate the story background for the chat
 */
export async function handleRegenerateBackground(
  chatId: string,
  chat: ChatMetadata,
  ctx: AuthenticatedContext
): Promise<NextResponse> {
  const { user, repos } = ctx;

  try {
    // Get chat settings to check if story backgrounds are enabled
    const chatSettings = await repos.chatSettings.findByUserId(user.id);

    // Check if story backgrounds are enabled
    if (!chatSettings?.storyBackgroundsSettings?.enabled) {
      return badRequest('Story backgrounds are not enabled. Enable them in Settings > Chat Settings > Story Backgrounds.');
    }

    // Resolve the image profile to use
    const imageProfileId = await resolveImageProfileForChat(user.id, chat, chatSettings, repos);
    if (!imageProfileId) {
      return badRequest('No image profile available for story background generation. Configure an image profile in Chat Settings.');
    }

    // Get character IDs from participants
    const characterIds = chat.participants
      .filter(p => p.characterId)
      .map(p => p.characterId!);

    if (characterIds.length === 0) {
      return badRequest('No characters in chat to generate background for.');
    }

    // Queue the story background generation job
    await enqueueStoryBackgroundGeneration(user.id, {
      chatId: chat.id,
      imageProfileId,
      characterIds,
      sceneContext: chat.title,
      projectId: chat.projectId ?? null,
    });

    logger.info('[Chats v1] Queued story background regeneration', {
      chatId,
      imageProfileId,
      characterCount: characterIds.length,
    });

    return successResponse({
      message: 'Story background regeneration queued',
      queued: true,
    });
  } catch (error) {
    logger.error('[Chats v1] Failed to queue story background regeneration', {
      chatId,
      error: error instanceof Error ? error.message : String(error),
    }, error instanceof Error ? error : undefined);
    return serverError('Failed to queue story background regeneration');
  }
}
