/**
 * File Path Utilities
 *
 * Provides centralized file path resolution for API responses.
 * Consolidates the getFilePath() function that was duplicated in 14+ route files.
 */

import type { FileEntry, Character } from '@/lib/schemas/types';

/**
 * Get the filepath for a file
 *
 * Always returns the API route path. This ensures files are accessible
 * in all deployment environments (local dev, Docker, etc.) since the
 * API handler resolves the actual storage location.
 *
 * @param file - The file entry to get the path for
 * @returns The API route path for accessing the file
 *
 * @example
 * ```ts
 * const file = await repos.files.findById(character.defaultImageId);
 * if (file) {
 *   const filepath = getFilePath(file);
 *   // Always returns '/api/v1/files/{id}'
 * }
 * ```
 */
export function getFilePath(file: FileEntry): string {
  return `/api/v1/files/${file.id}`;
}

/**
 * Get the avatar file path for an entity (character or persona)
 *
 * Returns either the default image file path or the avatarUrl.
 * Handles the common pattern of enriching entities with image data.
 *
 * @param entity - Character or Persona with optional defaultImageId and avatarUrl
 * @param file - The file entry if defaultImageId was resolved
 * @returns Object with filepath and url, or null if no avatar
 *
 * @example
 * ```ts
 * let defaultImage = null;
 * if (character.defaultImageId) {
 *   const file = await repos.files.findById(character.defaultImageId);
 *   defaultImage = getAvatarPath(character, file);
 * }
 * // Returns { id, filepath, url } or null
 * ```
 */
export function getAvatarPath(
  entity: { defaultImageId?: string | null; avatarUrl?: string | null },
  file: FileEntry | null
): { id: string; filepath: string; url: string | null } | null {
  if (file) {
    return {
      id: file.id,
      filepath: getFilePath(file),
      url: null,
    };
  }

  // No file, but might have avatarUrl
  if (entity.avatarUrl) {
    return {
      id: '',
      filepath: entity.avatarUrl,
      url: entity.avatarUrl,
    };
  }

  return null;
}

/**
 * Enrich an entity with its default image data
 *
 * Common pattern for adding defaultImage to entities before returning
 * in API responses.
 *
 * @param entity - Entity with optional defaultImageId
 * @param getFile - Function to fetch file by ID (typically repos.files.findById)
 * @returns The default image data or null
 *
 * @example
 * ```ts
 * const character = await repos.characters.findById(id);
 * const defaultImage = await enrichWithDefaultImage(
 *   character,
 *   repos.files.findById.bind(repos.files)
 * );
 * return { ...character, defaultImage };
 * ```
 */
export async function enrichWithDefaultImage(
  entity: { defaultImageId?: string | null; avatarUrl?: string | null } | null,
  getFile: (id: string) => Promise<FileEntry | null>
): Promise<{ id: string; filepath: string; url: string | null } | null> {
  if (!entity) {
    return null;
  }

  if (entity.defaultImageId) {
    const file = await getFile(entity.defaultImageId);
    if (file) {
      return {
        id: file.id,
        filepath: getFilePath(file),
        url: null,
      };
    }
  }

  // Fallback to avatarUrl if no defaultImage
  if (entity.avatarUrl) {
    return {
      id: '',
      filepath: entity.avatarUrl,
      url: entity.avatarUrl,
    };
  }

  return null;
}

/**
 * Build file reference for attachment
 *
 * Creates a standardized file reference object for attached files.
 *
 * @param file - The file entry
 * @returns Standardized file reference object
 */
export function buildFileReference(file: FileEntry): {
  id: string;
  filepath: string;
  filename: string;
  mimeType: string;
  size: number;
} {
  return {
    id: file.id,
    filepath: getFilePath(file),
    filename: file.originalFilename,
    mimeType: file.mimeType,
    size: file.size,
  };
}
