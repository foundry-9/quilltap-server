/**
 * User photo gallery service.
 *
 * The human user has their own photo album — parallel to the per-character
 * vault album shipped in Phase 1, but rooted in the Quilltap Uploads mount
 * (`<userUploadsMountPointId>/photos/`). Functions here are the backend for
 * the `/api/v1/photos` REST endpoints and the `/photos` gallery page.
 *
 * The save path piggy-backs on `linkBlobContent` — the same content-addressed
 * hard-link plumbing the character vault uses — so an image saved to the
 * user's gallery shares its bytes with any chat attachment, kept-image link,
 * or other gallery entry of the same image.
 *
 * @module photos/user-gallery-service
 */

import path from 'path';
import { logger } from '@/lib/logger';
import { getUserUploadsStore } from '@/lib/file-storage/user-uploads-bridge';
import { ensureFolderPath } from '@/lib/mount-index/folder-paths';
import { emitDocumentWritten } from '@/lib/mount-index/db-store-events';
import { invalidateMountPoint } from '@/lib/mount-index/mount-chunk-cache';
import { enqueueEmbeddingJobsForMountPoint } from '@/lib/mount-index/embedding-scheduler';
import { resolveUniqueRelativePath } from '@/lib/file-storage/bridge-path-helpers';
import { searchDocumentChunks } from '@/lib/mount-index/document-search';
import { generateEmbeddingForUser } from '@/lib/embedding/embedding-service';
import type { getRepositories } from '@/lib/database/repositories';
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
import { SceneStateSchema } from '@/lib/schemas/chat.types';

const USER_LINKED_BY_NAME = 'You';

export interface SaveToUserGalleryInput {
  /** image-v2 FileEntry id to save. */
  fileId: string;
  caption?: string | null;
  tags?: string[];
  /** Optional chat id so scene state can be captured (matches keep_image). */
  chatId?: string | null;
  userId: string;
  repos: ReturnType<typeof getRepositories>;
}

export interface SaveToUserGalleryOutput {
  linkId: string;
  mountPointId: string;
  mountPointName: string;
  relativePath: string;
  keptAt: string;
  fileId: string;
  sha256: string;
}

export interface UserGalleryEntry {
  /** doc_mount_file_links.id — pass to delete/attach. */
  linkId: string;
  mountPointId: string;
  relativePath: string;
  fileName: string;
  /** The mount-blob URL the UI can use as a thumbnail src. */
  blobUrl: string;
  mimeType: string;
  sha256: string;
  fileSizeBytes: number;
  keptAt: string;
  caption: string | null;
  tags: string[];
  /** Excerpt of the original generation prompt, when known. */
  generationPromptExcerpt: string;
  /** Cosine score from semantic search when a query was supplied. */
  relevanceScore?: number;
  /** Reverse-index summary: every hard link to these bytes. */
  linkSummary: PhotoLinkSummary;
}

export interface ListUserGalleryInput {
  query?: string;
  tags?: string[];
  limit?: number;
  offset?: number;
  userId: string;
  repos: ReturnType<typeof getRepositories>;
}

export interface ListUserGalleryOutput {
  entries: UserGalleryEntry[];
  total: number;
  hasMore: boolean;
}

const DEFAULT_LIMIT = 24;

/**
 * Save (hard-link) an image-v2 FileEntry into the user's photo gallery.
 * Mirrors the character-vault `keep_image` flow: writes a Markdown context
 * document into `extractedText`, chunks and embeds it, and dedupes by sha256
 * so two saves of the same image share the same underlying file row.
 */
export async function saveToUserGallery(
  input: SaveToUserGalleryInput
): Promise<SaveToUserGalleryOutput> {
  const { fileId, caption, tags, chatId, userId, repos } = input;

  const target = await getUserUploadsStore();
  if (!target) {
    throw new Error('Quilltap Uploads mount has not been provisioned');
  }

  const fileEntry = await repos.files.findById(fileId);
  if (!fileEntry) {
    throw new Error(`Image not found: ${fileId}`);
  }
  if (fileEntry.category !== 'IMAGE' && !fileEntry.mimeType.startsWith('image/')) {
    throw new Error(`File ${fileId} is not an image (category=${fileEntry.category})`);
  }
  if (fileEntry.userId !== userId) {
    throw new Error(`File ${fileId} is not owned by the calling user`);
  }

  // Re-save guard: refuse a second save for the same sha256 in the user's
  // photos/ folder. Use the link summary helper to find any existing entry.
  const summary = await getPhotoLinkSummaryBySha256(fileEntry.sha256, repos);
  const existingInGallery = summary.linkers.find(
    l => l.mountPointId === target.mountPointId && isPhotosRelativePath(l.relativePath)
  );
  if (existingInGallery) {
    throw new Error(
      `Image already saved to your gallery at ${existingInGallery.relativePath} on ${existingInGallery.linkedAt}`
    );
  }

  // Read the bytes via the file storage manager (handles mount-blob / disk /
  // legacy storage all the same). Done lazy-import to keep sharp/webp out of
  // the gallery service module load.
  const { fileStorageManager } = await import('@/lib/file-storage/manager');
  const buffer = await fileStorageManager.downloadFile(fileEntry);
  if (!buffer || buffer.length === 0) {
    throw new Error(`Image ${fileId} has empty bytes`);
  }

  // Capture scene state (if chatId was supplied) for the same provenance
  // story the character vault tells.
  let parsedSceneState = null;
  let sceneStateMalformed = false;
  if (chatId) {
    const chat = await repos.chats.findById(chatId);
    const raw = chat?.sceneState;
    if (raw !== null && raw !== undefined) {
      const parseResult = SceneStateSchema.safeParse(raw);
      if (parseResult.success) {
        parsedSceneState = parseResult.data;
      } else {
        sceneStateMalformed = true;
      }
    }
  }

  const keptAt = new Date().toISOString();
  const markdown = buildKeptImageMarkdown({
    generationPrompt: fileEntry.generationPrompt ?? null,
    generationRevisedPrompt: fileEntry.generationRevisedPrompt ?? null,
    generationModel: fileEntry.generationModel ?? null,
    sceneState: parsedSceneState,
    sceneStateMalformed,
    characterName: USER_LINKED_BY_NAME,
    characterId: userId,
    tags: tags ?? [],
    caption: caption ?? null,
    keptAt,
  });
  const extractedTextSha256 = sha256OfString(markdown);

  const { filename } = buildSlugAndFilename({
    caption: caption ?? null,
    generationPrompt: fileEntry.generationPrompt ?? null,
    mimeType: fileEntry.mimeType,
    keptAt,
  });
  const desiredPath = buildPhotosRelativePath(filename);
  const relativePath = await resolveUniqueRelativePath(target.mountPointId, desiredPath);
  const folderId = await ensureFolderPath(target.mountPointId, PHOTOS_FOLDER);

  const { link } = await repos.docMountFileLinks.linkBlobContent({
    mountPointId: target.mountPointId,
    relativePath,
    fileName: basenameOfRelativePath(relativePath),
    folderId,
    originalFileName: fileEntry.originalFilename,
    originalMimeType: fileEntry.mimeType,
    storedMimeType: fileEntry.mimeType,
    sha256: fileEntry.sha256,
    data: buffer,
    description: caption ?? '',
    extractedText: markdown,
    extractedTextSha256,
    extractionStatus: 'converted',
  });

  await chunkAndInsertExtractedText({
    linkId: link.id,
    mountPointId: target.mountPointId,
    extractedText: markdown,
    repos,
  });

  invalidateMountPoint(target.mountPointId);
  emitDocumentWritten({ mountPointId: target.mountPointId, relativePath });
  repos.docMountPoints.refreshStats(target.mountPointId).catch(() => { /* best-effort */ });
  enqueueEmbeddingJobsForMountPoint(target.mountPointId).catch(err => {
    logger.warn('Failed to enqueue embedding after saveToUserGallery', {
      mountPointId: target.mountPointId,
      error: err instanceof Error ? err.message : String(err),
    });
  });

  logger.info('Saved image to user gallery', {
    fileEntryId: fileEntry.id,
    sha256: fileEntry.sha256,
    linkId: link.id,
    mountPointId: target.mountPointId,
    relativePath,
    userId,
  });

  const mp = await repos.docMountPoints.findById(target.mountPointId);
  return {
    linkId: link.id,
    mountPointId: target.mountPointId,
    mountPointName: mp?.name ?? 'Quilltap Uploads',
    relativePath,
    keptAt,
    fileId: fileEntry.id,
    sha256: fileEntry.sha256,
  };
}

/**
 * List the user's gallery entries. With `query` set, ranks by semantic
 * similarity over the saved markdown (prompt + scene + caption + tags);
 * otherwise returns most-recent first.
 */
export async function listUserGallery(
  input: ListUserGalleryInput
): Promise<ListUserGalleryOutput> {
  const { query, tags, limit, offset, userId, repos } = input;
  const target = await getUserUploadsStore();
  if (!target) {
    return { entries: [], total: 0, hasMore: false };
  }

  const effectiveLimit = Math.max(1, Math.min(limit ?? DEFAULT_LIMIT, 200));
  const effectiveOffset = Math.max(0, offset ?? 0);

  // Pull every link in the user-uploads mount that lives in photos/. The mount
  // is single-user (Quilltap is single-user) so we don't filter by userId at
  // the link layer.
  const allLinks = await repos.docMountFileLinks.findByMountPointId(target.mountPointId);
  const photoLinks = allLinks.filter(l => isPhotosRelativePath(l.relativePath));

  let scoredLinks: Array<{ link: typeof photoLinks[number]; relevance?: number }> = [];

  if (query && query.trim().length > 0) {
    // Semantic search constrained to the photos/ folder of the user-uploads
    // mount. searchDocumentChunks returns chunk hits keyed by relativePath +
    // mountPointId; we map back to link rows by relativePath since the chunk
    // result doesn't surface the linkId directly.
    const queryEmbedding = await generateEmbeddingForUser(query, userId);
    const hits = await searchDocumentChunks(queryEmbedding.embedding, {
      mountPointIds: [target.mountPointId],
      pathPrefix: `${PHOTOS_FOLDER}/`,
      query,
      applyLiteralPhraseBoost: true,
      limit: effectiveLimit * 4,
    });
    const byPath = new Map<string, number>();
    for (const hit of hits) {
      const key = hit.relativePath.toLowerCase();
      const prior = byPath.get(key);
      if (prior === undefined || hit.score > prior) byPath.set(key, hit.score);
    }
    for (const link of photoLinks) {
      const score = byPath.get(link.relativePath.toLowerCase());
      if (score !== undefined) {
        scoredLinks.push({ link, relevance: score });
      }
    }
    scoredLinks.sort((a, b) => (b.relevance ?? 0) - (a.relevance ?? 0));
  } else {
    scoredLinks = photoLinks
      .slice()
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map(link => ({ link }));
  }

  // Filter by tags after the candidate set is built.
  const filtered: typeof scoredLinks = [];
  for (const candidate of scoredLinks) {
    const meta = parseKeptImageFrontmatter(candidate.link.extractedText ?? null);
    if (tags && tags.length > 0) {
      const lowered = new Set(meta.tags.map(t => t.toLowerCase()));
      const matches = tags.some(t => lowered.has(t.toLowerCase()));
      if (!matches) continue;
    }
    filtered.push(candidate);
  }

  const total = filtered.length;
  const page = filtered.slice(effectiveOffset, effectiveOffset + effectiveLimit);

  const entries: UserGalleryEntry[] = [];
  for (const { link, relevance } of page) {
    const meta = parseKeptImageFrontmatter(link.extractedText ?? null);
    const linkSummary = await getPhotoLinkSummaryBySha256(link.sha256, repos);
    const blobUrl = `/api/v1/mount-points/${target.mountPointId}/blobs/${encodeURI(link.relativePath)}`;
    entries.push({
      linkId: link.id,
      mountPointId: target.mountPointId,
      relativePath: link.relativePath,
      fileName: link.fileName,
      blobUrl,
      mimeType: link.originalMimeType ?? 'image/webp',
      sha256: link.sha256,
      fileSizeBytes: link.fileSizeBytes,
      keptAt: link.createdAt,
      caption: meta.caption,
      tags: meta.tags,
      generationPromptExcerpt: extractPromptExcerpt(link.extractedText ?? null),
      relevanceScore: relevance,
      linkSummary,
    });
  }

  return { entries, total, hasMore: effectiveOffset + page.length < total };
}

export interface RemoveFromUserGalleryInput {
  linkId: string;
  userId: string;
  repos: ReturnType<typeof getRepositories>;
}

/**
 * Remove a gallery entry (cascades to its chunks and, if it was the last
 * hard link to the bytes, drops the file row and blob).
 */
export async function removeFromUserGallery(
  input: RemoveFromUserGalleryInput
): Promise<{ deleted: boolean; fileGC: boolean }> {
  const { linkId, repos } = input;
  const target = await getUserUploadsStore();
  if (!target) {
    return { deleted: false, fileGC: false };
  }
  const link = await repos.docMountFileLinks.findByIdWithContent(linkId);
  if (!link) return { deleted: false, fileGC: false };
  if (link.mountPointId !== target.mountPointId) {
    throw new Error('Link is not in the user gallery');
  }
  if (!isPhotosRelativePath(link.relativePath)) {
    throw new Error('Link is not a gallery entry');
  }
  const result = await repos.docMountFileLinks.deleteWithGC(linkId);
  invalidateMountPoint(target.mountPointId);
  return { deleted: result.fileId !== null, fileGC: result.fileGC };
}

function extractPromptExcerpt(extractedText: string | null): string {
  if (!extractedText) return '';
  const match = extractedText.match(/##\s+Original prompt\s*\n+([^\n][^\n]*(?:\n[^\n#][^\n]*)*)/);
  if (!match) return '';
  const para = match[1].trim();
  return para.length > 200 ? `${para.slice(0, 200).trimEnd()}…` : para;
}

/**
 * Helper for the chat-attach flow: returns enough metadata to build an
 * outgoing message that re-attaches a gallery item as a normal image
 * attachment. The caller (Salon) is responsible for adding the linkId to the
 * outgoing message's `attachments` array.
 */
export async function getUserGalleryEntry(
  linkId: string,
  _userId: string,
  repos: ReturnType<typeof getRepositories>
): Promise<UserGalleryEntry | null> {
  const target = await getUserUploadsStore();
  if (!target) return null;
  const link = await repos.docMountFileLinks.findByIdWithContent(linkId);
  if (!link) return null;
  if (link.mountPointId !== target.mountPointId) return null;
  if (!isPhotosRelativePath(link.relativePath)) return null;
  const meta = parseKeptImageFrontmatter(link.extractedText ?? null);
  const linkSummary = await getPhotoLinkSummaryBySha256(link.sha256, repos);
  return {
    linkId: link.id,
    mountPointId: target.mountPointId,
    relativePath: link.relativePath,
    fileName: link.fileName,
    blobUrl: `/api/v1/mount-points/${target.mountPointId}/blobs/${encodeURI(link.relativePath)}`,
    mimeType: link.originalMimeType ?? 'image/webp',
    sha256: link.sha256,
    fileSizeBytes: link.fileSizeBytes,
    keptAt: link.createdAt,
    caption: meta.caption,
    tags: meta.tags,
    generationPromptExcerpt: extractPromptExcerpt(link.extractedText ?? null),
    linkSummary,
  };
}
