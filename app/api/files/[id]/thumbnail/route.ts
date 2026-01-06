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
import { downloadFile as downloadS3File, uploadFile, fileExists } from '@/lib/s3/operations';
import { validateS3Config } from '@/lib/s3/config';
import { canResizeImage } from '@/lib/files/image-processing';

const DEFAULT_THUMBNAIL_SIZE = 150;
const MAX_THUMBNAIL_SIZE = 300;
const THUMBNAIL_QUALITY = 80;

/**
 * Build the S3 key for a cached thumbnail
 */
function buildThumbnailKey(userId: string, fileId: string, size: number): string {
  const config = validateS3Config();
  const prefix = config.pathPrefix || '';
  return `${prefix}users/${userId}/thumbnails/${fileId}_${size}.webp`;
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

      if (!fileEntry.s3Key) {
        logger.error('File has no S3 key', { context, fileId });
        return serverError('File not available');
      }

      // Check for cached thumbnail
      const thumbnailKey = buildThumbnailKey(user.id, fileId, size);

      logger.debug('Checking for cached thumbnail', {
        context,
        fileId,
        thumbnailKey,
      });

      const thumbnailExists = await fileExists(thumbnailKey);

      if (thumbnailExists) {
        logger.debug('Serving cached thumbnail', {
          context,
          fileId,
          thumbnailKey,
        });

        try {
          const thumbnailBuffer = await downloadS3File(thumbnailKey);

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
            thumbnailKey,
            error: cacheError instanceof Error ? cacheError.message : 'Unknown error',
          });
          // Fall through to regeneration
        }
      }

      // Download original image
      logger.debug('Downloading original image for thumbnail generation', {
        context,
        fileId,
        s3Key: fileEntry.s3Key,
      });

      const originalBuffer = await downloadS3File(fileEntry.s3Key);

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

      // Cache the thumbnail in S3 (async, don't wait)
      uploadFile(thumbnailKey, thumbnailBuffer, 'image/webp', {
        userId: user.id,
        fileId,
        thumbnailSize: String(size),
      }).then(() => {
        logger.debug('Thumbnail cached to S3', {
          context,
          fileId,
          thumbnailKey,
        });
      }).catch((cacheError) => {
        logger.warn('Failed to cache thumbnail', {
          context,
          fileId,
          thumbnailKey,
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
