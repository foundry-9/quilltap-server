/**
 * Auth API v1 - Regenerate Backup Codes Endpoint
 *
 * POST /api/v1/auth/2fa/regenerate-backup-codes - Regenerate 2FA backup codes
 */

import { logger } from '@/lib/logger';
import {
  badRequest,
  serverError,
  successResponse,
} from '@/lib/api/responses';
import { createAuthenticatedHandler } from '@/lib/api/middleware';
import { regenerateBackupCodes } from '@/lib/auth/totp';

// ============================================================================
// POST Handler
// ============================================================================

export const POST = createAuthenticatedHandler(async (req, { user }) => {
  try {
    logger.info('[Auth v1] Backup codes regeneration attempt', { userId: user.id });

    const result = await regenerateBackupCodes(user.id);

    if (!result.success) {
      return badRequest('2FA is not enabled or backup codes could not be regenerated');
    }

    logger.info('[Auth v1] Backup codes regenerated successfully', { userId: user.id });

    return successResponse({
      message: 'Backup codes regenerated successfully',
      backupCodes: result.backupCodes,
    });
  } catch (error) {
    logger.error('[Auth v1] Backup codes regeneration error', { userId: user.id }, error instanceof Error ? error : undefined);
    return serverError('Failed to regenerate backup codes');
  }
});
