/**
 * Image Profile Resolution
 *
 * Shared utility for resolving which image profile to use for story
 * background generation. Used by both the title-update background job
 * handler and the story-background API action.
 */

import type { ChatMetadata, ChatSettings } from '@/lib/schemas/types';

/** Minimal profile shape returned by findById/findDefault */
interface ProfileResult {
  id: string;
  userId: string;
  apiKeyId?: string | null;
}

/** Minimal project shape needed for image profile resolution */
interface ProjectResult {
  defaultImageProfileId?: string | null;
}

/** Minimal repository interface for image profile resolution */
interface ImageProfileRepo {
  findById(id: string): Promise<ProfileResult | null>;
  findDefault(userId: string): Promise<ProfileResult | null>;
}

/** Minimal repository interface for project lookup */
interface ProjectRepo {
  findById(id: string): Promise<ProjectResult | null>;
}

/**
 * Resolve the image profile to use for story background generation.
 *
 * Priority order:
 * 1. Chat-level image profile (most specific)
 * 2. Story backgrounds default image profile from chat settings
 * 3. Project-level default image profile (if chat belongs to a project)
 * 4. User's default image profile
 *
 * Each candidate is verified to exist, belong to the user, and have an API key.
 *
 * @param userId - The user ID
 * @param chat - The chat metadata
 * @param chatSettings - The chat settings (nullable for API route contexts)
 * @param repos - User-scoped repositories (or an object with imageProfiles and optionally projects)
 * @returns The image profile ID to use, or null if none available
 */
export async function resolveImageProfileForChat(
  userId: string,
  chat: ChatMetadata,
  chatSettings: ChatSettings | null,
  repos: { imageProfiles: ImageProfileRepo; projects?: ProjectRepo }
): Promise<string | null> {
  // First, check the chat's image profile (most specific, chat-level)
  if (chat.imageProfileId) {
    const profile = await repos.imageProfiles.findById(chat.imageProfileId);
    if (profile && profile.userId === userId && profile.apiKeyId) {
      return profile.id;
    }
  }

  // Second, check if story backgrounds settings has a default profile
  const storyBackgroundsSettings = chatSettings?.storyBackgroundsSettings;
  if (storyBackgroundsSettings?.defaultImageProfileId) {
    const profile = await repos.imageProfiles.findById(storyBackgroundsSettings.defaultImageProfileId);
    if (profile && profile.userId === userId && profile.apiKeyId) {
      return profile.id;
    }
  }

  // Third, check the project's default image profile (if chat belongs to a project)
  if (chat.projectId && repos.projects) {
    const project = await repos.projects.findById(chat.projectId);
    if (project?.defaultImageProfileId) {
      const profile = await repos.imageProfiles.findById(project.defaultImageProfileId);
      if (profile && profile.userId === userId && profile.apiKeyId) {
        return profile.id;
      }
    }
  }

  // Fourth, try the user's default image profile
  const defaultProfile = await repos.imageProfiles.findDefault(userId);
  if (defaultProfile && defaultProfile.apiKeyId) {
    return defaultProfile.id;
  }

  return null;
}

/** Minimal repository interface for wardrobe image profile resolution */
interface WardrobeProfileRepos<P extends ProfileResult> {
  imageProfiles: {
    findById(id: string): Promise<P | null>;
    findDefault(userId: string): Promise<P | null>;
  };
  chatSettings: {
    findByUserId(userId: string): Promise<Pick<ChatSettings, 'wardrobeImageSettings'> | null>;
  };
}

/**
 * Resolve the image profile that draws a wardrobe item's picture.
 *
 * Priority order:
 * 1. The per-generation override (the editor's "▾" pick)
 * 2. `chatSettings.wardrobeImageSettings.imageProfileId` (Settings → Images)
 * 3. The user's default image profile
 *
 * Each candidate must exist, belong to the user, and carry an API key — the
 * same three checks `resolveImageProfileForChat` makes. The Lantern's
 * `storyBackgroundsSettings.defaultImageProfileId` is deliberately NOT
 * consulted: the backdrop desk is chosen for landscapes, not for a garment a
 * provider might refuse.
 */
export async function resolveWardrobeImageProfile<P extends ProfileResult>(
  userId: string,
  repos: WardrobeProfileRepos<P>,
  override?: string | null,
): Promise<P | null> {
  const usable = (profile: P | null): profile is P =>
    !!profile && profile.userId === userId && !!profile.apiKeyId;

  if (override) {
    const profile = await repos.imageProfiles.findById(override);
    if (usable(profile)) return profile;
  }

  const settings = await repos.chatSettings.findByUserId(userId);
  const designatedId = settings?.wardrobeImageSettings?.imageProfileId;
  if (designatedId) {
    const profile = await repos.imageProfiles.findById(designatedId);
    if (usable(profile)) return profile;
  }

  const fallback = await repos.imageProfiles.findDefault(userId);
  if (fallback && fallback.apiKeyId) return fallback;

  return null;
}
