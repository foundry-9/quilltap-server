/**
 * Filesystem Scanner
 *
 * Walks the files directory and returns inventory of physical files.
 * Used by reconciliation and the files API to show real directory contents.
 *
 * @module file-storage/scanner
 */

import { readdir, stat } from 'fs/promises';
import { createHash } from 'crypto';
import { readFile } from 'fs/promises';
import { join, extname } from 'path';
import { createLogger } from '@/lib/logging/create-logger';

const logger = createLogger('file-storage:scanner');

// ============================================================================
// TYPES
// ============================================================================

export interface ScannedFile {
  /** Path relative to the base files directory */
  relativePath: string;
  /** Filename only */
  name: string;
  /** File size in bytes */
  size: number;
  /** Last modified time */
  mtime: Date;
  /** Whether this entry is a directory */
  isDirectory: boolean;
}

// ============================================================================
// MIME TYPE DETECTION
// ============================================================================

const EXTENSION_MIME_MAP: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.tiff': 'image/tiff',
  '.tif': 'image/tiff',
  '.avif': 'image/avif',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.markdown': 'text/markdown',
  '.html': 'text/html',
  '.htm': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.ts': 'text/typescript',
  '.json': 'application/json',
  '.xml': 'application/xml',
  '.csv': 'text/csv',
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.zip': 'application/zip',
  '.gz': 'application/gzip',
  '.tar': 'application/x-tar',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.avi': 'video/x-msvideo',
};

/**
 * Detect MIME type from filename extension
 */
export function detectMimeType(filename: string): string {
  const ext = extname(filename).toLowerCase();
  return EXTENSION_MIME_MAP[ext] || 'application/octet-stream';
}

// ============================================================================
// SCANNER
// ============================================================================

/** Directories to skip during scanning */
const SKIP_DIRS = new Set(['_thumbnails']);

/** File patterns to skip */
function shouldSkipFile(name: string): boolean {
  return name.startsWith('.') || name.endsWith('.meta.json');
}

/**
 * Directories created by the v4.3 / v4.4 migration sweep as safety-net copies
 * of files that were moved into document-store mounts. The reconciler must not
 * walk them: their contents are not live storage, and their parent-directory
 * names are not parseable as projectIds.
 */
function isMigrationArchiveDir(name: string): boolean {
  return name.endsWith('_doc_store_archive') || name.endsWith('_archive');
}

/**
 * Scan a directory tree relative to a base path.
 *
 * Returns all files and directories found, excluding:
 * - `_thumbnails/` directory
 * - Migration archive directories (`<projectId>_doc_store_archive/` at the top
 *   level, and `*_archive/` siblings under `_general/`)
 * - Hidden files (starting with `.`)
 * - Legacy `.meta.json` sidecar files
 *
 * @param basePath - The root files directory
 * @param relativeTo - Optional subdirectory to scope the scan (relative to basePath)
 * @returns Array of scanned file/directory entries
 */
export async function scanDirectory(
  basePath: string,
  relativeTo?: string
): Promise<ScannedFile[]> {
  const results: ScannedFile[] = [];
  const startDir = relativeTo ? join(basePath, relativeTo) : basePath;
  const prefix = relativeTo || '';

  async function walk(dirPath: string, currentPrefix: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dirPath, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return;
      }
      logger.warn('Error reading directory during scan', {
        dir: dirPath,
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }

    for (const entry of entries) {
      // Skip hidden files and sidecars
      if (shouldSkipFile(entry.name)) {
        continue;
      }

      const relativePath = currentPrefix ? `${currentPrefix}/${entry.name}` : entry.name;
      const fullPath = join(dirPath, entry.name);

      if (entry.isDirectory()) {
        // Skip special directories
        if (SKIP_DIRS.has(entry.name)) {
          continue;
        }
        if (isMigrationArchiveDir(entry.name)) {
          continue;
        }

        try {
          const stats = await stat(fullPath);
          results.push({
            relativePath,
            name: entry.name,
            size: 0,
            mtime: stats.mtime,
            isDirectory: true,
          });
        } catch {
          // Skip inaccessible directories
          continue;
        }

        // Recurse into subdirectory
        await walk(fullPath, relativePath);
      } else if (entry.isFile()) {
        try {
          const stats = await stat(fullPath);
          results.push({
            relativePath,
            name: entry.name,
            size: stats.size,
            mtime: stats.mtime,
            isDirectory: false,
          });
        } catch {
          // Skip inaccessible files
        }
      }
    }
  }

  await walk(startDir, prefix);

  return results;
}

/**
 * Compute SHA-256 hash of a file
 *
 * @param absolutePath - Full path to the file
 * @returns Hex-encoded SHA-256 digest
 */
export async function computeSha256(absolutePath: string): Promise<string> {
  const content = await readFile(absolutePath);
  return createHash('sha256').update(new Uint8Array(content)).digest('hex');
}
