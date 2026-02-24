/**
 * Thumbnail Generation Utilities
 *
 * Shared utility for generating, caching, and managing image thumbnails.
 * Centralizes thumbnail storage key generation and Sharp processing to
 * ensure consistent caching across the application.
 *
 * @module lib/files/thumbnail-utils
 */

import sharp from 'sharp';
import { createLogger } from '@/lib/logging/create-logger';
import { fileStorageManager } from '@/lib/file-storage/manager';
import { canResizeImage } from '@/lib/files/image-processing';
import type { FileEntry } from '@/lib/schemas/file.types';

const logger = createLogger('files:thumbnails');

// ============================================================================
// CONSTANTS
// ============================================================================

/** Default thumbnail size in pixels */
export const DEFAULT_THUMBNAIL_SIZE = 150;

/** Maximum allowed thumbnail size in pixels */
export const MAX_THUMBNAIL_SIZE = 300;

/** WebP quality for thumbnails (1-100) */
export const THUMBNAIL_QUALITY = 80;

/** Common thumbnail sizes to clean up on file deletion */
export const COMMON_THUMBNAIL_SIZES = [120, 150, 300];

// ============================================================================
// KEY BUILDING
// ============================================================================

/**
 * Build the canonical storage key for a cached thumbnail.
 *
 * Format: `users/{userId}/thumbnails/{fileId}_{size}.webp`
 *
 * This MUST be the single source of truth for thumbnail cache keys.
 * Both cache reads and cache writes must use this function.
 */
export function buildThumbnailStorageKey(userId: string, fileId: string, size: number): string {
  return `users/${userId}/thumbnails/${fileId}_${size}.webp`;
}

// ============================================================================
// TYPE CHECKING
// ============================================================================

/**
 * Check if a file's MIME type supports thumbnail generation.
 */
export function canGenerateThumbnail(mimeType: string): boolean {
  return mimeType.startsWith('image/') && canResizeImage(mimeType);
}

// ============================================================================
// GENERATION
// ============================================================================

export interface ThumbnailResult {
  /** The generated thumbnail buffer */
  buffer: Buffer;
  /** Whether this was served from cache */
  fromCache: boolean;
}

/**
 * Generate a thumbnail for a file entry, using cache when available.
 *
 * 1. Checks if a cached thumbnail exists at the canonical storage key
 * 2. If cached, returns it immediately
 * 3. If not, downloads the original, generates a thumbnail via Sharp,
 *    caches it at the canonical key, and returns it
 *
 * @param fileEntry - The file entry to thumbnail
 * @param size - Desired thumbnail size in pixels (width & height, cover fit)
 * @returns The thumbnail buffer and cache status
 * @throws If the file cannot be downloaded or Sharp processing fails
 */
export async function generateThumbnail(
  fileEntry: FileEntry,
  size: number = DEFAULT_THUMBNAIL_SIZE
): Promise<ThumbnailResult> {
  const clampedSize = Math.min(size, MAX_THUMBNAIL_SIZE);
  const thumbnailKey = buildThumbnailStorageKey(fileEntry.userId, fileEntry.id, clampedSize);

  // Build a synthetic FileEntry pointing at the thumbnail key for cache lookup
  const thumbnailFileEntry = { ...fileEntry, storageKey: thumbnailKey };

  // Check cache
  const exists = await fileStorageManager.fileExists(thumbnailFileEntry);
  if (exists) {
    logger.debug('Thumbnail cache hit', { fileId: fileEntry.id, size: clampedSize });
    const cachedBuffer = await fileStorageManager.downloadFile(thumbnailFileEntry);
    return { buffer: cachedBuffer, fromCache: true };
  }

  // Cache miss — generate
  logger.debug('Thumbnail cache miss, generating', { fileId: fileEntry.id, size: clampedSize });

  const imageBuffer = await fileStorageManager.downloadFile(fileEntry);

  const thumbnailBuffer = await sharp(imageBuffer)
    .resize(clampedSize, clampedSize, {
      fit: 'cover',
      position: 'center',
    })
    .webp({ quality: THUMBNAIL_QUALITY })
    .toBuffer();

  // Cache the thumbnail at the canonical key (fire-and-forget)
  fileStorageManager.uploadRaw({
    storageKey: thumbnailKey,
    content: thumbnailBuffer,
    contentType: 'image/webp',
  }).then(() => {
    logger.debug('Thumbnail cached', { fileId: fileEntry.id, size: clampedSize, key: thumbnailKey });
  }).catch((cacheError) => {
    logger.warn('Failed to cache thumbnail', {
      fileId: fileEntry.id,
      error: cacheError instanceof Error ? cacheError.message : 'Unknown error',
    });
  });

  return { buffer: thumbnailBuffer, fromCache: false };
}

// ============================================================================
// CLEANUP
// ============================================================================

/**
 * Delete cached thumbnails for a file across all common sizes.
 *
 * Called during file deletion to clean up thumbnail cache entries.
 * Failures are logged but do not throw.
 */
export async function cleanupThumbnails(fileEntry: FileEntry): Promise<void> {
  for (const size of COMMON_THUMBNAIL_SIZES) {
    const key = buildThumbnailStorageKey(fileEntry.userId, fileEntry.id, size);
    try {
      await fileStorageManager.deleteRaw(key);
      logger.debug('Deleted cached thumbnail', { fileId: fileEntry.id, size, key });
    } catch (error) {
      // Silently ignore — thumbnail may not exist for this size
      logger.debug('No cached thumbnail to delete', { fileId: fileEntry.id, size });
    }
  }
}
