/**
 * The `files` row for a picture already written to a mount.
 *
 * Every image path ends the same way: a storage bridge has put the bytes in a
 * store (a character vault, the Lantern Backgrounds mount, a project store, a
 * wardrobe item's folder) and answered with a storageKey and what it actually
 * stored; the caller then mints the `files` row that gives the picture a URL,
 * a thumbnail and its generation record. This is that row, once.
 *
 * Two rules it keeps for every caller:
 *
 * - **Stored, not sent.** The bridges transcode bitmaps to WebP, so the row's
 *   `mimeType` and `size` are the bridge's `storedMimeType` / `sizeBytes`,
 *   never the input's — a vision provider rejects bytes whose declared type
 *   is wrong ("media_type X but image is Y").
 * - **No label on a generated picture.** `description` is what
 *   `describe_image` and the blind-model fallback read as "what this picture
 *   shows"; a stub such as "Story background for: <title>" shadowed the
 *   prompt and the vision path behind it (bug 132). It is null unless the
 *   caller has a real description to record. The prompt is the account of
 *   record.
 *
 * Dimensions are the ones measured from the stored bytes (see
 * `decodeProviderImage`); providers often return a different shape than was
 * asked for, so a requested size is never recorded.
 *
 * @module files/generated-file-row
 */

import { randomUUID } from 'crypto';
import { logger } from '@/lib/logger';
import type { FileEntry, FileSource } from '@/lib/schemas/file.types';

const LOG_CONTEXT = 'files.generated-file-row';

/** What a storage bridge reports having written. */
export interface StoredImageBytes {
  storageKey: string;
  storedMimeType: string;
  sizeBytes: number;
}

export interface GeneratedFileRowInput {
  userId: string;
  /** Pre-chosen row id; a fresh UUID when omitted. */
  id?: string;
  /** Hash of the stored bytes. */
  sha256: string;
  originalFilename: string;
  stored: StoredImageBytes;
  width?: number | null;
  height?: number | null;
  linkedTo: string[];
  tags?: string[];
  /** Default `'GENERATED'`. */
  source?: FileSource;
  /** The provider-bound prompt, the model that answered, and its revision. */
  generation?: {
    prompt?: string | null;
    model?: string | null;
    revisedPrompt?: string | null;
  };
  /** The avatar configuration cache key; null on every other picture. */
  generationKey?: string | null;
  /** A real description only — never a label (bug 132). Default null. */
  description?: string | null;
  projectId?: string | null;
  folderPath?: string | null;
}

/** The slice of the files repository this needs. */
export interface GeneratedFileRowRepos {
  files: {
    create(
      data: Omit<FileEntry, 'id' | 'createdAt' | 'updatedAt'>,
      options?: { id?: string },
    ): Promise<FileEntry>;
  };
}

/**
 * Create the IMAGE `files` row for a picture the bridge has already stored.
 * Returns the row as created. In the job child the create is buffered and the
 * returned row is synthetic, so callers rely on `input.id`, not the result's.
 */
export async function createGeneratedFileRow(
  repos: GeneratedFileRowRepos,
  input: GeneratedFileRowInput,
): Promise<FileEntry> {
  const id = input.id ?? randomUUID();

  const file = await repos.files.create(
    {
      userId: input.userId,
      sha256: input.sha256,
      originalFilename: input.originalFilename,
      mimeType: input.stored.storedMimeType,
      size: input.stored.sizeBytes,
      width: input.width ?? null,
      height: input.height ?? null,
      linkedTo: input.linkedTo,
      source: input.source ?? 'GENERATED',
      category: 'IMAGE',
      generationPrompt: input.generation?.prompt ?? null,
      generationModel: input.generation?.model ?? null,
      generationRevisedPrompt: input.generation?.revisedPrompt ?? null,
      generationKey: input.generationKey ?? null,
      description: input.description ?? null,
      tags: input.tags ?? [],
      storageKey: input.stored.storageKey,
      projectId: input.projectId ?? null,
      folderPath: input.folderPath ?? null,
    },
    { id },
  );

  logger.debug('[GeneratedFileRow] Created image file row', {
    context: LOG_CONTEXT,
    fileId: id,
    source: input.source ?? 'GENERATED',
    storedMimeType: input.stored.storedMimeType,
    sizeBytes: input.stored.sizeBytes,
    linkedTo: input.linkedTo,
    hasGenerationKey: !!input.generationKey,
  });

  return file;
}
