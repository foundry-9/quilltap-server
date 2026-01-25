/**
 * Auth API v1 - Trusted Devices Endpoint
 *
 * GET /api/v1/auth/2fa/trusted-devices - List trusted devices
 * POST /api/v1/auth/2fa/trusted-devices - Create trusted device
 * DELETE /api/v1/auth/2fa/trusted-devices - Revoke trusted device(s)
 */

import { NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import {
  badRequest,
  notFound,
  serverError,
  successResponse,
} from '@/lib/api/responses';
import { createAuthenticatedHandler } from '@/lib/api/middleware';
import {
  createTrustedDevice,
  listTrustedDevices,
  revokeTrustedDevice,
  revokeAllTrustedDevices,
} from '@/lib/auth/totp';

const DEVICE_TRUST_DAYS = 30;

// ============================================================================
// GET Handler - List trusted devices
// ============================================================================

export const GET = createAuthenticatedHandler(async (req, { user }) => {
  try {
    const devices = await listTrustedDevices(user.id);return successResponse({ devices });
  } catch (error) {
    logger.error('[Auth v1] Failed to list trusted devices', { userId: user.id }, error instanceof Error ? error : undefined);
    return serverError('Failed to list trusted devices');
  }
});

// ============================================================================
// POST Handler - Create trusted device
// ============================================================================

export const POST = createAuthenticatedHandler(async (req, { user }) => {
  try {
    const userAgent = req.headers.get('user-agent') || 'Unknown Browser';

    const { token, deviceId } = await createTrustedDevice(user.id, userAgent);

    // Calculate expiry date
    const expiresAt = new Date(Date.now() + DEVICE_TRUST_DAYS * 24 * 60 * 60 * 1000);

    // Create response with cookie
    const response = NextResponse.json(
      {
        success: true,
        data: {
          deviceId,
          message: 'Device trusted successfully',
        },
      },
      { status: 200 }
    );

    // Set the trusted device cookie
    response.cookies.set('totp_trusted_device', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      expires: expiresAt,
      path: '/',
    });

    logger.info('[Auth v1] Trusted device created', {
      userId: user.id,
      deviceId,
    });

    return response;
  } catch (error) {
    logger.error('[Auth v1] Failed to create trusted device', { userId: user.id }, error instanceof Error ? error : undefined);
    return serverError('Failed to create trusted device');
  }
});

// ============================================================================
// DELETE Handler - Revoke trusted device(s)
// ============================================================================

export const DELETE = createAuthenticatedHandler(async (req, { user }) => {
  const { searchParams } = new URL(req.url);
  const deviceId = searchParams.get('deviceId');
  const revokeAll = searchParams.get('all') === 'true';

  try {
    if (revokeAll) {
      const count = await revokeAllTrustedDevices(user.id);

      // Clear the cookie
      const response = NextResponse.json(
        {
          success: true,
          data: {
            message: `Revoked ${count} device(s)`,
            revokedCount: count,
          },
        },
        { status: 200 }
      );

      response.cookies.set('totp_trusted_device', '', {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        expires: new Date(0),
        path: '/',
      });

      logger.info('[Auth v1] All trusted devices revoked', {
        userId: user.id,
        revokedCount: count,
      });

      return response;
    }

    if (!deviceId) {
      return badRequest('deviceId or all=true required');
    }

    const success = await revokeTrustedDevice(user.id, deviceId);

    if (!success) {
      return notFound('Device not found');
    }

    logger.info('[Auth v1] Trusted device revoked', {
      userId: user.id,
      deviceId,
    });

    return successResponse({
      message: 'Device revoked successfully',
    });
  } catch (error) {
    logger.error('[Auth v1] Failed to revoke trusted device', { userId: user.id }, error instanceof Error ? error : undefined);
    return serverError('Failed to revoke device');
  }
});
