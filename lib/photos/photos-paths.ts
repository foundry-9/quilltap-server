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

/**
 * True when a `doc_mount_file_links.relativePath` lives in a `photos/`
 * folder. Case-insensitive to match the rest of the mount-index lookups.
 */
export function isPhotosRelativePath(relativePath: string | null | undefined): boolean {
  if (!relativePath) return false;
  const folder = path.posix.dirname(relativePath).toLowerCase();
  return folder === PHOTOS_FOLDER || folder.startsWith(`${PHOTOS_FOLDER}/`);
}
