/**
 * User Profile API v1
 *
 * GET /api/v1/user/profile - Get user profile
 * PUT /api/v1/user/profile - Update user profile
 */

import { NextRequest, NextResponse } from 'next/server';
import { createAuthenticatedHandler, AuthenticatedContext } from '@/lib/api/middleware';
import { z } from 'zod';
import { logger } from '@/lib/logger';
import {
  badRequest,
  serverError,
  validationError,
  successResponse,
} from '@/lib/api/responses';

// ============================================================================
// Schemas
// ============================================================================

const updateProfileSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  email: z.string().email().optional(),
  image: z.string().url().optional().or(z.literal('')),
});

// ============================================================================
// GET Handler
// ============================================================================

export const GET = createAuthenticatedHandler(async (req, context) => {
  try {
    logger.debug('[User Profile v1] GET', { userId: context.user.id });

    const { user, repos } = context;

    // Get full user record from database
    const userRecord = await repos.users.findById(user.id);

    if (!userRecord) {
      return serverError('User not found');
    }

    logger.debug('[User Profile v1] Profile retrieved', {
      userId: user.id,
    });

    return successResponse({
      profile: {
        id: userRecord.id,
        email: userRecord.email,
        username: userRecord.username,
        name: userRecord.name,
        image: userRecord.image,
        createdAt: userRecord.createdAt,
        updatedAt: userRecord.updatedAt,
      },
    });
  } catch (error) {
    logger.error(
      '[User Profile v1] Error getting profile',
      {},
      error instanceof Error ? error : undefined
    );
    return serverError('Failed to fetch profile');
  }
});

// ============================================================================
// PUT Handler
// ============================================================================

export const PUT = createAuthenticatedHandler(async (req, context) => {
  try {
    logger.debug('[User Profile v1] PUT', { userId: context.user.id });

    const body = await req.json();
    const validatedData = updateProfileSchema.parse(body);

    const { user, repos } = context;

    const updateData: any = {};

    if (validatedData.name !== undefined) {
      updateData.name = validatedData.name;
    }

    if (validatedData.image !== undefined) {
      updateData.image = validatedData.image || null;
    }

    // Email changes should be handled carefully (may require verification)
    if (validatedData.email !== undefined) {
      const existingUser = await repos.users.findByEmail(validatedData.email);

      if (existingUser && existingUser.id !== user.id) {
        return badRequest('Email already in use');
      }

      updateData.email = validatedData.email;
    }

    const updatedUser = await repos.users.update(user.id, updateData);

    if (!updatedUser) {
      return serverError('Failed to update profile');
    }

    logger.info('[User Profile v1] Profile updated', { userId: user.id });

    return successResponse({
      profile: {
        id: updatedUser.id,
        email: updatedUser.email,
        username: updatedUser.username,
        name: updatedUser.name,
        image: updatedUser.image,
        createdAt: updatedUser.createdAt,
        updatedAt: updatedUser.updatedAt,
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return validationError(error);
    }

    logger.error(
      '[User Profile v1] Error updating profile',
      {},
      error instanceof Error ? error : undefined
    );
    return serverError('Failed to update profile');
  }
});
