/**
 * Which gallery pictures were drawn by an uncensored profile.
 *
 * Every gallery (the chat gallery, a character's album, avatar rolls and
 * wardrobe pictures, the `/photos` album, the image picker) asks the same
 * question here, by content hash: a picture is uncensored when any `files`
 * row with its bytes carries an uncensored `generationModeration`. Asking by
 * sha256 rather than by row is what lets a kept album photo (a vault link
 * with no `files` row of its own) wear the badge of the picture it was kept
 * from — the same bytes, the same verdict.
 *
 * The value itself is written only at generation time
 * (`generationModerationOf`); this module only reads it.
 *
 * @module photos/uncensored-images
 */

import { logger } from '@/lib/logger';
import type { GenerationModeration } from '@/lib/schemas/file.types';
import type { FileEntry } from '@/lib/schemas/types';

const log = logger.child({ module: 'photos.uncensored-images' });

/** The slice of the repositories this needs. */
export interface UncensoredImagesRepos {
  files: { findUncensoredBySha256s(sha256s: readonly string[]): Promise<FileEntry[]> };
}

/**
 * sha256 → the uncensored `generationModeration` recorded for those bytes.
 * Hashes with no uncensored record are absent. Never throws: a failed read
 * leaves every picture unbadged rather than breaking the gallery.
 */
export async function findUncensoredImages(
  repos: UncensoredImagesRepos,
  sha256s: Iterable<string | null | undefined>,
): Promise<Map<string, GenerationModeration>> {
  const hashes = Array.from(new Set(Array.from(sha256s).filter((s): s is string => !!s)));
  const out = new Map<string, GenerationModeration>();
  if (hashes.length === 0) return out;
  try {
    const rows = await repos.files.findUncensoredBySha256s(hashes);
    for (const row of rows) {
      if (row.generationModeration && !out.has(row.sha256)) {
        out.set(row.sha256, row.generationModeration);
      }
    }
    log.debug('Resolved uncensored gallery pictures', { asked: hashes.length, uncensored: out.size });
  } catch (error) {
    log.warn('Could not read uncensored records for gallery pictures; showing none', {
      asked: hashes.length,
      error: error instanceof Error ? error.message : String(error),
    });
  }
  return out;
}

/**
 * Stamp `generationModeration` onto each entry from its sha256. Entries
 * without an uncensored record get `null`.
 */
export async function withGenerationModeration<T extends { sha256?: string | null }>(
  repos: UncensoredImagesRepos,
  entries: T[],
): Promise<Array<T & { generationModeration: GenerationModeration | null }>> {
  const found = await findUncensoredImages(repos, entries.map((e) => e.sha256));
  return entries.map((e) => ({
    ...e,
    generationModeration: (e.sha256 && found.get(e.sha256)) || null,
  }));
}
