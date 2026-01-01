/**
 * Delete Account API Route
 *
 * DELETE /api/auth/delete-account
 *
 * Deletes the currently authenticated user's account.
 * This is primarily used for e2e testing cleanup.
 *
 * Note: This does NOT delete all user data (characters, chats, etc.)
 * Those should be deleted separately before calling this endpoint.
 */

import { NextResponse } from 'next/server';
import { createAuthenticatedHandler } from '@/lib/api/middleware';
import { logger } from '@/lib/logger';

interface DeleteAccountResponse {
  success: boolean;
  error?: string;
}

export const DELETE = createAuthenticatedHandler(async (req, { user, repos }): Promise<NextResponse<DeleteAccountResponse>> => {
  try {
    const userId = user.id;

    logger.info('Deleting user account', {
      context: 'delete-account.DELETE',
      userId,
    });

    // Delete chat settings first
    const chatSettingsCollection = await repos.chatSettings.findByUserId(userId);
    if (chatSettingsCollection) {
      await repos.chatSettings.delete(chatSettingsCollection.id);
      logger.debug('Deleted user chat settings', {
        context: 'delete-account.DELETE',
        userId,
      });
    }

    // Delete the user
    const deleted = await repos.users.delete(userId);

    if (!deleted) {
      logger.error('Failed to delete user account', {
        context: 'delete-account.DELETE',
        userId,
      });
      return NextResponse.json(
        { success: false, error: 'Failed to delete account' },
        { status: 500 }
      );
    }

    logger.info('User account deleted successfully', {
      context: 'delete-account.DELETE',
      userId,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error(
      'Delete account error',
      { context: 'delete-account.DELETE' },
      error instanceof Error ? error : undefined
    );

    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
});
