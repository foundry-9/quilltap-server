/**
 * Shared helper for writing per-link `extractedText` into the chunk table.
 *
 * The mount-index auto-chunker (`reindexSingleFile`) dispatches by file
 * extension. A kept image is a `.webp` / `.png` link whose extractedText is
 * a Markdown document, so the auto-chunker won't pick it up. Callers that
 * write extractedText directly into a link must therefore re-chunk it
 * themselves, deleting any prior chunks for the link and updating the
 * link's `chunkCount` / `plainTextLength` rollups in one place.
 *
 * @module photos/chunk-extracted-text
 */

import { chunkDocument } from '@/lib/mount-index/chunker';
import type { getRepositories } from '@/lib/database/repositories';
import { createServiceLogger } from '@/lib/logging/create-logger';

const logger = createServiceLogger('Photos:ChunkExtractedText');

export interface ChunkAndInsertInput {
  linkId: string;
  mountPointId: string;
  extractedText: string;
  repos: ReturnType<typeof getRepositories>;
}

export interface ChunkAndInsertOutput {
  chunksCreated: number;
  plainTextLength: number;
}

export async function chunkAndInsertExtractedText(
  input: ChunkAndInsertInput
): Promise<ChunkAndInsertOutput> {
  const { linkId, mountPointId, extractedText, repos } = input;
  const trimmed = extractedText?.trim() ?? '';
  if (trimmed.length === 0) {
    await repos.docMountChunks.deleteByLinkId(linkId);
    await repos.docMountFileLinks.update(linkId, { chunkCount: 0, plainTextLength: 0 });
    return { chunksCreated: 0, plainTextLength: 0 };
  }

  const chunks = chunkDocument(extractedText);
  await repos.docMountChunks.deleteByLinkId(linkId);

  if (chunks.length > 0) {
    await repos.docMountChunks.bulkInsert(
      chunks.map(chunk => ({
        linkId,
        mountPointId,
        chunkIndex: chunk.chunkIndex,
        content: chunk.content,
        tokenCount: chunk.tokenCount,
        headingContext: chunk.headingContext,
        embedding: null,
      }))
    );
  }

  await repos.docMountFileLinks.update(linkId, {
    chunkCount: chunks.length,
    plainTextLength: extractedText.length,
  });

  logger.debug('Chunked extractedText for link', {
    linkId,
    mountPointId,
    chunksCreated: chunks.length,
    plainTextLength: extractedText.length,
  });

  return { chunksCreated: chunks.length, plainTextLength: extractedText.length };
}
