/**
 * Thumbnail Generation API Route
 *
 * Generates and serves thumbnails for image files with caching.
 * GET /api/files/:id/thumbnail?size=150
 *
 * Features:
 * - On-demand thumbnail generation using Sharp
 * - Caches thumbnails in S3 for subsequent requests
 * - Returns original file for non-image types
 * - Supports size parameter (default 150, max 300)
 */

import { NextRequest, NextResponse } from 'next/server';
import sharp from 'sharp';
import { createAuthenticatedParamsHandler } from '@/lib/api/middleware';
import { logger } from '@/lib/logger';
import { notFound, badRequest, serverError } from '@/lib/api/responses';
import { fileStorageManager } from '@/lib/file-storage/manager';
import { canResizeImage } from '@/lib/files/image-processing';

const DEFAULT_THUMBNAIL_SIZE = 150;
const MAX_THUMBNAIL_SIZE = 300;
const THUMBNAIL_QUALITY = 80;

/**
 * Build the storage key for a cached thumbnail
 */
function buildThumbnailStorageKey(userId: string, fileId: string, size: number): string {
  return `users/${userId}/thumbnails/${fileId}_${size}.webp`;
}

/**
 * Check if a MIME type is an image that can be thumbnailed
 */
function canGenerateThumbnail(mimeType: string): boolean {
  return mimeType.startsWith('image/') && canResizeImage(mimeType);
}

/**
 * GET /api/files/:id/thumbnail
 * Generate or retrieve a cached thumbnail for an image file
 */
export const GET = createAuthenticatedParamsHandler<{ id: string }>(
  async (request: NextRequest, { user, repos }, { id: fileId }) => {
    const context = 'GET /api/files/[id]/thumbnail';

    try {
      // Parse size parameter
      const url = new URL(request.url);
      const sizeParam = url.searchParams.get('size');
      let size = DEFAULT_THUMBNAIL_SIZE;

      if (sizeParam) {
        const parsedSize = parseInt(sizeParam, 10);
        if (isNaN(parsedSize) || parsedSize < 1) {
          return badRequest('Invalid size parameter');
        }
        size = Math.min(parsedSize, MAX_THUMBNAIL_SIZE);
      }

      logger.debug('Thumbnail request', {
        context,
        fileId,
        requestedSize: sizeParam,
        effectiveSize: size,
      });

      // Get file metadata
      const fileEntry = await repos.files.findById(fileId);
      if (!fileEntry) {
        logger.debug('File not found', { context, fileId });
        return notFound('File');
      }

      // Verify ownership
      if (fileEntry.userId !== user.id) {
        logger.warn('Thumbnail access denied - not owner', {
          context,
          fileId,
          fileUserId: fileEntry.userId,
          requestUserId: user.id,
        });
        return notFound('File');
      }

      // Check if file is an image that can be thumbnailed
      if (!canGenerateThumbnail(fileEntry.mimeType)) {
        logger.debug('File is not a supported image type for thumbnails', {
          context,
          fileId,
          mimeType: fileEntry.mimeType,
        });
        // Return a redirect to the original file for non-image types
        return NextResponse.redirect(new URL(`/api/files/${fileId}`, request.url));
      }

      if (!fileEntry.storageKey) {
        logger.error('File has no storage key', { context, fileId });
        return serverError('File not available');
      }

      // Check for cached thumbnail
      const thumbnailStorageKey = buildThumbnailStorageKey(user.id, fileId, size);

      logger.debug('Checking for cached thumbnail', {
        context,
        fileId,
        thumbnailStorageKey,
      });

      // Create a temporary file entry for the thumbnail cache check
      const thumbnailEntry = { ...fileEntry, storageKey: thumbnailStorageKey };

      try {
        const thumbnailExists = await fileStorageManager.fileExists(thumbnailEntry);

        if (thumbnailExists) {
          logger.debug('Serving cached thumbnail', {
            context,
            fileId,
            thumbnailStorageKey,
          });

          try {
            const thumbnailBuffer = await fileStorageManager.downloadFile(thumbnailEntry);

            return new NextResponse(new Uint8Array(thumbnailBuffer), {
              headers: {
                'Content-Type': 'image/webp',
                'Content-Length': thumbnailBuffer.length.toString(),
                'Cache-Control': 'public, max-age=31536000, immutable',
              },
            });
          } catch (cacheError) {
            logger.warn('Failed to serve cached thumbnail, will regenerate', {
              context,
              fileId,
              thumbnailStorageKey,
              error: cacheError instanceof Error ? cacheError.message : 'Unknown error',
            });
            // Fall through to regeneration
          }
        }
      } catch (existsError) {
        logger.debug('Thumbnail existence check failed, will regenerate', {
          context,
          fileId,
          error: existsError instanceof Error ? existsError.message : 'Unknown error',
        });
        // Fall through to regeneration
      }

      // Download original image
      logger.debug('Downloading original image for thumbnail generation', {
        context,
        fileId,
        storageKey: fileEntry.storageKey,
      });

      const originalBuffer = await fileStorageManager.downloadFile(fileEntry);

      logger.debug('Original image downloaded', {
        context,
        fileId,
        originalSize: originalBuffer.length,
      });

      // Generate thumbnail using Sharp
      logger.debug('Generating thumbnail', {
        context,
        fileId,
        targetSize: size,
      });

      const thumbnailBuffer = await sharp(originalBuffer)
        .resize({
          width: size,
          height: size,
          fit: 'cover',
          position: 'center',
        })
        .webp({ quality: THUMBNAIL_QUALITY })
        .toBuffer();

      logger.debug('Thumbnail generated', {
        context,
        fileId,
        thumbnailSize: thumbnailBuffer.length,
        targetSize: size,
      });

      // Cache the thumbnail (async, don't wait)
      fileStorageManager.uploadFile({
        userId: user.id,
        fileId: `${fileId}_thumb_${size}`,
        filename: `${fileId}_${size}.webp`,
        content: thumbnailBuffer,
        contentType: 'image/webp',
        metadata: {
          originalFileId: fileId,
          thumbnailSize: String(size),
        },
      }).then(() => {
        logger.debug('Thumbnail cached to storage', {
          context,
          fileId,
          thumbnailStorageKey,
        });
      }).catch((cacheError) => {
        logger.warn('Failed to cache thumbnail', {
          context,
          fileId,
          thumbnailStorageKey,
          error: cacheError instanceof Error ? cacheError.message : 'Unknown error',
        });
      });

      // Return the thumbnail
      return new NextResponse(new Uint8Array(thumbnailBuffer), {
        headers: {
          'Content-Type': 'image/webp',
          'Content-Length': thumbnailBuffer.length.toString(),
          'Cache-Control': 'public, max-age=31536000, immutable',
        },
      });
    } catch (error) {
      logger.error('Error generating thumbnail', { context, fileId }, error instanceof Error ? error : undefined);
      return serverError('Failed to generate thumbnail');
    }
  }
);
