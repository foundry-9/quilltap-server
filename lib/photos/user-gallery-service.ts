/**
 * User photo gallery service.
 *
 * The human user's gallery is a deduped roll-up of every `photos/` folder
 * across the instance — character vaults, project stores, Quilltap General,
 * Quilltap Uploads. Whenever an image is saved (via `keep_image`, the Salon
 * Save-Image dialog, or the legacy "save to my gallery" button) it lands in
 * some mount point's `photos/` folder; this service surfaces them all under
 * one roof on `/photos`, deduped by sha256 so the same bytes appearing in
 * multiple albums show as a single card with a "linked in N places" badge.
 *
 * The save path still piggy-backs on `linkBlobContent` — same content-
 * addressed hard-link plumbing the rest of the photo system uses — and
 * writes into the Quilltap Uploads mount when called directly. The list
 * path, however, is now mount-agnostic.
 *
 * @module photos/user-gallery-service
 */

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
    linkedByName: USER_LINKED_BY_NAME,
    linkedById: userId,
    linkedByRole: 'user',
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
 * List the user's gallery entries — every `photos/` link across every
 * enabled mount point, deduped by sha256. With `query` set, ranks by
 * semantic similarity over the saved markdown (prompt + scene + caption +
 * tags); otherwise returns most-recent first.
 *
 * Each entry surfaces the *primary* link (the most recently created one for
 * a given sha256) plus the full link-summary so the UI can show how many
 * other places the same bytes live and which characters/projects own them.
 */
export async function listUserGallery(
  input: ListUserGalleryInput
): Promise<ListUserGalleryOutput> {
  const { query, tags, limit, offset, userId, repos } = input;

  const effectiveLimit = Math.max(1, Math.min(limit ?? DEFAULT_LIMIT, 200));
  const effectiveOffset = Math.max(0, offset ?? 0);

  // 1. Fan out across every enabled mount point and collect links whose
  //    relativePath lives under `photos/`. Quilltap is single-user, so we
  //    don't filter by userId at the link layer.
  const mountPoints = await repos.docMountPoints.findEnabled();
  const allPhotoLinks: Array<{
    link: Awaited<ReturnType<typeof repos.docMountFileLinks.findByMountPointId>>[number];
    mountPointId: string;
  }> = [];
  for (const mp of mountPoints) {
    const links = await repos.docMountFileLinks.findByMountPointId(mp.id);
    for (const link of links) {
      if (isPhotosRelativePath(link.relativePath)) {
        allPhotoLinks.push({ link, mountPointId: mp.id });
      }
    }
  }

  if (allPhotoLinks.length === 0) {
    return { entries: [], total: 0, hasMore: false };
  }

  // 2. Dedupe by sha256. For each unique image, keep the most recently
  //    created link as the "primary" — that's the one whose mount + path
  //    drive the displayed thumbnail and the user-facing remove action.
  const bySha = new Map<string, { primary: typeof allPhotoLinks[number]; relevance?: number }>();
  for (const entry of allPhotoLinks) {
    const existing = bySha.get(entry.link.sha256);
    if (!existing || entry.link.createdAt.localeCompare(existing.primary.link.createdAt) > 0) {
      bySha.set(entry.link.sha256, { primary: entry });
    }
  }

  // 3. Rank. With a query, run semantic search across every mount with at
  //    least one photo link, constrained to `photos/`. Map scores back to
  //    sha256 via the primary link's relativePath. Without a query, sort
  //    by keptAt desc.
  let ranked: Array<{ sha256: string; primary: typeof allPhotoLinks[number]; relevance?: number }> = [];

  if (query && query.trim().length > 0) {
    const photoMountIds = Array.from(new Set(allPhotoLinks.map(e => e.mountPointId)));
    const queryEmbedding = await generateEmbeddingForUser(query, userId);
    const hits = await searchDocumentChunks(queryEmbedding.embedding, {
      mountPointIds: photoMountIds,
      pathPrefix: `${PHOTOS_FOLDER}/`,
      query,
      applyLiteralPhraseBoost: true,
      limit: effectiveLimit * 8,
    });
    // Build (mountPointId, lowerRelativePath) -> score so we can match the
    // primary link back exactly. Photos with the same caption text across
    // two mounts would otherwise collide on path alone.
    const byKey = new Map<string, number>();
    for (const hit of hits) {
      const key = `${hit.mountPointId}::${hit.relativePath.toLowerCase()}`;
      const prior = byKey.get(key);
      if (prior === undefined || hit.score > prior) byKey.set(key, hit.score);
    }
    for (const [sha256, { primary }] of bySha) {
      // Match against any of the linker rows so a hit in any vault counts.
      let best: number | undefined;
      for (const entry of allPhotoLinks) {
        if (entry.link.sha256 !== sha256) continue;
        const score = byKey.get(`${entry.mountPointId}::${entry.link.relativePath.toLowerCase()}`);
        if (score !== undefined && (best === undefined || score > best)) {
          best = score;
        }
      }
      if (best !== undefined) {
        ranked.push({ sha256, primary, relevance: best });
      }
    }
    ranked.sort((a, b) => (b.relevance ?? 0) - (a.relevance ?? 0));

    // Cosine similarity has a per-corpus noise floor — random gibberish like
    // "asdfasdf" still scores ~0.55-0.60 against image-prompt embeddings, so
    // the default 0.3 minScore lets thousands of false-positive hits through.
    // Real semantic matches peak distinctly above the noise: e.g. "wardrobe"
    // tops 0.84, "covenant" tops 0.78. Two-stage gate:
    //   1. If the top score is below SEMANTIC_PEAK_GATE, treat the query as
    //      noise and return zero results.
    //   2. Otherwise keep results within SEMANTIC_TRAIL_BAND of the top
    //      score (so the long tail of marginal hits doesn't bloat the page).
    const SEMANTIC_PEAK_GATE = 0.65;
    const SEMANTIC_TRAIL_BAND = 0.2;
    const topScore = ranked[0]?.relevance ?? 0;
    if (topScore < SEMANTIC_PEAK_GATE) {
      ranked = [];
    } else {
      const cutoff = topScore - SEMANTIC_TRAIL_BAND;
      ranked = ranked.filter(r => (r.relevance ?? 0) >= cutoff);
    }
  } else {
    ranked = Array.from(bySha.entries()).map(([sha256, { primary }]) => ({ sha256, primary }));
    ranked.sort((a, b) => b.primary.link.createdAt.localeCompare(a.primary.link.createdAt));
  }

  // 4. Apply optional tag filter. Tags are pulled from kept-image
  //    frontmatter on the primary link; if a non-primary link has different
  //    tags they're still visible via the link-summary expansion in the UI.
  const filtered: typeof ranked = [];
  for (const candidate of ranked) {
    const meta = parseKeptImageFrontmatter(candidate.primary.link.extractedText ?? null);
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
  for (const { primary, relevance } of page) {
    const meta = parseKeptImageFrontmatter(primary.link.extractedText ?? null);
    const linkSummary = await getPhotoLinkSummaryBySha256(primary.link.sha256, repos);
    const blobUrl = `/api/v1/mount-points/${primary.mountPointId}/blobs/${encodeURI(primary.link.relativePath)}`;
    entries.push({
      linkId: primary.link.id,
      mountPointId: primary.mountPointId,
      relativePath: primary.link.relativePath,
      fileName: primary.link.fileName,
      blobUrl,
      mimeType: primary.link.originalMimeType ?? 'image/webp',
      sha256: primary.link.sha256,
      fileSizeBytes: primary.link.fileSizeBytes,
      keptAt: primary.link.createdAt,
      caption: meta.caption,
      tags: meta.tags,
      generationPromptExcerpt: extractPromptExcerpt(primary.link.extractedText ?? null),
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
 *
 * /photos surfaces every `photos/` link across every enabled mount, so the
 * removal target may live in a character vault, a project store, Quilltap
 * General, or Quilltap Uploads — we accept any of them, as long as the
 * link's relativePath is under `photos/`.
 */
export async function removeFromUserGallery(
  input: RemoveFromUserGalleryInput
): Promise<{ deleted: boolean; fileGC: boolean }> {
  const { linkId, repos } = input;
  const link = await repos.docMountFileLinks.findByIdWithContent(linkId);
  if (!link) return { deleted: false, fileGC: false };
  if (!isPhotosRelativePath(link.relativePath)) {
    throw new Error('Link is not a gallery entry');
  }
  const result = await repos.docMountFileLinks.deleteWithGC(linkId);
  invalidateMountPoint(link.mountPointId);
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
  const link = await repos.docMountFileLinks.findByIdWithContent(linkId);
  if (!link) return null;
  if (!isPhotosRelativePath(link.relativePath)) return null;
  const meta = parseKeptImageFrontmatter(link.extractedText ?? null);
  const linkSummary = await getPhotoLinkSummaryBySha256(link.sha256, repos);
  return {
    linkId: link.id,
    mountPointId: link.mountPointId,
    relativePath: link.relativePath,
    fileName: link.fileName,
    blobUrl: `/api/v1/mount-points/${link.mountPointId}/blobs/${encodeURI(link.relativePath)}`,
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
