/**
 * User Profile API
 *
 * GET /api/user/profile - Get current user's profile
 * PUT /api/user/profile - Update current user's profile
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/lib/auth/session';
import { getRepositories } from '@/lib/repositories/factory';
import { logger } from '@/lib/logger';
import { z } from 'zod';

// Validation schema for profile updates
const updateProfileSchema = z.object({
  email: z.string().email().nullable().optional(),
  name: z.string().max(100).nullable().optional(),
});

/**
 * GET /api/user/profile
 * Returns the current user's profile information
 */
export async function GET() {
  try {
    const session = await getServerSession();
    if (!session?.user?.id) {
      logger.warn('Profile fetch attempted without authentication', {
        context: 'GET /api/user/profile',
      });
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const repos = getRepositories();
    const user = await repos.users.findById(session.user.id);

    if (!user) {
      logger.warn('User not found for profile fetch', {
        context: 'GET /api/user/profile',
        userId: session.user.id,
      });
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

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
    return NextResponse.json(
      { error: 'Failed to fetch profile' },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/user/profile
 * Updates the current user's profile information
 */
export async function PUT(req: NextRequest) {
  try {
    const session = await getServerSession();
    if (!session?.user?.id) {
      logger.warn('Profile update attempted without authentication', {
        context: 'PUT /api/user/profile',
      });
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const validationResult = updateProfileSchema.safeParse(body);

    if (!validationResult.success) {
      logger.warn('Invalid profile update data', {
        context: 'PUT /api/user/profile',
        userId: session.user.id,
        errors: validationResult.error.errors,
      });
      return NextResponse.json(
        { error: 'Invalid data', details: validationResult.error.errors },
        { status: 400 }
      );
    }

    const { email, name } = validationResult.data;

    const repos = getRepositories();

    // Build update object with only provided fields
    const updateData: { email?: string | null; name?: string | null } = {};
    if (email !== undefined) updateData.email = email;
    if (name !== undefined) updateData.name = name;

    logger.debug('Updating user profile', {
      context: 'PUT /api/user/profile',
      userId: session.user.id,
      fields: Object.keys(updateData),
    });

    const updatedUser = await repos.users.update(session.user.id, updateData);

    if (!updatedUser) {
      logger.warn('User not found during profile update', {
        context: 'PUT /api/user/profile',
        userId: session.user.id,
      });
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
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
    return NextResponse.json(
      { error: 'Failed to update profile' },
      { status: 500 }
    );
  }
}
