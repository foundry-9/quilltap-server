import { NextResponse } from 'next/server'
import { createAuthenticatedHandler } from '@/lib/api/middleware'
import { logger } from '@/lib/logger'

/**
 * GET /api/auth/2fa/status
 * Returns the user's 2FA status (enabled or not)
 */
export const GET = createAuthenticatedHandler(async (req, { user }) => {
  try {
    const totpEnabled = user.totp?.enabled ?? false
    const hasBackupCodes = !!user.backupCodes?.ciphertext

    logger.debug('2FA status checked', {
      context: 'GET /api/auth/2fa/status',
      userId: user.id,
      totpEnabled,
      hasBackupCodes,
    })

    return NextResponse.json({
      totpEnabled,
      hasBackupCodes,
      enabledAt: user.totp?.verifiedAt ?? null,
    })
  } catch (error) {
    logger.error('2FA status check error', { context: 'GET /api/auth/2fa/status' }, error instanceof Error ? error : undefined)
    return NextResponse.json(
      { error: 'Failed to check 2FA status' },
      { status: 500 }
    )
  }
})
