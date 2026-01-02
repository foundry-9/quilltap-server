import { NextResponse } from 'next/server'
import { createAuthenticatedHandler } from '@/lib/api/middleware'
import { generateTOTPSecret } from '@/lib/auth/totp'
import { logger } from '@/lib/logger'

export const POST = createAuthenticatedHandler(async (req, { user }) => {
  try {
    if (user.totp?.enabled) {
      return NextResponse.json(
        { error: '2FA is already enabled' },
        { status: 400 }
      )
    }

    const { secret, qrCode, encrypted } = await generateTOTPSecret(
      user.id,
      user.email || user.username
    )

    return NextResponse.json({
      secret, // Show to user for manual entry
      qrCode, // Show QR code for scanning
      encrypted // Store temporarily in client for verification
    })
  } catch (error) {
    logger.error('2FA setup error', { context: 'POST /api/auth/2fa/setup' }, error instanceof Error ? error : undefined)
    return NextResponse.json(
      { error: 'Failed to generate 2FA secret' },
      { status: 500 }
    )
  }
})
