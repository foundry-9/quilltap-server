/**
 * Shared "save an image into a photo album" service.
 *
 * One service backs both the `keep_image` LLM tool and the Salon's
 * Save-Image toolbar button. Given any `doc_mount_point` id, an image-v2
 * file id, and an attribution (who is saving it), it:
 *
 *   - dedupes by sha256 within the target mount's `photos/` folder
 *   - reads the image bytes
 *   - builds the kept-image Markdown sidecar (prompt, scene snapshot, attribution)
 *   - hard-links the binary into `<mount>/photos/<ts>-<slug>.<ext>` via `linkBlobContent`
 *   - chunks the markdown for vault search
 *   - invalidates caches, emits events, enqueues embeddings
 *
 * Character-vault saves (`keep_image`) and ad-hoc UI saves (project album,
 * linked document store, Quilltap General) all flow through this single
 * codepath so the on-disk artifact is identical regardless of origin.
 *
 * @module photos/save-image-to-album
 */

import { logger } from '@/lib/logger';
import { getRepositories } from '@/lib/database/repositories';
import { SceneStateSchema } from '@/lib/schemas/chat.types';
import { ensureFolderPath } from '@/lib/mount-index/folder-paths';
import { emitDocumentWritten } from '@/lib/mount-index/db-store-events';
import { invalidateMountPoint } from '@/lib/mount-index/mount-chunk-cache';
import { enqueueEmbeddingJobsForMountPoint } from '@/lib/mount-index/embedding-scheduler';
import { resolveUniqueRelativePath } from '@/lib/file-storage/bridge-path-helpers';
import {
  buildKeptImageMarkdown,
  buildSlugAndFilename,
  sha256OfString,
  basenameOfRelativePath,
  type KeptImageAttributionRole,
} from './keep-image-markdown';
import { chunkAndInsertExtractedText } from './chunk-extracted-text';
import { buildPhotosRelativePath, isPhotosRelativePath, PHOTOS_FOLDER } from './photos-paths';

export interface SaveImageAttribution {
  /** Display name of whoever is saving (character name, user persona name, or "Quilltap"). */
  name: string;
  /** Optional id matching `name` — characterId, participantId, userId, or null. */
  id: string | null;
  role: KeptImageAttributionRole;
}

export interface SaveImageToAlbumInput {
  /** Any `doc_mount_point` id — character vault, project store, Quilltap General, etc. */
  mountPointId: string;
  /** image-v2 FileEntry id to save. */
  fileId: string;
  caption?: string | null;
  tags?: string[];
  /** When provided, the chat's `sceneState` is snapshotted into the markdown sidecar. */
  chatId?: string | null;
  attribution: SaveImageAttribution;
}

export interface SaveImageToAlbumOutput {
  /** Mount-point display name where the photo now lives. */
  mountPointName: string;
  /** Final path inside that mount, e.g. "photos/2026-05-14T07-22-33.000Z-foo.webp". */
  relativePath: string;
  /** UUID of the new doc_mount_file_links row. */
  linkId: string;
  /** ISO timestamp of the save. */
  keptAt: string;
  /** Image-v2 FileEntry id that was saved (mirrors the input). */
  fileId: string;
  /** SHA-256 of the image binary. */
  sha256: string;
}

export type SaveImageErrorCode =
  | 'IMAGE_NOT_FOUND'
  | 'NOT_AN_IMAGE'
  | 'EMPTY_BYTES'
  | 'MOUNT_NOT_FOUND'
  | 'ALREADY_SAVED';

export class SaveImageToAlbumError extends Error {
  readonly code: SaveImageErrorCode;
  /** Existing relativePath when `code === 'ALREADY_SAVED'`. */
  readonly existingRelativePath?: string;
  /** Existing createdAt when `code === 'ALREADY_SAVED'`. */
  readonly existingCreatedAt?: string;
  constructor(code: SaveImageErrorCode, message: string, extras?: { existingRelativePath?: string; existingCreatedAt?: string }) {
    super(message);
    this.code = code;
    this.existingRelativePath = extras?.existingRelativePath;
    this.existingCreatedAt = extras?.existingCreatedAt;
  }
}

async function findExistingPhotosLinkBySha(
  mountPointId: string,
  sha256: string
): Promise<{ id: string; relativePath: string; createdAt: string } | null> {
  const repos = getRepositories();
  const links = await repos.docMountFileLinks.findByMountPointId(mountPointId);
  const collision = links.find(
    l => l.sha256 === sha256 && isPhotosRelativePath(l.relativePath)
  );
  if (!collision) return null;
  return {
    id: collision.id,
    relativePath: collision.relativePath,
    createdAt: collision.createdAt,
  };
}

/**
 * Save an image into the `photos/` folder of any mount point.
 *
 * Throws `SaveImageToAlbumError` for the expected failure modes
 * (missing image, missing mount, dedup collision, empty bytes). The
 * caller decides whether to surface those as user-facing errors.
 */
export async function saveImageToAlbum(
  input: SaveImageToAlbumInput
): Promise<SaveImageToAlbumOutput> {
  const { mountPointId, fileId, caption = null, tags = [], chatId = null, attribution } = input;

  // Lazy-import images-v2 so the photos module doesn't pull sharp/webp into
  // unrelated consumers' module load (mirrors the pattern in keep_image).
  const { getImageById, readImageBuffer } = await import('@/lib/images-v2');

  const fileEntry = await getImageById(fileId);
  if (!fileEntry) {
    throw new SaveImageToAlbumError('IMAGE_NOT_FOUND', `Image not found: ${fileId}`);
  }
  if (fileEntry.category !== 'IMAGE') {
    throw new SaveImageToAlbumError(
      'NOT_AN_IMAGE',
      `File ${fileId} is not an image (category=${fileEntry.category})`
    );
  }

  const repos = getRepositories();
  const mountPoint = await repos.docMountPoints.findById(mountPointId);
  if (!mountPoint) {
    throw new SaveImageToAlbumError('MOUNT_NOT_FOUND', `Mount point not found: ${mountPointId}`);
  }

  const collision = await findExistingPhotosLinkBySha(mountPointId, fileEntry.sha256);
  if (collision) {
    throw new SaveImageToAlbumError(
      'ALREADY_SAVED',
      `Image already saved to ${mountPoint.name} on ${collision.createdAt} as ${collision.relativePath}`,
      { existingRelativePath: collision.relativePath, existingCreatedAt: collision.createdAt }
    );
  }

  let buffer: Buffer;
  try {
    buffer = await readImageBuffer(fileEntry.id);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new SaveImageToAlbumError('EMPTY_BYTES', `Failed to read image bytes: ${msg}`);
  }
  if (!buffer || buffer.length === 0) {
    throw new SaveImageToAlbumError('EMPTY_BYTES', `Image ${fileId} has empty bytes`);
  }

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
        logger.warn('[saveImageToAlbum] sceneState failed schema validation; using placeholder', {
          chatId,
          error: parseResult.error.message,
        });
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
    linkedByName: attribution.name,
    linkedById: attribution.id,
    linkedByRole: attribution.role,
    tags,
    caption,
    keptAt,
  });
  const extractedTextSha256 = sha256OfString(markdown);

  const { filename } = buildSlugAndFilename({
    caption,
    generationPrompt: fileEntry.generationPrompt ?? null,
    mimeType: fileEntry.mimeType,
    keptAt,
  });
  const desiredPath = buildPhotosRelativePath(filename);
  const relativePath = await resolveUniqueRelativePath(mountPointId, desiredPath);
  const folderId = await ensureFolderPath(mountPointId, PHOTOS_FOLDER);

  const { link } = await repos.docMountFileLinks.linkBlobContent({
    mountPointId,
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
    mountPointId,
    extractedText: markdown,
    repos,
  });

  invalidateMountPoint(mountPointId);
  emitDocumentWritten({ mountPointId, relativePath });
  enqueueEmbeddingJobsForMountPoint(mountPointId).catch(err => {
    logger.warn('[saveImageToAlbum] failed to enqueue embedding jobs', {
      mountPointId,
      error: err instanceof Error ? err.message : String(err),
    });
  });
  repos.docMountPoints.refreshStats(mountPointId).catch(() => { /* best-effort */ });

  logger.info('[saveImageToAlbum] saved', {
    fileEntryId: fileEntry.id,
    sha256: fileEntry.sha256,
    linkId: link.id,
    mountPointId,
    mountPointName: mountPoint.name,
    relativePath,
    role: attribution.role,
    attributionId: attribution.id,
  });

  return {
    mountPointName: mountPoint.name,
    relativePath,
    linkId: link.id,
    keptAt,
    fileId: fileEntry.id,
    sha256: fileEntry.sha256,
  };
}
