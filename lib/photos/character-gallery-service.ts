/**
 * Character photo gallery service.
 *
 * Phase 3 of the photo-albums work moves the Aurora gallery onto each
 * character's vault `photos/` folder. This service is the backend for
 * the new `GET / POST / DELETE /api/v1/characters/[id]/photos` REST
 * surface that the Aurora `EmbeddedPhotoGallery` consumes. It's the
 * per-character sibling of {@link saveToUserGallery} — same content-
 * addressed hard-link plumbing, same kept-image Markdown contract, just
 * scoped to a character vault instead of the global Uploads mount.
 *
 * The save path here writes a fresh upload directly into the vault
 * (no `images-v2 FileEntry` involved). The list path returns every
 * link in the vault's `photos/` folder. The remove path uses
 * `deleteWithGC` so the last reference to the bytes drops the file row
 * and its blob.
 *
 * @module photos/character-gallery-service
 */

import { logger } from '@/lib/logger';
import { getCharacterVaultStore } from '@/lib/file-storage/character-vault-bridge';
import { ensureFolderPath } from '@/lib/mount-index/folder-paths';
import { emitDocumentWritten } from '@/lib/mount-index/db-store-events';
import { invalidateMountPoint } from '@/lib/mount-index/mount-chunk-cache';
import { enqueueEmbeddingJobsForMountPoint } from '@/lib/mount-index/embedding-scheduler';
import { resolveUniqueRelativePath } from '@/lib/file-storage/bridge-path-helpers';
import type { getRepositories } from '@/lib/database/repositories';
import { createHash } from 'crypto';
import {
  buildKeptImageMarkdown,
  buildSlugAndFilename,
  parseKeptImageFrontmatter,
  sha256OfString,
  basenameOfRelativePath,
} from './keep-image-markdown';
import { chunkAndInsertExtractedText } from './chunk-extracted-text';
import { buildPhotosRelativePath, PHOTOS_FOLDER, isPhotosRelativePath } from './photos-paths';
import { getPhotoLinkSummaryBySha256, type PhotoLinkSummary } from './photo-link-summary';
import { buildMountFileUrl } from './resolve-character-avatar';

export interface SaveToCharacterGalleryInput {
  characterId: string;
  /** Raw bytes of the uploaded image. */
  data: Buffer;
  /** Original filename (used for slug + storage hint). */
  filename: string;
  /** MIME type of the bytes (e.g. `image/png`). */
  mimeType: string;
  caption?: string | null;
  tags?: string[];
  repos: ReturnType<typeof getRepositories>;
}

export interface SaveToCharacterGalleryOutput {
  linkId: string;
  mountPointId: string;
  relativePath: string;
  keptAt: string;
  sha256: string;
}

export interface CharacterGalleryEntry {
  /** doc_mount_file_links.id — pass to delete or set-as-avatar. */
  linkId: string;
  mountPointId: string;
  relativePath: string;
  fileName: string;
  /** mount-blob URL the UI uses as `<img src>`. */
  blobUrl: string;
  mimeType: string | null;
  sha256: string;
  fileSizeBytes: number;
  keptAt: string;
  caption: string | null;
  tags: string[];
  /** Reverse-index summary: every hard link to these bytes. */
  linkSummary: PhotoLinkSummary;
}

export interface ListCharacterGalleryInput {
  characterId: string;
  limit?: number;
  offset?: number;
  repos: ReturnType<typeof getRepositories>;
}

export interface ListCharacterGalleryOutput {
  entries: CharacterGalleryEntry[];
  total: number;
  hasMore: boolean;
}

const DEFAULT_LIMIT = 60;

/**
 * Hard-link a freshly-uploaded image into the character's vault `photos/`
 * folder. The bytes are written via {@link linkBlobContent}, deduped by
 * sha256; a re-upload of the same image into the same character's vault is
 * refused.
 */
export async function saveToCharacterGallery(
  input: SaveToCharacterGalleryInput
): Promise<SaveToCharacterGalleryOutput> {
  const { characterId, data, filename, mimeType, caption, tags, repos } = input;

  const character = await repos.characters.findById(characterId);
  if (!character) {
    throw new Error(`Character not found: ${characterId}`);
  }

  const vault = await getCharacterVaultStore(characterId);
  if (!vault) {
    throw new Error(`Character ${characterId} has no linked database-backed vault`);
  }

  if (!data || data.length === 0) {
    throw new Error('Uploaded image is empty');
  }
  if (!mimeType.startsWith('image/')) {
    throw new Error(`Unsupported MIME type for character gallery: ${mimeType}`);
  }

  const sha256 = createHash('sha256').update(data).digest('hex');

  // Re-upload guard: refuse a second copy of the same bytes in this
  // character's photos/ folder.
  const summary = await getPhotoLinkSummaryBySha256(sha256, repos);
  const existingInVault = summary.linkers.find(
    l => l.mountPointId === vault.mountPointId && isPhotosRelativePath(l.relativePath)
  );
  if (existingInVault) {
    throw new Error(
      `Image already in ${character.name}'s photo album at ${existingInVault.relativePath}`
    );
  }

  const keptAt = new Date().toISOString();
  const markdown = buildKeptImageMarkdown({
    generationPrompt: null,
    generationRevisedPrompt: null,
    generationModel: null,
    sceneState: null,
    characterName: character.name,
    characterId: character.id,
    tags: tags ?? [],
    caption: caption ?? null,
    keptAt,
  });
  const extractedTextSha256 = sha256OfString(markdown);

  const { filename: slugFilename } = buildSlugAndFilename({
    caption: caption ?? null,
    generationPrompt: null,
    mimeType,
    keptAt,
  });
  // Prefer the uploader's filename when it carries the right extension;
  // otherwise fall back to the timestamped slug.
  const desiredPath = buildPhotosRelativePath(
    filename && filename.includes('.') ? sanitizeLeafName(filename) : slugFilename
  );
  const relativePath = await resolveUniqueRelativePath(vault.mountPointId, desiredPath);
  const folderId = await ensureFolderPath(vault.mountPointId, PHOTOS_FOLDER);

  const { link } = await repos.docMountFileLinks.linkBlobContent({
    mountPointId: vault.mountPointId,
    relativePath,
    fileName: basenameOfRelativePath(relativePath),
    folderId,
    originalFileName: filename || basenameOfRelativePath(relativePath),
    originalMimeType: mimeType,
    storedMimeType: mimeType,
    sha256,
    data,
    description: caption ?? '',
    extractedText: markdown,
    extractedTextSha256,
    extractionStatus: 'converted',
  });

  await chunkAndInsertExtractedText({
    linkId: link.id,
    mountPointId: vault.mountPointId,
    extractedText: markdown,
    repos,
  });

  invalidateMountPoint(vault.mountPointId);
  emitDocumentWritten({ mountPointId: vault.mountPointId, relativePath });
  repos.docMountPoints.refreshStats(vault.mountPointId).catch(() => { /* best-effort */ });
  enqueueEmbeddingJobsForMountPoint(vault.mountPointId).catch(err => {
    logger.warn('Failed to enqueue embedding after saveToCharacterGallery', {
      mountPointId: vault.mountPointId,
      error: err instanceof Error ? err.message : String(err),
    });
  });

  logger.info('Saved image to character gallery', {
    characterId,
    sha256,
    linkId: link.id,
    mountPointId: vault.mountPointId,
    relativePath,
  });

  return {
    linkId: link.id,
    mountPointId: vault.mountPointId,
    relativePath,
    keptAt,
    sha256,
  };
}

/**
 * List every photo in a character's vault `photos/` folder, plus the
 * historic `images/avatar.webp` portrait when one exists so the gallery
 * always surfaces the character's current avatar even when it predates
 * the photos/ folder convention. Most-recent first.
 */
export async function listCharacterGallery(
  input: ListCharacterGalleryInput
): Promise<ListCharacterGalleryOutput> {
  const { characterId, limit, offset, repos } = input;

  const character = await repos.characters.findById(characterId);
  if (!character) {
    throw new Error(`Character not found: ${characterId}`);
  }
  const vault = await getCharacterVaultStore(characterId);
  if (!vault) {
    return { entries: [], total: 0, hasMore: false };
  }

  const effectiveLimit = Math.max(1, Math.min(limit ?? DEFAULT_LIMIT, 200));
  const effectiveOffset = Math.max(0, offset ?? 0);

  const allLinks = await repos.docMountFileLinks.findByMountPointId(vault.mountPointId);
  const galleryLinks = allLinks.filter(l => {
    if (isPhotosRelativePath(l.relativePath)) return true;
    // The earlier `migrate-character-avatars-to-vaults-v1` migration places
    // pre-existing portraits under `images/avatar.webp` (+ `images/history/`).
    // Surface those alongside Phase-3 `photos/` so the gallery isn't empty
    // for characters who haven't generated/uploaded into `photos/` yet.
    const lower = l.relativePath.toLowerCase();
    return lower === 'images/avatar.webp' || lower.startsWith('images/history/');
  });

  const sortedLinks = galleryLinks
    .slice()
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const total = sortedLinks.length;
  const page = sortedLinks.slice(effectiveOffset, effectiveOffset + effectiveLimit);

  const entries: CharacterGalleryEntry[] = [];
  for (const link of page) {
    const meta = parseKeptImageFrontmatter(link.extractedText ?? null);
    const linkSummary = await getPhotoLinkSummaryBySha256(link.sha256, repos);
    entries.push({
      linkId: link.id,
      mountPointId: vault.mountPointId,
      relativePath: link.relativePath,
      fileName: link.fileName,
      blobUrl: buildMountFileUrl(vault.mountPointId, link.relativePath),
      mimeType: link.originalMimeType ?? null,
      sha256: link.sha256,
      fileSizeBytes: link.fileSizeBytes,
      keptAt: link.createdAt,
      caption: meta.caption ?? (link.description?.trim() ? link.description : null),
      tags: meta.tags,
      linkSummary,
    });
  }

  return {
    entries,
    total,
    hasMore: effectiveOffset + page.length < total,
  };
}

export interface RemoveFromCharacterGalleryInput {
  characterId: string;
  linkId: string;
  repos: ReturnType<typeof getRepositories>;
}

/**
 * Remove a photo from a character's gallery. If the link being removed
 * is the character's current `defaultImageId` (or appears in any
 * `avatarOverrides[].imageId`), the corresponding pointer is also nulled
 * so the avatar pipeline doesn't render a dangling reference.
 *
 * Uses `deleteWithGC`: when this was the last link to the underlying
 * bytes, the content row and its blob are reclaimed.
 */
export async function removeFromCharacterGallery(
  input: RemoveFromCharacterGalleryInput
): Promise<{ deleted: boolean; fileGC: boolean }> {
  const { characterId, linkId, repos } = input;

  const character = await repos.characters.findById(characterId);
  if (!character) {
    throw new Error(`Character not found: ${characterId}`);
  }

  const vault = await getCharacterVaultStore(characterId);
  if (!vault) {
    throw new Error(`Character ${characterId} has no linked database-backed vault`);
  }

  const link = await repos.docMountFileLinks.findByIdWithContent(linkId);
  if (!link || link.mountPointId !== vault.mountPointId) {
    return { deleted: false, fileGC: false };
  }

  // Clear avatar pointers before the link disappears so we don't leave a
  // stale defaultImageId behind.
  const updates: { defaultImageId?: string | null; avatarOverrides?: typeof character.avatarOverrides } = {};
  if (character.defaultImageId === linkId) {
    updates.defaultImageId = null;
  }
  const filteredOverrides = (character.avatarOverrides ?? []).filter(o => o.imageId !== linkId);
  if (filteredOverrides.length !== (character.avatarOverrides ?? []).length) {
    updates.avatarOverrides = filteredOverrides;
  }
  if (Object.keys(updates).length > 0) {
    await repos.characters.update(characterId, updates);
  }

  const result = await repos.docMountFileLinks.deleteWithGC(linkId);
  invalidateMountPoint(vault.mountPointId);
  repos.docMountPoints.refreshStats(vault.mountPointId).catch(() => { /* best-effort */ });

  logger.info('Removed image from character gallery', {
    characterId,
    linkId,
    relativePath: link.relativePath,
    fileGC: result.fileGC,
  });

  return { deleted: true, fileGC: result.fileGC };
}

const UNSAFE_LEAF_CHARS = /[\/\\:*?"<>|\x00-\x1f\x7f]/g;
function sanitizeLeafName(name: string): string {
  const basename = name.split(/[\\/]/).pop() ?? name;
  const cleaned = basename.replace(UNSAFE_LEAF_CHARS, '_').replace(/_{2,}/g, '_');
  return cleaned.replace(/^[_.]+/, '').replace(/[_.]+$/, '') || 'image';
}
