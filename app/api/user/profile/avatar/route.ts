/**
 * User Profile Avatar API
 *
 * PATCH /api/user/profile/avatar - Set or clear user's profile image
 */

import { NextResponse } from 'next/server';
import { createAuthenticatedHandler } from '@/lib/api/middleware';
import { z } from 'zod';
import { logger } from '@/lib/logger';
import type { FileEntry } from '@/lib/schemas/types';

/**
 * Get the filepath for a file - always returns API path for S3-backed files
 */
function getFilePath(file: FileEntry): string {
  return `/api/files/${file.id}`;
}

const avatarSchema = z.object({
  imageId: z.string().nullable(),
});

/**
 * PATCH /api/user/profile/avatar
 * Set or clear profile image for the authenticated user
 *
 * Only accepts file IDs from the file-manager system.
 * The file must:
 * - Belong to the authenticated user
 * - Have category 'IMAGE' or 'AVATAR'
 */
export const PATCH = createAuthenticatedHandler(async (request, { user, repos }) => {
  try {
    const userId = user.id;

    logger.debug('Processing profile avatar update', {
      context: 'PATCH /api/user/profile/avatar',
      userId,
    });

    const body = await request.json();
    const { imageId } = avatarSchema.parse(body);

    // If imageId is provided, verify it from repository
    if (imageId) {
      logger.debug('Validating file for profile avatar', {
        context: 'PATCH /api/user/profile/avatar',
        fileId: imageId,
        userId,
      });

      const fileEntry = await repos.files.findById(imageId);

      // Verify file exists
      if (!fileEntry) {
        logger.warn('File not found for profile avatar', {
          context: 'PATCH /api/user/profile/avatar',
          fileId: imageId,
          userId,
        });
        return NextResponse.json({ error: 'File not found' }, { status: 404 });
      }

      // Verify file belongs to user
      if (fileEntry.userId !== userId) {
        logger.warn('File does not belong to user', {
          context: 'PATCH /api/user/profile/avatar',
          fileId: imageId,
          fileOwnerId: fileEntry.userId,
          userId,
        });
        return NextResponse.json({ error: 'File not found' }, { status: 404 });
      }

      // Verify file category is valid for avatar
      const validCategories = ['IMAGE', 'AVATAR'];
      if (!validCategories.includes(fileEntry.category)) {
        logger.warn('File category invalid for avatar', {
          context: 'PATCH /api/user/profile/avatar',
          fileId: imageId,
          category: fileEntry.category,
        });
        return NextResponse.json(
          { error: `Invalid file category. Expected IMAGE or AVATAR, got ${fileEntry.category}` },
          { status: 400 }
        );
      }

      logger.debug('File validation passed for profile avatar', {
        context: 'PATCH /api/user/profile/avatar',
        fileId: imageId,
        filename: fileEntry.originalFilename,
        category: fileEntry.category,
      });
    } else {
      logger.debug('Clearing profile avatar', {
        context: 'PATCH /api/user/profile/avatar',
        userId,
      });
    }

    // Update user with the image URL (file API path) or null
    const imageUrl = imageId ? `/api/files/${imageId}` : null;
    const updatedUser = await repos.users.update(userId, { image: imageUrl });

    if (!updatedUser) {
      logger.warn('User not found during profile avatar update', {
        context: 'PATCH /api/user/profile/avatar',
        userId,
      });
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    logger.info('Profile avatar updated successfully', {
      context: 'PATCH /api/user/profile/avatar',
      userId,
      imageId: imageId || null,
    });

    // Build response with image info
    let image = null;
    if (imageId) {
      const fileEntry = await repos.files.findById(imageId);
      if (fileEntry) {
        image = {
          id: fileEntry.id,
          filepath: getFilePath(fileEntry),
          url: imageUrl,
        };
        logger.debug('Built response with profile image', {
          context: 'PATCH /api/user/profile/avatar',
          fileId: fileEntry.id,
          filename: fileEntry.originalFilename,
        });
      }
    }

    // Get 2FA status
    const totpEnabled = updatedUser.totp?.enabled ?? false;

    return NextResponse.json({
      id: updatedUser.id,
      username: updatedUser.username,
      email: updatedUser.email,
      name: updatedUser.name,
      image: updatedUser.image,
      emailVerified: updatedUser.emailVerified,
      createdAt: updatedUser.createdAt,
      updatedAt: updatedUser.updatedAt,
      totpEnabled,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      logger.warn('Validation error updating profile avatar', {
        context: 'PATCH /api/user/profile/avatar',
        errors: error.errors,
      });
      return NextResponse.json({ error: 'Validation error', details: error.errors }, { status: 400 });
    }

    logger.error(
      'Failed to update profile avatar',
      { context: 'PATCH /api/user/profile/avatar' },
      error instanceof Error ? error : new Error(String(error))
    );

    return NextResponse.json(
      { error: 'Failed to update profile avatar' },
      { status: 500 }
    );
  }
});
