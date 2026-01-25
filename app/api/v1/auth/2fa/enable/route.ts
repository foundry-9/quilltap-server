/**
 * Auth API v1 - 2FA Enable Endpoint
 *
 * POST /api/v1/auth/2fa/enable - Enable TOTP 2FA after verification
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
import { enableTOTP } from '@/lib/auth/totp';

// ============================================================================
// Schemas
// ============================================================================

const enableTOTPSchema = z.object({
  encryptedSecret: z.string(),
  encryptedIv: z.string(),
  encryptedAuthTag: z.string(),
  verificationCode: z.string().length(6),
});

// ============================================================================
// POST Handler
// ============================================================================

export const POST = createAuthenticatedHandler(async (req, { user }) => {
  try {
    const body = await req.json();
    const { encryptedSecret, encryptedIv, encryptedAuthTag, verificationCode } =
      enableTOTPSchema.parse(body);

    logger.info('[Auth v1] 2FA enable attempt', { userId: user.id });

    const result = await enableTOTP(
      user.id,
      encryptedSecret,
      encryptedIv,
      encryptedAuthTag,
      verificationCode
    );

    if (!result.success) {
      return badRequest('Invalid verification code');
    }

    logger.info('[Auth v1] 2FA enabled successfully', { userId: user.id });

    return successResponse({
      message: '2FA enabled successfully',
      backupCodes: result.backupCodes,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return validationError(error);
    }

    logger.error('[Auth v1] 2FA enable error', { userId: user.id }, error instanceof Error ? error : undefined);
    return serverError('Failed to enable 2FA');
  }
});
