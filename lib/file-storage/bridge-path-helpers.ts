/**
 * Bridge path helpers
 *
 * Shared filename + path utilities used by the four mount-point write bridges
 * (`project-store-bridge`, `character-vault-bridge`, `lantern-store-bridge`,
 * `user-uploads-bridge`). Lifted out so the four bridges don't carry the
 * exact same regex + sanitizer + collision resolver.
 *
 * No abstract base is provided. The bridges' write paths diverge in real ways
 * — character has a main/history split with overwrite-in-place, project does
 * an upsert against an existing mirror row, the other two are simple
 * subfolder/append — so a templated base would push those differences into
 * hook methods without reducing real code. The helpers here are the parts
 * that actually were byte-identical.
 *
 * @module file-storage/bridge-path-helpers
 */

import path from 'path';
import { createHash } from 'crypto';
import { getRepositories } from '@/lib/repositories/factory';

/**
 * Characters disallowed in a leaf filename. Mirrors the cross-platform
 * superset of unsafe characters (Windows + POSIX + control bytes).
 */
export const UNSAFE_LEAF_CHARS = /[\/\\:*?"<>|\x00-\x1f\x7f]/g;

/**
 * Strip directory components, collapse runs of underscores, and trim leading
 * dots/underscores from a filename. Falls back to `'unnamed'` if nothing
 * survives.
 */
export function sanitizeLeafName(filename: string): string {
  const basename = filename.split(/[\\/]/).pop() ?? filename;
  let safe = basename.replace(UNSAFE_LEAF_CHARS, '_').replace(/_{2,}/g, '_');
  safe = safe.replace(/^[_.]+/, '').replace(/[_.]+$/, '');
  return safe || 'unnamed';
}

/**
 * Find a free relative path under a mount point. If `desired` is already
 * taken, bumps with `(2)`, `(3)`, … up to 999; falls back to a sha-tagged
 * suffix if everything in that range collides.
 */
export async function resolveUniqueRelativePath(
  mountPointId: string,
  desired: string
): Promise<string> {
  const repos = getRepositories();
  const existing = await repos.docMountBlobs.findByMountPointAndPath(mountPointId, desired);
  if (!existing) return desired;

  const dir = path.posix.dirname(desired);
  const ext = path.extname(desired);
  const stem = path.posix.basename(desired, ext);
  const prefix = dir === '.' || dir === '' ? '' : `${dir}/`;

  for (let attempt = 2; attempt <= 999; attempt++) {
    const candidate = `${prefix}${stem} (${attempt})${ext}`;
    const collision = await repos.docMountBlobs.findByMountPointAndPath(mountPointId, candidate);
    if (!collision) return candidate;
  }
  const hash = createHash('sha1').update(`${desired}:${Date.now()}`).digest('hex').slice(0, 8);
  return `${prefix}${stem}-${hash}${ext}`;
}
