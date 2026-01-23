/**
 * Auth API v1 - 2FA Status Endpoint
 *
 * GET /api/v1/auth/2fa/status - Get user's 2FA status
 */

import { logger } from '@/lib/logger';
import {
  serverError,
  successResponse,
} from '@/lib/api/responses';
import { createAuthenticatedHandler } from '@/lib/api/middleware';

// ============================================================================
// GET Handler
// ============================================================================

export const GET = createAuthenticatedHandler(async (req, { user }) => {
  try {
    const totpEnabled = user.totp?.enabled ?? false;
    const hasBackupCodes = !!user.backupCodes?.ciphertext;

    logger.debug('[Auth v1] 2FA status checked', {
      userId: user.id,
      totpEnabled,
      hasBackupCodes,
    });

    return successResponse({
      totpEnabled,
      hasBackupCodes,
      enabledAt: user.totp?.verifiedAt ?? null,
    });
  } catch (error) {
    logger.error('[Auth v1] 2FA status check error', { userId: user.id }, error instanceof Error ? error : undefined);
    return serverError('Failed to check 2FA status');
  }
});
