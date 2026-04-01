import { NextResponse } from 'next/server'
import { createAuthenticatedHandler } from '@/lib/api/middleware'
import { enableTOTP } from '@/lib/auth/totp'
import { z } from 'zod'
import { logger } from '@/lib/logger'

const EnableTOTPSchema = z.object({
  encryptedSecret: z.string(),
  encryptedIv: z.string(),
  encryptedAuthTag: z.string(),
  verificationCode: z.string().length(6)
})

export const POST = createAuthenticatedHandler(async (req, { user }) => {
  try {
    const body = await req.json()
    const { encryptedSecret, encryptedIv, encryptedAuthTag, verificationCode } =
      EnableTOTPSchema.parse(body)

    const result = await enableTOTP(
      user.id,
      encryptedSecret,
      encryptedIv,
      encryptedAuthTag,
      verificationCode
    )

    if (!result.success) {
      return NextResponse.json(
        { error: 'Invalid verification code' },
        { status: 400 }
      )
    }

    return NextResponse.json({
      message: '2FA enabled successfully',
      backupCodes: result.backupCodes
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation error', details: error.errors },
        { status: 400 }
      )
    }

    logger.error('Enable 2FA error', { context: 'POST /api/auth/2fa/enable' }, error instanceof Error ? error : undefined)
    return NextResponse.json(
      { error: 'Failed to enable 2FA' },
      { status: 500 }
    )
  }
})
