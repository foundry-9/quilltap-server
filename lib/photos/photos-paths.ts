/**
 * Photo album path helpers.
 *
 * A character's photo album is a `photos/` subfolder inside their character
 * vault — not a separate mount point. Centralising the folder name here keeps
 * the LLM tools, the chat GET resolver, and any future migration in lockstep
 * if we ever rename it.
 *
 * @module photos/photos-paths
 */

import path from 'path';

export const PHOTOS_FOLDER = 'photos';

/**
 * Compose a relative path inside a vault's `photos/` folder.
 */
export function buildPhotosRelativePath(filename: string): string {
  return `${PHOTOS_FOLDER}/${filename}`;
}

/** Where `migrate-character-avatars-to-vaults-v1` parked a pre-existing portrait. */
export const LEGACY_MAIN_AVATAR_PATH = 'images/avatar.webp';

/**
 * True when a `doc_mount_file_links.relativePath` lives in a `photos/`
 * folder. Case-insensitive to match the rest of the mount-index lookups.
 */
export function isPhotosRelativePath(relativePath: string | null | undefined): boolean {
  if (!relativePath) return false;
  const folder = path.posix.dirname(relativePath).toLowerCase();
  return folder === PHOTOS_FOLDER || folder.startsWith(`${PHOTOS_FOLDER}/`);
}

/**
 * True when a vault link is part of a character's **photo album** — what the
 * Aurora gallery tab shows and what the character-detail `photos` figure
 * counts.
 *
 * One predicate, two readers (`listCharacterGallery` and the character-detail
 * stats), because a second copy is how the grid and the count come to disagree.
 *
 * `images/history/` is deliberately excluded: those are avatar rolls — the
 * configuration cache's working stock — and they have their own section, fed by
 * `lib/photos/avatar-rolls-service.ts`. The canonical `images/avatar.webp`
 * portrait *is* album material, so a character who has never kept anything
 * still has a face on the page.
 */
export function isCharacterAlbumRelativePath(relativePath: string | null | undefined): boolean {
  if (!relativePath) return false;
  if (isPhotosRelativePath(relativePath)) return true;
  return relativePath.toLowerCase() === LEGACY_MAIN_AVATAR_PATH;
}
