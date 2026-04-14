/**
 * Single-File Re-indexing
 *
 * Re-indexes a single file within a document store after an edit.
 * Reuses the conversion and chunking logic from the mount index scanner
 * but operates on a single file rather than scanning the entire mount point.
 *
 * Only applies to document_store scope files — project and general files
 * are not tracked in the mount index.
 *
 * @module doc-edit/reindex-file
 */

import path from 'path';
import fs from 'fs/promises';
import { createServiceLogger } from '@/lib/logging/create-logger';
import { computeSha256 } from '@/lib/file-storage/scanner';
import { getRepositories } from '@/lib/repositories/factory';
import { convertToPlainText } from '@/lib/mount-index/converters';
import { chunkDocument } from '@/lib/mount-index/chunker';

const logger = createServiceLogger('DocEdit:ReindexFile');

/**
 * Detect file type from extension (matches scanner.ts logic).
 */
function detectFileType(filePath: string): 'pdf' | 'docx' | 'markdown' | 'txt' | null {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.pdf': return 'pdf';
    case '.docx': return 'docx';
    case '.md': case '.markdown': return 'markdown';
    case '.txt': return 'txt';
    default: return null;
  }
}

/**
 * Re-index a single file after it has been edited.
 *
 * This function:
 * 1. Reads the file from disk
 * 2. Computes its new SHA256 hash
 * 3. Converts to plain text
 * 4. Chunks the text
 * 5. Updates the file record and chunks in the mount index DB
 * 6. Embedding jobs are NOT enqueued here (same pattern as scanner)
 *
 * @param mountPointId - The mount point this file belongs to
 * @param relativePath - Path relative to mount point basePath
 * @param absolutePath - Absolute filesystem path to the file
 */
export async function reindexSingleFile(
  mountPointId: string,
  relativePath: string,
  absolutePath: string
): Promise<void> {
  const repos = getRepositories();

  logger.debug('Re-indexing single file after edit', {
    mountPointId,
    relativePath,
  });

  const fileType = detectFileType(relativePath);
  if (!fileType) {
    logger.debug('File type not indexable, skipping re-index', { relativePath });
    return;
  }

  try {
    // Read file stats and compute hash
    const [stat, sha256] = await Promise.all([
      fs.stat(absolutePath),
      computeSha256(absolutePath),
    ]);

    // Convert to plain text
    const plainText = await convertToPlainText(absolutePath, fileType);
    if (!plainText || plainText.trim().length === 0) {
      logger.debug('File conversion produced no text after edit', { relativePath });
      return;
    }

    // Chunk the text
    const chunks = chunkDocument(plainText);

    // Find existing file record
    const existingFile = await repos.docMountFiles.findByMountPointAndPath(
      mountPointId,
      relativePath
    );

    if (existingFile) {
      // Update existing: delete old chunks, update file record
      await repos.docMountChunks.deleteByFileId(existingFile.id);
      await repos.docMountFiles.update(existingFile.id, {
        sha256,
        fileSizeBytes: stat.size,
        lastModified: stat.mtime.toISOString(),
        conversionStatus: 'converted',
        conversionError: null,
        plainTextLength: plainText.length,
        chunkCount: chunks.length,
      });
    } else {
      // Create new file record (file was created via doc_write_file)
      await repos.docMountFiles.create({
        mountPointId,
        relativePath,
        fileName: path.basename(relativePath),
        fileType,
        sha256,
        fileSizeBytes: stat.size,
        lastModified: stat.mtime.toISOString(),
        conversionStatus: 'converted',
        plainTextLength: plainText.length,
        chunkCount: chunks.length,
      });
    }

    // Get the file record for chunk insertion
    const fileRecord = await repos.docMountFiles.findByMountPointAndPath(
      mountPointId,
      relativePath
    );
    if (!fileRecord) {
      logger.warn('Could not retrieve file record after re-index create/update', { relativePath });
      return;
    }

    // Insert new chunks
    if (chunks.length > 0) {
      const chunkData = chunks.map(chunk => ({
        fileId: fileRecord.id,
        mountPointId,
        chunkIndex: chunk.chunkIndex,
        content: chunk.content,
        tokenCount: chunk.tokenCount,
        headingContext: chunk.headingContext,
        embedding: null,
      }));
      await repos.docMountChunks.bulkInsert(chunkData);
    }

    logger.debug('Single file re-index complete', {
      mountPointId,
      relativePath,
      chunkCount: chunks.length,
    });

    // NOTE: Embedding jobs should be enqueued by the caller if needed,
    // following the same pattern as the scan runner.

  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.warn('Failed to re-index file after edit', {
      mountPointId,
      relativePath,
      error: errorMsg,
    });
    // Non-fatal: the edit succeeded, re-indexing is best-effort
  }
}
