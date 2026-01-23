/**
 * Auth API v1 - Change Password Endpoint
 *
 * POST /api/v1/auth/change-password - Change authenticated user's password
 */

import { z } from 'zod';
import { logger } from '@/lib/logger';
import {
  badRequest,
  serverError,
  validationError,
  successResponse,
} from '@/lib/api/responses';
import { createAuthenticatedHandler } from '@/lib/api/middleware';
import { hashPassword, verifyPassword, validatePasswordStrength } from '@/lib/auth/password';

// ============================================================================
// Schemas
// ============================================================================

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: z.string().min(8, 'New password must be at least 8 characters'),
});

// ============================================================================
// POST Handler
// ============================================================================

export const POST = createAuthenticatedHandler(async (req, { user, repos }) => {
  try {
    const body = await req.json();
    const { currentPassword, newPassword } = changePasswordSchema.parse(body);

    logger.info('[Auth v1] Password change attempt', { userId: user.id });

    // Check if user has a password set
    if (!user.passwordHash) {
      logger.warn('[Auth v1] Password change failed - no password set', { userId: user.id });
      return badRequest('Cannot change password - no password set. This account uses OAuth login.');
    }

    // Verify current password
    const isCurrentPasswordValid = await verifyPassword(currentPassword, user.passwordHash);
    if (!isCurrentPasswordValid) {
      logger.info('[Auth v1] Password change failed - incorrect current password', { userId: user.id });
      return badRequest('Current password is incorrect');
    }

    // Validate new password strength
    const passwordStrength = validatePasswordStrength(newPassword);
    if (!passwordStrength.valid) {
      return badRequest('New password does not meet requirements', { requirements: passwordStrength.errors });
    }

    // Check that new password is different from current
    const isSamePassword = await verifyPassword(newPassword, user.passwordHash);
    if (isSamePassword) {
      return badRequest('New password must be different from current password');
    }

    // Hash new password and update user
    const newPasswordHash = await hashPassword(newPassword);
    await repos.users.update(user.id, { passwordHash: newPasswordHash });

    logger.info('[Auth v1] Password changed successfully', { userId: user.id });

    return successResponse({ message: 'Password changed successfully' });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return validationError(error);
    }

    logger.error('[Auth v1] Password change error', { userId: user.id }, error instanceof Error ? error : undefined);
    return serverError('Failed to change password');
  }
});
