/**
 * Auth API v1 - 2FA Setup Endpoint
 *
 * POST /api/v1/auth/2fa/setup - Generate TOTP secret for 2FA setup
 */

import { logger } from '@/lib/logger';
import {
  badRequest,
  serverError,
  successResponse,
} from '@/lib/api/responses';
import { createAuthenticatedHandler } from '@/lib/api/middleware';
import { generateTOTPSecret } from '@/lib/auth/totp';

// ============================================================================
// POST Handler
// ============================================================================

export const POST = createAuthenticatedHandler(async (req, { user }) => {
  try {
    logger.info('[Auth v1] 2FA setup attempt', { userId: user.id });

    if (user.totp?.enabled) {
      logger.debug('[Auth v1] 2FA already enabled', { userId: user.id });
      return badRequest('2FA is already enabled');
    }

    const { secret, qrCode, encrypted } = await generateTOTPSecret(
      user.id,
      user.email || user.username
    );

    logger.info('[Auth v1] 2FA secret generated', { userId: user.id });

    return successResponse({
      secret, // Show to user for manual entry
      qrCode, // Show QR code for scanning
      encrypted // Store temporarily in client for verification
    });
  } catch (error) {
    logger.error('[Auth v1] 2FA setup error', { userId: user.id }, error instanceof Error ? error : undefined);
    return serverError('Failed to generate 2FA secret');
  }
});
