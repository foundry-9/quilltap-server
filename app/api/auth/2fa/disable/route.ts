import { NextResponse } from 'next/server'
import { createAuthenticatedHandler } from '@/lib/api/middleware'
import { disableTOTP } from '@/lib/auth/totp'
import { logger } from '@/lib/logger'

export const POST = createAuthenticatedHandler(async (req, { user }) => {
  try {
    const success = await disableTOTP(user.id)

    if (!success) {
      return NextResponse.json(
        { error: 'Failed to disable 2FA' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      message: '2FA disabled successfully'
    })
  } catch (error) {
    logger.error('Disable 2FA error', { context: 'POST /api/auth/2fa/disable' }, error instanceof Error ? error : undefined)
    return NextResponse.json(
      { error: 'Failed to disable 2FA' },
      { status: 500 }
    )
  }
})
