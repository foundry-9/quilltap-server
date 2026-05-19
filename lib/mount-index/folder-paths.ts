/**
 * Mount Index Path Resolution Utilities
 *
 * Utilities for resolving and managing file paths in document stores with
 * explicit folder entities. Used by database-backed stores to navigate,
 * validate, and create folder hierarchies.
 *
 * All paths are POSIX-style with forward slashes, regardless of OS.
 * Root folder is represented as parentId=null or path=''.
 *
 * @module mount-index/folder-paths
 */

import { getRepositories } from '@/lib/repositories/factory';
import { logger } from '@/lib/logger';
import { randomUUID } from 'crypto';
import * as posixPath from 'path/posix';

/**
 * Resolve a file path to its parent folder ID.
 *
 * Splits the path into folderPath (directory) and leafName (filename).
 * Returns folderId=null for root-level files.
 * Throws if an ancestor folder does not exist (intended for read/delete paths
 * where the folder structure must already be in place).
 *
 * @param mountPointId The mount point ID
 * @param path The file path (e.g. 'foo/bar/note.md')
 * @returns Object with folderId, leafName, and folderPath
 * @throws Error if an ancestor folder does not exist
 */
export async function resolvePath(
  mountPointId: string,
  path: string,
): Promise<{ folderId: string | null; leafName: string; folderPath: string }> {
  const normalized = normalizePath(path);
  const dir = posixPath.dirname(normalized);
  const file = posixPath.basename(normalized);

  // Root-level file: parentId = null
  if (dir === '.') {
    return {
      folderId: null,
      leafName: file,
      folderPath: '',
    };
  }

  // Look up the folder
  const repos = await getRepositories();
  const folder = await repos.docMountFolders.findByMountPointAndPath(mountPointId, dir);

  if (!folder) {
    const msg = `Ancestor folder does not exist: mountPointId=${mountPointId}, folderPath=${dir}`;
    logger.warn(msg);
    throw new Error(msg);
  }

  return {
    folderId: folder.id,
    leafName: file,
    folderPath: dir,
  };
}

/**
 * Build the full folder path by traversing from a folder up to the root.
 *
 * For root folder (folderId=null), returns ''.
 * For nested folders, concatenates segments from the denormalised `path` column.
 * This is an O(1) operation if the folder's path is already denormalised.
 *
 * @param folderId The folder ID (null for root)
 * @returns The full relative path ('' for root)
 */
export async function buildPath(folderId: string | null): Promise<string> {
  if (!folderId) {
    return '';
  }

  const repos = await getRepositories();
  const folder = await repos.docMountFolders.findById(folderId);

  if (!folder) {
    const msg = `Folder not found: folderId=${folderId}`;
    logger.warn(msg);
    throw new Error(msg);
  }

  return folder.path;
}

/**
 * Idempotently create all missing folder segments along a path.
 *
 * `folderPath` is the directory path only (not including a filename).
 * Empty string means root and returns null.
 * Otherwise walks from root, creating missing segments, and returns the leaf folder ID.
 *
 * Transaction-safe under concurrent calls via ON CONFLICT DO NOTHING semantics:
 * if a segment already exists, the create fails gracefully and we look it up.
 *
 * @param mountPointId The mount point ID
 * @param folderPath The directory path ('' for root; e.g. 'foo/bar')
 * @returns The leaf folder ID, or null for root
 */
export async function ensureFolderPath(
  mountPointId: string,
  folderPath: string,
): Promise<string | null> {
  const normalized = normalizePath(folderPath);

  // Empty path = root
  if (!normalized) {
    return null;
  }

  const repos = await getRepositories();
  const segments = normalized.split('/').filter(s => s.length > 0);

  let currentParentId: string | null = null;
  let currentPath = '';

  for (const segment of segments) {
    // Build the path for this segment
    currentPath = currentPath ? `${currentPath}/${segment}` : segment;

    // Try to find the existing folder
    let folder = await repos.docMountFolders.findByMountPointAndPath(mountPointId, currentPath);

    if (!folder) {
      // Create it if it doesn't exist
      try {
        folder = await repos.docMountFolders.create({
          mountPointId,
          parentId: currentParentId,
          name: segment,
          path: currentPath,
        });
      } catch (error) {
        // On conflict (concurrent creation), look it up
        const existing = await repos.docMountFolders.findByMountPointAndPath(mountPointId, currentPath);
        if (existing) {
          folder = existing;
        } else {
          logger.error('Failed to create or find folder segment', {
            context: 'folder-paths.ensureFolderPath',
            mountPointId,
            segment,
            path: currentPath,
            error: error instanceof Error ? error.message : String(error),
          });
          throw error;
        }
      }
    }

    currentParentId = folder.id;
  }

  return currentParentId;
}

/**
 * Check if a folder has any contents (child folders, documents, or blobs).
 *
 * Returns true if the folder has at least one child folder, document, or blob.
 * Used to determine whether a folder can be safely deleted.
 *
 * @param mountPointId The mount point ID
 * @param folderId The folder ID
 * @returns True if the folder has contents
 */
export async function folderHasContents(
  mountPointId: string,
  folderId: string,
): Promise<boolean> {
  const repos = await getRepositories();

  // Check for child folders
  const childFolders = await repos.docMountFolders.findChildren(mountPointId, folderId);
  if (childFolders.length > 0) {
    return true;
  }

  // Check for any link (file or document) under this folder. Post-refactor
  // folder membership lives on the link row, not on doc_mount_files /
  // doc_mount_documents.
  const links = await repos.docMountFileLinks.findByMountPointId(mountPointId);
  if (links.some(l => l.folderId === folderId)) {
    return true;
  }

  // Check for blobs with this folderId (if repo exists)
  // Note: blobs don't have folderId yet; this is placeholder for completeness
  // and will be revisited in Phase B when blob folder support is added.

  return false;
}

// ============================================================================
// Helper: Path normalization
// ============================================================================

/**
 * Normalize a path to use forward slashes and remove trailing slashes.
 * Does not require the path to exist.
 *
 * @param path The path to normalize
 * @returns The normalized path
 */
function normalizePath(path: string): string {
  // Convert backslashes to forward slashes (Windows paths)
  let normalized = path.replace(/\\/g, '/');

  // Remove trailing slashes
  normalized = normalized.replace(/\/+$/, '');

  // Collapse multiple slashes
  normalized = normalized.replace(/\/+/g, '/');

  return normalized;
}
