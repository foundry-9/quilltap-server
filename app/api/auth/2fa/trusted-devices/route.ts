import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from '@/lib/auth/session'
import {
  createTrustedDevice,
  listTrustedDevices,
  revokeTrustedDevice,
  revokeAllTrustedDevices,
} from '@/lib/auth/totp'
import { logger } from '@/lib/logger'

const DEVICE_TRUST_DAYS = 30

/**
 * GET /api/auth/2fa/trusted-devices
 * List all trusted devices for the current user
 */
export async function GET(req: NextRequest) {
  const session = await getServerSession()

  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const devices = await listTrustedDevices(session.user.id)

    logger.debug('Listed trusted devices', {
      context: 'GET /api/auth/2fa/trusted-devices',
      userId: session.user.id,
      deviceCount: devices.length,
    })

    return NextResponse.json({ devices })
  } catch (error) {
    logger.error('Failed to list trusted devices', { context: 'GET /api/auth/2fa/trusted-devices' }, error instanceof Error ? error : undefined)
    return NextResponse.json(
      { error: 'Failed to list trusted devices' },
      { status: 500 }
    )
  }
}

/**
 * POST /api/auth/2fa/trusted-devices
 * Create a new trusted device (called after successful 2FA verification)
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession()

  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const userAgent = req.headers.get('user-agent') || 'Unknown Browser'

    const { token, deviceId } = await createTrustedDevice(session.user.id, userAgent)

    // Calculate expiry date
    const expiresAt = new Date(Date.now() + DEVICE_TRUST_DAYS * 24 * 60 * 60 * 1000)

    // Create response with cookie
    const response = NextResponse.json({
      success: true,
      deviceId,
      message: 'Device trusted successfully',
    })

    // Set the trusted device cookie
    response.cookies.set('totp_trusted_device', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      expires: expiresAt,
      path: '/',
    })

    logger.info('Trusted device created via API', {
      context: 'POST /api/auth/2fa/trusted-devices',
      userId: session.user.id,
      deviceId,
    })

    return response
  } catch (error) {
    logger.error('Failed to create trusted device', { context: 'POST /api/auth/2fa/trusted-devices' }, error instanceof Error ? error : undefined)
    return NextResponse.json(
      { error: 'Failed to create trusted device' },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/auth/2fa/trusted-devices
 * Revoke a specific trusted device or all devices
 * Query params:
 *   - deviceId: specific device to revoke
 *   - all=true: revoke all devices
 */
export async function DELETE(req: NextRequest) {
  const session = await getServerSession()

  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(req.url)
  const deviceId = searchParams.get('deviceId')
  const revokeAll = searchParams.get('all') === 'true'

  try {
    if (revokeAll) {
      const count = await revokeAllTrustedDevices(session.user.id)

      // Clear the cookie
      const response = NextResponse.json({
        success: true,
        message: `Revoked ${count} device(s)`,
        revokedCount: count,
      })

      response.cookies.set('totp_trusted_device', '', {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        expires: new Date(0),
        path: '/',
      })

      logger.info('All trusted devices revoked', {
        context: 'DELETE /api/auth/2fa/trusted-devices',
        userId: session.user.id,
        revokedCount: count,
      })

      return response
    }

    if (!deviceId) {
      return NextResponse.json(
        { error: 'deviceId or all=true required' },
        { status: 400 }
      )
    }

    const success = await revokeTrustedDevice(session.user.id, deviceId)

    if (!success) {
      return NextResponse.json(
        { error: 'Device not found' },
        { status: 404 }
      )
    }

    // Note: We don't clear the cookie here because we don't know if this
    // is the current device. The cookie will fail verification on next login
    // if it was the revoked device.

    logger.info('Trusted device revoked', {
      context: 'DELETE /api/auth/2fa/trusted-devices',
      userId: session.user.id,
      deviceId,
    })

    return NextResponse.json({
      success: true,
      message: 'Device revoked successfully',
    })
  } catch (error) {
    logger.error('Failed to revoke trusted device', { context: 'DELETE /api/auth/2fa/trusted-devices' }, error instanceof Error ? error : undefined)
    return NextResponse.json(
      { error: 'Failed to revoke device' },
      { status: 500 }
    )
  }
}
