/**
 * What kind of generated picture a `files` row is, judged by where it was
 * stored. One definition, shared by the chat gallery and the dynamic
 * backgrounds' pools (`lib/dynamic-backgrounds/pools.ts`).
 *
 * `paths` are the relative paths of the mount-index links over the file's
 * bytes (empty when the bytes never reached a mount).
 *
 * @module photos/generated-image-kind
 */

import type { FileEntry } from '@/lib/schemas/types';

/**
 * A Lantern backdrop, recognised by where it was stored: `generated/` in its
 * own mount, or the `/story-backgrounds/` folder the job files every backdrop
 * under. A superseded backdrop is no longer `storyBackgroundImageId`, so one
 * that never reached a mount is known only by its folder.
 */
export function isStoryBackgroundFile(
  file: Pick<FileEntry, 'folderPath'>,
  paths: readonly string[],
): boolean {
  if (file.folderPath === '/story-backgrounds/') return true;
  return paths.some((p) => p.toLowerCase().startsWith('generated/'));
}

/**
 * An Aurora repaint, recognised by where it was stored: `images/history/` in
 * the character's vault, or the legacy `/character-avatars/` project folder
 * for a chat whose files live in a project mount.
 */
export function isAvatarFile(
  file: Pick<FileEntry, 'folderPath'>,
  paths: readonly string[],
): boolean {
  if (file.folderPath === '/character-avatars/') return true;
  return paths.some((p) => p.toLowerCase().startsWith('images/history/'));
}
