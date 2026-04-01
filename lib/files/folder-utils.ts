/**
 * Folder Path Utilities
 *
 * Helper functions for working with folder paths in the file system.
 * Folder paths follow these conventions:
 * - "/" represents the root folder
 * - Subfolders always start and end with "/" (e.g., "/documents/", "/documents/reports/")
 * - No double slashes
 * - Case-sensitive
 * - No ".." path traversal allowed
 *
 * @module files/folder-utils
 */

import { logger } from '@/lib/logger';
import type { FileEntry } from '@/lib/schemas/file.types';

/**
 * Normalize a folder path to ensure proper format.
 *
 * - Ensures path starts with "/"
 * - Ensures path ends with "/"
 * - Removes duplicate slashes
 * - Removes any ".." segments (security)
 * - Returns "/" for empty or invalid paths
 *
 * @param path - The folder path to normalize
 * @returns Normalized folder path
 */
export function normalizeFolderPath(path: string | undefined | null): string {
  if (!path || path.trim() === '') {
    return '/';
  }

  // Remove any ".." segments for security
  let normalized = path.replace(/\.\./g, '');

  // Ensure starts with /
  if (!normalized.startsWith('/')) {
    normalized = '/' + normalized;
  }

  // Remove duplicate slashes
  normalized = normalized.replace(/\/+/g, '/');

  // Ensure ends with / (unless it's just "/")
  if (normalized !== '/' && !normalized.endsWith('/')) {
    normalized = normalized + '/';
  }

  // If we ended up with just slashes or empty after cleaning, return root
  if (normalized === '' || normalized.replace(/\//g, '') === '') {
    return '/';
  }

  logger.debug('Normalized folder path', {
    context: 'folder-utils',
    originalPath: path,
    normalizedPath: normalized,
  });

  return normalized;
}

/**
 * Get the parent folder path.
 *
 * @param path - The folder path
 * @returns Parent folder path, or "/" if already at root
 *
 * @example
 * getParentPath("/documents/reports/") // returns "/documents/"
 * getParentPath("/documents/") // returns "/"
 * getParentPath("/") // returns "/"
 */
export function getParentPath(path: string): string {
  const normalized = normalizeFolderPath(path);

  if (normalized === '/') {
    return '/';
  }

  // Remove trailing slash, find last slash, return up to and including it
  const withoutTrailing = normalized.slice(0, -1);
  const lastSlashIndex = withoutTrailing.lastIndexOf('/');

  if (lastSlashIndex <= 0) {
    return '/';
  }

  return withoutTrailing.slice(0, lastSlashIndex + 1);
}

/**
 * Get the folder name (last segment) from a path.
 *
 * @param path - The folder path
 * @returns The folder name without slashes
 *
 * @example
 * getFolderName("/documents/reports/") // returns "reports"
 * getFolderName("/documents/") // returns "documents"
 * getFolderName("/") // returns ""
 */
export function getFolderName(path: string): string {
  const normalized = normalizeFolderPath(path);

  if (normalized === '/') {
    return '';
  }

  // Remove trailing slash, split, get last segment
  const withoutTrailing = normalized.slice(0, -1);
  const segments = withoutTrailing.split('/').filter(Boolean);

  return segments[segments.length - 1] || '';
}

/**
 * Get the depth level of a folder path.
 *
 * @param path - The folder path
 * @returns Depth level (0 for root, 1 for top-level folders, etc.)
 *
 * @example
 * getFolderDepth("/") // returns 0
 * getFolderDepth("/documents/") // returns 1
 * getFolderDepth("/documents/reports/") // returns 2
 */
export function getFolderDepth(path: string): number {
  const normalized = normalizeFolderPath(path);

  if (normalized === '/') {
    return 0;
  }

  // Count non-empty segments
  return normalized.split('/').filter(Boolean).length;
}

/**
 * Check if a file is in a specific folder (exact match).
 *
 * @param file - The file entry to check
 * @param folderPath - The folder path to check against
 * @returns True if the file is directly in this folder
 */
export function isInFolder(file: FileEntry, folderPath: string): boolean {
  const normalizedFilePath = normalizeFolderPath(file.folderPath);
  const normalizedFolderPath = normalizeFolderPath(folderPath);

  return normalizedFilePath === normalizedFolderPath;
}

/**
 * Check if a file is in a folder or any of its subfolders (recursive).
 *
 * @param file - The file entry to check
 * @param folderPath - The folder path to check against
 * @returns True if the file is in this folder or a subfolder
 */
export function isInFolderRecursive(file: FileEntry, folderPath: string): boolean {
  const normalizedFilePath = normalizeFolderPath(file.folderPath);
  const normalizedFolderPath = normalizeFolderPath(folderPath);

  // Root folder contains everything
  if (normalizedFolderPath === '/') {
    return true;
  }

  return normalizedFilePath.startsWith(normalizedFolderPath);
}

/**
 * Extract unique folder paths from a list of files.
 *
 * Returns all unique folder paths including parent folders.
 * For example, if files are in "/documents/reports/", this will
 * return both "/documents/" and "/documents/reports/".
 *
 * @param files - Array of file entries
 * @returns Array of unique folder paths, sorted by depth then alphabetically
 */
export function listFolders(files: FileEntry[]): string[] {
  const folders = new Set<string>();

  // Always include root
  folders.add('/');

  for (const file of files) {
    const fileFolderPath = normalizeFolderPath(file.folderPath);

    if (fileFolderPath !== '/') {
      // Add this folder and all parent folders
      let currentPath = fileFolderPath;
      while (currentPath !== '/') {
        folders.add(currentPath);
        currentPath = getParentPath(currentPath);
      }
    }
  }

  // Sort by depth, then alphabetically
  return Array.from(folders).sort((a, b) => {
    const depthA = getFolderDepth(a);
    const depthB = getFolderDepth(b);
    if (depthA !== depthB) {
      return depthA - depthB;
    }
    return a.localeCompare(b);
  });
}

/**
 * Build a folder tree structure from a list of files.
 *
 * @param files - Array of file entries
 * @returns Tree structure with nested children
 */
export interface FolderTreeNode {
  path: string;
  name: string;
  depth: number;
  children: FolderTreeNode[];
  fileCount: number;
}

export function buildFolderTree(files: FileEntry[]): FolderTreeNode {
  const folders = listFolders(files);

  // Count files per folder
  const fileCountMap = new Map<string, number>();
  for (const file of files) {
    const folderPath = normalizeFolderPath(file.folderPath);
    fileCountMap.set(folderPath, (fileCountMap.get(folderPath) || 0) + 1);
  }

  // Build node map
  const nodeMap = new Map<string, FolderTreeNode>();
  for (const path of folders) {
    nodeMap.set(path, {
      path,
      name: getFolderName(path) || 'Root',
      depth: getFolderDepth(path),
      children: [],
      fileCount: fileCountMap.get(path) || 0,
    });
  }

  // Link children to parents
  for (const path of folders) {
    if (path === '/') continue;
    const parentPath = getParentPath(path);
    const parentNode = nodeMap.get(parentPath);
    const currentNode = nodeMap.get(path);
    if (parentNode && currentNode) {
      parentNode.children.push(currentNode);
    }
  }

  // Sort children alphabetically
  for (const node of nodeMap.values()) {
    node.children.sort((a, b) => a.name.localeCompare(b.name));
  }

  return nodeMap.get('/') || {
    path: '/',
    name: 'Root',
    depth: 0,
    children: [],
    fileCount: 0,
  };
}

/**
 * Join path segments into a folder path.
 *
 * @param segments - Path segments to join
 * @returns Normalized folder path
 *
 * @example
 * joinFolderPath("documents", "reports") // returns "/documents/reports/"
 * joinFolderPath("/documents/", "reports") // returns "/documents/reports/"
 */
export function joinFolderPath(...segments: string[]): string {
  const joined = '/' + segments
    .map(s => s.replace(/^\/+|\/+$/g, '')) // Remove leading/trailing slashes
    .filter(Boolean)
    .join('/');

  return normalizeFolderPath(joined);
}

/**
 * Validate a folder path.
 *
 * Checks for:
 * - Path traversal attempts (..)
 * - Invalid characters
 * - Excessive depth
 *
 * @param path - The folder path to validate
 * @returns Object with isValid and optional error message
 */
export function validateFolderPath(path: string): { isValid: boolean; error?: string } {
  if (!path || typeof path !== 'string') {
    return { isValid: false, error: 'Path must be a non-empty string' };
  }

  // Check for path traversal
  if (path.includes('..')) {
    return { isValid: false, error: 'Path traversal (..) is not allowed' };
  }

  // Check for invalid characters (allowing alphanumeric, -, _, /, space, and common unicode)
  const invalidChars = /[<>:"|?*\x00-\x1f]/;
  if (invalidChars.test(path)) {
    return { isValid: false, error: 'Path contains invalid characters' };
  }

  // Check depth (max 10 levels deep)
  const normalized = normalizeFolderPath(path);
  if (getFolderDepth(normalized) > 10) {
    return { isValid: false, error: 'Path is too deeply nested (max 10 levels)' };
  }

  // Check segment length (max 100 chars per segment)
  const segments = normalized.split('/').filter(Boolean);
  for (const segment of segments) {
    if (segment.length > 100) {
      return { isValid: false, error: 'Folder names must be 100 characters or less' };
    }
  }

  return { isValid: true };
}
