/**
 * Auth API v1 - 2FA Disable Endpoint
 *
 * POST /api/v1/auth/2fa/disable - Disable TOTP 2FA
 */

import { logger } from '@/lib/logger';
import {
  serverError,
  successResponse,
} from '@/lib/api/responses';
import { createAuthenticatedHandler } from '@/lib/api/middleware';
import { disableTOTP } from '@/lib/auth/totp';

// ============================================================================
// POST Handler
// ============================================================================

export const POST = createAuthenticatedHandler(async (req, { user }) => {
  try {
    logger.info('[Auth v1] 2FA disable attempt', { userId: user.id });

    const success = await disableTOTP(user.id);

    if (!success) {
      logger.error('[Auth v1] 2FA disable failed', { userId: user.id });
      return serverError('Failed to disable 2FA');
    }

    logger.info('[Auth v1] 2FA disabled successfully', { userId: user.id });

    return successResponse({ message: '2FA disabled successfully' });
  } catch (error) {
    logger.error('[Auth v1] 2FA disable error', { userId: user.id }, error instanceof Error ? error : undefined);
    return serverError('Failed to disable 2FA');
  }
});
