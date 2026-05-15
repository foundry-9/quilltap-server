/**
 * Centralised resolver for "the bytes a character's avatar id points at".
 *
 * After Phase 3 of the photo-albums work, `characters.defaultImageId`,
 * `characters.avatarOverrides[].imageId`, and `chats.characterAvatars[].imageId`
 * all hold `doc_mount_file_links.id` values — i.e., a hard-link into the
 * character's vault `photos/` (or `images/avatar.webp`) folder. Before
 * Phase 3, the same fields held a legacy `files.id`. Both shapes have to
 * resolve cleanly until the `files` table is fully retired:
 *
 *   1. Live instances that already ran the data migration carry vault link
 *      ids in those fields.
 *   2. A SillyTavern card or pre-Phase-3 `.qtap` archive imported into a
 *      post-Phase-3 instance can still land legacy file ids in those
 *      fields between the import and the next startup migration sweep.
 *
 * Rather than scatter "try the link table, fall back to the files table"
 * across every consumer, this module exposes a single resolver. Consumers
 * (`enrichWithDefaultImage`, `getCharacterDetail`, the cascade-delete
 * walker, file-storage reconciliation, etc.) call it with an id and walk
 * away with a resolved `{ url, mimeType, ...}` shape — without caring
 * which storage layer owns the bytes.
 *
 * @module photos/resolve-character-avatar
 */

import type { RepositoryContainer } from '@/lib/database/repositories';

/**
 * Resolved avatar reference. `id` is the input id so callers can compare
 * against `character.defaultImageId` etc. without an extra round-trip;
 * `url` is what to drop into an `<img src>` (already the correct shape
 * for the storage layer that owns the bytes); `kind` lets callers branch
 * on legacy-vs-new without inspecting the URL.
 */
export interface ResolvedCharacterAvatar {
  /** The input id (vault link id or legacy file id, unchanged). */
  id: string;
  /** Which storage layer owns the bytes. */
  kind: 'vault-link' | 'legacy-file';
  /** API URL that streams the bytes. */
  url: string;
  /** MIME type of the bytes, when known. Null for `avatarUrl` fallbacks. */
  mimeType: string | null;
  /** SHA-256 of the bytes when available (vault links + post-restore files have it; legacy avatarUrl fallbacks don't). */
  sha256: string | null;
  /** For vault-link kind: the mount point id the link lives in. */
  mountPointId: string | null;
  /** For vault-link kind: the relative path within the mount. */
  relativePath: string | null;
}

/**
 * Build the public URL the mount-point blob endpoint serves for a
 * (mountPointId, relativePath). Mirrors the URL the user gallery and the
 * library picker already use.
 */
export function buildMountFileUrl(mountPointId: string, relativePath: string): string {
  return `/api/v1/mount-points/${mountPointId}/blobs/${encodeURI(relativePath)}`;
}

/**
 * Build the legacy files-table URL for a file id.
 */
export function buildLegacyFileUrl(fileId: string): string {
  return `/api/v1/files/${fileId}`;
}

/**
 * Resolve a character-avatar id to its bytes.
 *
 * Tries the vault-link path first (the post-Phase-3 shape) and falls back
 * to the legacy `files` table for ids that haven't been migrated yet.
 * Returns `null` if neither lookup finds the id — callers should treat
 * this as "no avatar; use whatever placeholder applies."
 */
export async function resolveCharacterAvatar(
  id: string | null | undefined,
  repos: RepositoryContainer
): Promise<ResolvedCharacterAvatar | null> {
  if (!id) return null;

  // Path 1: vault-link id (post-Phase-3).
  const link = await repos.docMountFileLinks.findByIdWithContent(id);
  if (link) {
    return {
      id,
      kind: 'vault-link',
      url: buildMountFileUrl(link.mountPointId, link.relativePath),
      mimeType: nullIfEmpty(link.originalMimeType),
      sha256: nullIfEmpty(link.sha256),
      mountPointId: link.mountPointId,
      relativePath: link.relativePath,
    };
  }

  // Path 2: legacy files-table id (pre-Phase-3 or just-imported).
  const file = await repos.files.findById(id);
  if (file) {
    return {
      id,
      kind: 'legacy-file',
      url: buildLegacyFileUrl(file.id),
      mimeType: nullIfEmpty(file.mimeType),
      sha256: nullIfEmpty(file.sha256),
      mountPointId: null,
      relativePath: null,
    };
  }

  return null;
}

function nullIfEmpty(value: string | null | undefined): string | null {
  return value && value.length > 0 ? value : null;
}

/**
 * Batched variant for routes that enrich many characters at once
 * (`GET /api/v1/characters`, the chat-handler GET that paints a roster).
 * Avoids the N-query fan-out of calling `resolveCharacterAvatar` once per
 * character.
 *
 * Order of returned entries matches the input. Missing ids resolve to
 * `null` in their slot.
 */
export async function resolveCharacterAvatars(
  ids: Array<string | null | undefined>,
  repos: RepositoryContainer
): Promise<Array<ResolvedCharacterAvatar | null>> {
  return Promise.all(ids.map((id) => resolveCharacterAvatar(id, repos)));
}

/**
 * Read the raw bytes a character-avatar id points at — vault link or
 * legacy file. Used by the SillyTavern PNG export and any other path
 * that needs the bytes themselves rather than just a URL.
 *
 * Returns `null` if the id can't be resolved or the bytes can't be read
 * (blob missing, disk file missing, etc.). Callers should treat that as
 * "no avatar" and fall back to a placeholder.
 */
export async function readCharacterAvatarBuffer(
  id: string | null | undefined,
  repos: RepositoryContainer
): Promise<Buffer | null> {
  if (!id) return null;

  // Path 1: vault link. Read the bytes directly out of the mount-index
  // blob row identified by the link's fileId.
  const link = await repos.docMountFileLinks.findByIdWithContent(id);
  if (link) {
    const bytes = await repos.docMountBlobs.readDataByFileId(link.fileId);
    return bytes ?? null;
  }

  // Path 2: legacy files row. Dynamic import keeps the avatar-resolver
  // module light (the images-v2 reader drags in sharp via its conversion
  // codepath).
  const { readImageBuffer } = await import('@/lib/images-v2');
  try {
    return await readImageBuffer(id);
  } catch {
    return null;
  }
}
