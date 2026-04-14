/**
 * Mount Point Scanner
 *
 * Core service that orchestrates scanning a single document mount point.
 * Walks the filesystem under the mount point's basePath, applies include/exclude
 * patterns, detects new/modified/deleted files, converts them to plain text,
 * chunks the text, and persists the results to the mount index database.
 *
 * Embedding jobs are NOT enqueued here — the scan runner handles that after
 * scanning completes, to avoid overwhelming the job queue during large scans.
 *
 * @module mount-index/scanner
 */

import path from 'path';
import fs from 'fs/promises';
import { createServiceLogger } from '@/lib/logging/create-logger';
import { computeSha256 } from '@/lib/file-storage/scanner';
import { getRepositories } from '@/lib/repositories/factory';
import { convertToPlainText } from './converters';
import { chunkDocument } from './chunker';
import { DocMountPoint } from '@/lib/schemas/mount-index.types';

const logger = createServiceLogger('MountIndex:Scanner');

export interface ScanResult {
  mountPointId: string;
  filesScanned: number;
  filesNew: number;
  filesModified: number;
  filesDeleted: number;
  chunksCreated: number;
  errors: string[];
}

/**
 * Detect file type from extension.
 *
 * @param filePath - File path (relative or absolute)
 * @returns The logical file type, or null if not supported
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
 * Check if a relative path matches a glob-like pattern (simple implementation).
 * Supports:
 *  - `*.md`, `*.txt` — file extension matching
 *  - `.git`, `node_modules` — directory/file name matching against any path segment
 *
 * @param relativePath - Path relative to the mount point basePath
 * @param pattern      - The include/exclude pattern
 * @returns True if the path matches the pattern
 */
function matchesPattern(relativePath: string, pattern: string): boolean {
  if (pattern.startsWith('*.')) {
    // File extension match — compare the suffix after the '*'
    return relativePath.endsWith(pattern.substring(1));
  }
  // Directory/file name match — check if any path segment matches exactly
  const segments = relativePath.split(path.sep);
  return segments.some(seg => seg === pattern);
}

/**
 * Recursively walk a directory, yielding files that match include patterns
 * and don't match exclude patterns. Symlinks are skipped.
 *
 * @param basePath        - Absolute root path of the mount point
 * @param includePatterns - Glob-like patterns for files to include
 * @param excludePatterns - Glob-like patterns for files/directories to exclude
 * @param currentRelative - Current relative path from basePath (for recursion)
 * @returns Array of { relativePath, absolutePath } for matching files
 */
async function walkDirectory(
  basePath: string,
  includePatterns: string[],
  excludePatterns: string[],
  currentRelative: string = ''
): Promise<{ relativePath: string; absolutePath: string }[]> {
  const results: { relativePath: string; absolutePath: string }[] = [];
  const currentAbsolute = currentRelative
    ? path.join(basePath, currentRelative)
    : basePath;

  let entries;
  try {
    entries = await fs.readdir(currentAbsolute, { withFileTypes: true });
  } catch (err) {
    logger.warn('Unable to read directory during walk', {
      path: currentAbsolute,
      error: err instanceof Error ? err.message : String(err),
    });
    return results;
  }

  for (const entry of entries) {
    const relativePath = currentRelative
      ? path.join(currentRelative, entry.name)
      : entry.name;

    // Skip symlinks entirely
    if (entry.isSymbolicLink()) {
      logger.debug('Skipping symlink', { relativePath });
      continue;
    }

    // Check exclude patterns against directory/file names
    if (excludePatterns.some(pattern => matchesPattern(relativePath, pattern))) {
      logger.debug('Excluding path by pattern', { relativePath });
      continue;
    }

    if (entry.isDirectory()) {
      // Recurse into subdirectories
      const subResults = await walkDirectory(basePath, includePatterns, excludePatterns, relativePath);
      results.push(...subResults);
    } else if (entry.isFile()) {
      // Check include patterns — file must match at least one
      if (includePatterns.length === 0 || includePatterns.some(pattern => matchesPattern(relativePath, pattern))) {
        results.push({
          relativePath,
          absolutePath: path.join(basePath, relativePath),
        });
      }
    }
  }

  return results;
}

/**
 * Scan a single mount point: walk the filesystem, detect changes,
 * convert files to plain text, chunk, and persist to the database.
 *
 * @param mountPoint - The mount point configuration to scan
 * @returns ScanResult with counts and any errors encountered
 */
export async function scanMountPoint(mountPoint: DocMountPoint): Promise<ScanResult> {
  const repos = getRepositories();
  const result: ScanResult = {
    mountPointId: mountPoint.id,
    filesScanned: 0,
    filesNew: 0,
    filesModified: 0,
    filesDeleted: 0,
    chunksCreated: 0,
    errors: [],
  };

  logger.info('Starting mount point scan', {
    mountPointId: mountPoint.id,
    basePath: mountPoint.basePath,
    name: mountPoint.name,
  });

  // 1. Update scan status to 'scanning'
  await repos.docMountPoints.updateScanStatus(mountPoint.id, 'scanning');

  try {
    // 2. Walk filesystem to get all matching files
    const filesOnDisk = await walkDirectory(
      mountPoint.basePath,
      mountPoint.includePatterns,
      mountPoint.excludePatterns
    );
    result.filesScanned = filesOnDisk.length;

    logger.debug('Filesystem walk complete', {
      mountPointId: mountPoint.id,
      filesFound: filesOnDisk.length,
    });

    // 3. Get existing files from database for this mount point
    const existingFiles = await repos.docMountFiles.findByMountPointId(mountPoint.id);
    const existingByPath = new Map(existingFiles.map(f => [f.relativePath, f]));

    // 4. Track which paths we see on disk (for stale detection)
    const seenPaths = new Set<string>();

    // 5. Process each file on disk
    for (const { relativePath, absolutePath } of filesOnDisk) {
      seenPaths.add(relativePath);
      const fileType = detectFileType(relativePath);
      if (!fileType) continue;

      try {
        const sha256 = await computeSha256(absolutePath);
        const existing = existingByPath.get(relativePath);

        if (existing && existing.sha256 === sha256) {
          // File unchanged — skip
          logger.debug('File unchanged, skipping', { relativePath, sha256 });
          continue;
        }

        // File is new or modified
        const stat = await fs.stat(absolutePath);

        // Convert to plain text
        const plainText = await convertToPlainText(absolutePath, fileType);
        if (!plainText || plainText.trim().length === 0) {
          logger.debug('File conversion produced no text, skipping', { relativePath });
          continue;
        }

        // Chunk the text
        const chunks = chunkDocument(plainText);

        if (existing) {
          // File is modified — delete old chunks first, then update file record
          await repos.docMountChunks.deleteByFileId(existing.id);
          await repos.docMountFiles.update(existing.id, {
            sha256,
            fileSizeBytes: stat.size,
            lastModified: stat.mtime.toISOString(),
            conversionStatus: 'converted',
            conversionError: null,
            plainTextLength: plainText.length,
            chunkCount: chunks.length,
          });
          result.filesModified++;
          logger.debug('File modified, updated record', { relativePath, chunkCount: chunks.length });
        } else {
          // File is new — create file record
          await repos.docMountFiles.create({
            mountPointId: mountPoint.id,
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
          result.filesNew++;
          logger.debug('New file indexed', { relativePath, chunkCount: chunks.length });
        }

        // Get the file record (either just created or updated)
        const fileRecord = await repos.docMountFiles.findByMountPointAndPath(
          mountPoint.id,
          relativePath
        );
        if (!fileRecord) {
          logger.warn('Could not retrieve file record after create/update', { relativePath });
          continue;
        }

        // Insert chunks
        const chunkData = chunks.map(chunk => ({
          fileId: fileRecord.id,
          mountPointId: mountPoint.id,
          chunkIndex: chunk.chunkIndex,
          content: chunk.content,
          tokenCount: chunk.tokenCount,
          headingContext: chunk.headingContext,
          embedding: null,
        }));

        if (chunkData.length > 0) {
          await repos.docMountChunks.bulkInsert(chunkData);
          result.chunksCreated += chunkData.length;
        }

        // NOTE: Embedding jobs will be enqueued by the scan runner after scanning
        // completes to avoid overwhelming the job queue during large scans

      } catch (fileError) {
        const errorMsg = fileError instanceof Error ? fileError.message : String(fileError);
        logger.warn('Error processing file during mount scan', {
          relativePath,
          error: errorMsg,
        });
        result.errors.push(`${relativePath}: ${errorMsg}`);

        // Try to mark the file as failed if it exists in DB
        const existing = existingByPath.get(relativePath);
        if (existing) {
          await repos.docMountFiles.update(existing.id, {
            conversionStatus: 'failed',
            conversionError: errorMsg,
          }).catch(() => {});
        }
      }
    }

    // 6. Detect deleted files (in DB but not on disk)
    for (const [existingPath, existingFile] of existingByPath) {
      if (!seenPaths.has(existingPath)) {
        await repos.docMountChunks.deleteByFileId(existingFile.id);
        await repos.docMountFiles.delete(existingFile.id);
        result.filesDeleted++;
        logger.debug('File deleted from index (no longer on disk)', { relativePath: existingPath });
      }
    }

    // 7. Update mount point with scan results
    const totalFiles = await repos.docMountFiles.findByMountPointId(mountPoint.id);
    const totalChunks = totalFiles.reduce((sum, f) => sum + (f.chunkCount || 0), 0);
    const totalSizeBytes = totalFiles.reduce((sum, f) => sum + (f.fileSizeBytes || 0), 0);
    await repos.docMountPoints.updateLastScanned(mountPoint.id, totalFiles.length, totalChunks, totalSizeBytes);

    logger.info('Mount point scan completed', {
      mountPointId: mountPoint.id,
      filesScanned: result.filesScanned,
      filesNew: result.filesNew,
      filesModified: result.filesModified,
      filesDeleted: result.filesDeleted,
      chunksCreated: result.chunksCreated,
      errorCount: result.errors.length,
    });

  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error('Mount point scan failed', {
      mountPointId: mountPoint.id,
      error: errorMsg,
    });
    await repos.docMountPoints.updateScanStatus(mountPoint.id, 'error', errorMsg);
    result.errors.push(`Scan failed: ${errorMsg}`);
  }

  return result;
}
