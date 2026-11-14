/**
 * Salon avatars fixed to their moment — the server half.
 *
 * Reads a chat's avatar timeline and resolves each distinct image once
 * through `resolveCharacterAvatar` (vault link first, legacy file second), so
 * the client receives display-ready {@link SalonAvatarSegment}s and never
 * guesses whether an image still exists. The pure selection is
 * `avatarAt` in `salon-avatar.ts`.
 *
 * @module chat/salon-avatar-loader
 */

import { logger } from '@/lib/logger';
import { resolveCharacterAvatar } from '@/lib/photos/resolve-character-avatar';
import type { RepositoryContainer } from '@/lib/database/repositories';
import type { SalonAvatarSegment } from './salon-avatar';

const log = logger.child({ module: 'salon-avatar' });

/** Every segment of a chat's avatar timeline, images resolved. */
export async function loadAvatarTimeline(
  chatId: string,
  repos: RepositoryContainer,
): Promise<SalonAvatarSegment[]> {
  const rows = await repos.avatarTimeline.findByChatId(chatId);
  if (rows.length === 0) return [];

  const urls = new Map<string, string | null>();
  for (const row of rows) {
    if (!row.imageId || urls.has(row.imageId)) continue;
    try {
      const resolved = await resolveCharacterAvatar(row.imageId, repos);
      urls.set(row.imageId, resolved?.url ?? null);
    } catch (error) {
      log.warn('Could not resolve an avatar timeline image; treating it as missing', {
        chatId,
        imageId: row.imageId,
        error: error instanceof Error ? error.message : String(error),
      });
      urls.set(row.imageId, null);
    }
  }

  // An own-avatar row (imageId null) shows the character's default image —
  // not the participant's current avatar, which carries this chat's per-chat
  // avatar. Resolved once per character that has such a row.
  const ownUrls = new Map<string, string | null>();
  for (const row of rows) {
    if (row.imageId || ownUrls.has(row.characterId)) continue;
    ownUrls.set(row.characterId, await resolveOwnAvatarUrl(row.characterId, repos, chatId));
  }

  const segments = rows.map((row): SalonAvatarSegment => {
    if (!row.imageId) {
      return {
        characterId: row.characterId,
        effectiveAt: row.effectiveAt,
        imageId: null,
        imageUrl: ownUrls.get(row.characterId) ?? null,
        ownAvatar: true,
        source: row.source,
        missing: false,
      };
    }
    const imageUrl = urls.get(row.imageId) ?? null;
    return {
      characterId: row.characterId,
      effectiveAt: row.effectiveAt,
      imageId: row.imageId,
      imageUrl,
      ownAvatar: false,
      source: row.source,
      missing: imageUrl === null,
    };
  });

  log.debug('Loaded avatar timeline', {
    chatId,
    segments: segments.length,
    images: urls.size,
    ownAvatars: ownUrls.size,
    missing: segments.filter(s => s.missing).length,
  });
  return segments;
}

/** The character's default image URL, or null (no default, or an unreadable character). */
async function resolveOwnAvatarUrl(
  characterId: string,
  repos: RepositoryContainer,
  chatId: string,
): Promise<string | null> {
  try {
    const character = await repos.characters.findById(characterId);
    if (!character?.defaultImageId) return null;
    const resolved = await resolveCharacterAvatar(character.defaultImageId, repos);
    return resolved?.url ?? null;
  } catch (error) {
    log.warn('Could not read a character for their own avatar; showing the placeholder', {
      chatId,
      characterId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}
