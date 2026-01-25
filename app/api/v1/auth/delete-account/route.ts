/**
 * Auth API v1 - Delete Account Endpoint
 *
 * DELETE /api/v1/auth/delete-account - Delete authenticated user's account
 *
 * Note: This does NOT delete all user data (characters, chats, etc.)
 * Those should be deleted separately before calling this endpoint.
 * Primarily used for e2e testing cleanup.
 */

import { logger } from '@/lib/logger';
import {
  serverError,
  successResponse,
} from '@/lib/api/responses';
import { createAuthenticatedHandler } from '@/lib/api/middleware';

// ============================================================================
// DELETE Handler
// ============================================================================

export const DELETE = createAuthenticatedHandler(async (req, { user, repos }) => {
  try {
    logger.info('[Auth v1] Delete account attempt', { userId: user.id });

    // Delete chat settings first
    const chatSettingsCollection = await repos.chatSettings.findByUserId(user.id);
    if (chatSettingsCollection) {
      await repos.chatSettings.delete(chatSettingsCollection.id);
    }

    // Delete the user
    const deleted = await repos.users.delete(user.id);

    if (!deleted) {
      logger.error('[Auth v1] Failed to delete user account', { userId: user.id });
      return serverError('Failed to delete account');
    }

    logger.info('[Auth v1] User account deleted successfully', { userId: user.id });

    return successResponse({ success: true, message: 'Account deleted successfully' });
  } catch (error) {
    logger.error('[Auth v1] Delete account error', { userId: user.id }, error instanceof Error ? error : undefined);
    return serverError('Failed to delete account');
  }
});
