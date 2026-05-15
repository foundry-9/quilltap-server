/**
 * Auto-describe chat image attachments.
 *
 * When a user uploads an image into a chat, this orchestrator runs it
 * through the configured vision profile (with the uncensored fallback wired
 * up in `generateImageDescription`) and persists the result in three places
 * so the description is later useful to:
 *
 *  - **FileEntry.description** — the legacy image-v2 row gains a free-form
 *    description that the UI can show on hover, in the gallery, and in
 *    exports.
 *  - **doc_mount_file_links.description** — every "blank" hard link to the
 *    same bytes (chat upload, project upload, etc.) gets the description as
 *    its per-mount text. Kept-image links carry rich Markdown and are left
 *    alone.
 *  - **chunks + embeddings** — the description is chunked, written into the
 *    mount-index chunks table, and queued for embedding so search ("the
 *    photo of the kettle on the windowsill") surfaces the image even though
 *    it's not a text document.
 *
 * The function is fire-and-forget from the upload path: callers should
 * `void autoDescribeChatImageAttachment(...)` and not await the result —
 * vision calls take 5-15 seconds and shouldn't block the upload response.
 *
 * @module photos/auto-describe-attachment
 */

import { createServiceLogger } from '@/lib/logging/create-logger';
import { fileStorageManager } from '@/lib/file-storage/manager';
import { generateImageDescription } from '@/lib/chat/file-attachment-fallback';
import { chunkAndInsertExtractedText } from './chunk-extracted-text';
import { sha256OfString } from './keep-image-markdown';
import { enqueueEmbeddingJobsForMountPoint } from '@/lib/mount-index/embedding-scheduler';
import type { getRepositories } from '@/lib/database/repositories';
import type { FileAttachment } from '@/lib/llm/base';

const logger = createServiceLogger('Photos:AutoDescribe');

export interface AutoDescribeInput {
  fileEntryId: string;
  userId: string;
  repos: ReturnType<typeof getRepositories>;
}

export interface AutoDescribeOutput {
  describedFileEntry: boolean;
  linksUpdated: number;
  description: string | null;
  /** Reason a non-success result returned without persisting anything. */
  skipReason?:
    | 'not-found'
    | 'not-image'
    | 'no-sha'
    | 'no-bytes'
    | 'describe-failed'
    | 'already-described';
}

const EMPTY_RESULT: AutoDescribeOutput = {
  describedFileEntry: false,
  linksUpdated: 0,
  description: null,
};

/**
 * Run the describe pipeline for a single FileEntry. Safe to call repeatedly
 * — when the FileEntry already carries a description, the call short-circuits
 * before invoking the vision LLM.
 */
export async function autoDescribeChatImageAttachment(
  input: AutoDescribeInput
): Promise<AutoDescribeOutput> {
  const { fileEntryId, userId, repos } = input;

  const entry = await repos.files.findById(fileEntryId);
  if (!entry) {
    logger.debug('auto-describe: FileEntry not found', { fileEntryId });
    return { ...EMPTY_RESULT, skipReason: 'not-found' };
  }
  if (!entry.mimeType.startsWith('image/')) {
    return { ...EMPTY_RESULT, skipReason: 'not-image' };
  }
  if (!entry.sha256) {
    return { ...EMPTY_RESULT, skipReason: 'no-sha' };
  }
  if (entry.description && entry.description.trim().length > 0) {
    logger.debug('auto-describe: FileEntry already has a description', {
      fileEntryId,
      descriptionLength: entry.description.length,
    });
    return { ...EMPTY_RESULT, skipReason: 'already-described' };
  }

  let buffer: Buffer;
  try {
    buffer = await fileStorageManager.downloadFile(entry);
  } catch (error) {
    logger.warn('auto-describe: failed to read bytes for FileEntry', {
      fileEntryId,
      error: error instanceof Error ? error.message : String(error),
    });
    return { ...EMPTY_RESULT, skipReason: 'no-bytes' };
  }

  const fileAttachment: FileAttachment = {
    id: entry.id,
    filepath: `/api/v1/files/${entry.id}`,
    filename: entry.originalFilename,
    mimeType: entry.mimeType,
    size: entry.size,
    data: buffer.toString('base64'),
  };

  const result = await generateImageDescription(fileAttachment, repos, userId);
  if (result.type !== 'image_description' || !result.imageDescription) {
    logger.info('auto-describe: vision describe did not produce a description', {
      fileEntryId,
      type: result.type,
      error: result.error,
    });
    return { ...EMPTY_RESULT, skipReason: 'describe-failed' };
  }

  const description = result.imageDescription.trim();
  const updatedEntry = await repos.files.update(fileEntryId, { description });
  const describedFileEntry = !!updatedEntry;

  // Update every "blank" hard link to these bytes — chat uploads, project
  // uploads, etc. — with the description as both per-mount metadata
  // (`description`) and per-mount text (`extractedText`). Kept-image links
  // already carry rich Markdown and are left untouched.
  const file = await repos.docMountFiles.findBySha256(entry.sha256);
  let linksUpdated = 0;
  const touchedMountPoints = new Set<string>();
  if (file) {
    const links = await repos.docMountFileLinks.findByFileId(file.id);
    const extractedTextSha256 = sha256OfString(description);
    const now = new Date().toISOString();
    for (const link of links) {
      const hasExtractedText = (link.extractedText ?? '').trim().length > 0;
      if (hasExtractedText) continue;
      try {
        await repos.docMountFileLinks.update(link.id, {
          description,
          descriptionUpdatedAt: now,
          extractedText: description,
          extractedTextSha256,
          extractionStatus: 'converted',
        });
        await chunkAndInsertExtractedText({
          linkId: link.id,
          mountPointId: link.mountPointId,
          extractedText: description,
          repos,
        });
        touchedMountPoints.add(link.mountPointId);
        linksUpdated += 1;
      } catch (error) {
        logger.warn('auto-describe: failed to update link', {
          fileEntryId,
          linkId: link.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  // Queue embedding generation for every mount we wrote chunks into so the
  // new text becomes searchable.
  for (const mountPointId of touchedMountPoints) {
    try {
      await enqueueEmbeddingJobsForMountPoint(mountPointId);
    } catch (error) {
      logger.warn('auto-describe: failed to enqueue embedding for mount', {
        mountPointId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  logger.info('auto-describe: completed', {
    fileEntryId,
    linksUpdated,
    descriptionLength: description.length,
    usedUncensoredFallback: result.processingMetadata?.usedUncensoredFallback ?? false,
  });

  return {
    describedFileEntry,
    linksUpdated,
    description,
  };
}
