/**
 * User Profile API
 *
 * GET /api/user/profile - Get current user's profile
 * PUT /api/user/profile - Update current user's profile
 */

import { NextResponse } from 'next/server';
import { createAuthenticatedHandler } from '@/lib/api/middleware';
import { logger } from '@/lib/logger';
import { z } from 'zod';
import { notFound, badRequest, serverError, validationError } from '@/lib/api/responses';

// Validation schema for profile updates
const updateProfileSchema = z.object({
  email: z.string().email().nullable().optional(),
  name: z.string().max(100).nullable().optional(),
});

/**
 * GET /api/user/profile
 * Returns the current user's profile information
 */
export const GET = createAuthenticatedHandler(async (req, { user }) => {
  try {
    // Get 2FA status
    const totpEnabled = user.totp?.enabled ?? false;

    logger.debug('Profile fetched successfully', {
      context: 'GET /api/user/profile',
      userId: user.id,
    });

    // Return profile data (excluding sensitive fields)
    return NextResponse.json({
      id: user.id,
      username: user.username,
      email: user.email,
      name: user.name,
      image: user.image,
      emailVerified: user.emailVerified,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      totpEnabled,
    });
  } catch (error) {
    logger.error(
      'Failed to fetch user profile',
      { context: 'GET /api/user/profile' },
      error instanceof Error ? error : new Error(String(error))
    );
    return serverError('Failed to fetch profile');
  }
});

/**
 * PUT /api/user/profile
 * Updates the current user's profile information
 */
export const PUT = createAuthenticatedHandler(async (req, { user, repos }) => {
  try {
    const body = await req.json();
    const validationResult = updateProfileSchema.safeParse(body);

    if (!validationResult.success) {
      logger.warn('Invalid profile update data', {
        context: 'PUT /api/user/profile',
        userId: user.id,
        errors: validationResult.error.errors,
      });
      return validationError(validationResult.error);
    }

    const { email, name } = validationResult.data;

    // Build update object with only provided fields
    const updateData: { email?: string | null; name?: string | null } = {};
    if (email !== undefined) updateData.email = email;
    if (name !== undefined) updateData.name = name;

    logger.debug('Updating user profile', {
      context: 'PUT /api/user/profile',
      userId: user.id,
      fields: Object.keys(updateData),
    });

    const updatedUser = await repos.users.update(user.id, updateData);

    if (!updatedUser) {
      logger.warn('User not found during profile update', {
        context: 'PUT /api/user/profile',
        userId: user.id,
      });
      return notFound('User');
    }

    // Get 2FA status
    const totpEnabled = updatedUser.totp?.enabled ?? false;

    logger.info('Profile updated successfully', {
      context: 'PUT /api/user/profile',
      userId: updatedUser.id,
    });

    // Return updated profile data (excluding sensitive fields)
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
    logger.error(
      'Failed to update user profile',
      { context: 'PUT /api/user/profile' },
      error instanceof Error ? error : new Error(String(error))
    );
    return serverError('Failed to update profile');
  }
});
