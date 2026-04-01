/**
 * Credentials Login API Route
 *
 * POST /api/auth/login
 *
 * Authenticates users with username/password and optional TOTP 2FA.
 * Sets session cookie on successful authentication.
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyPassword } from '@/lib/auth/password';
import { getRepositories } from '@/lib/repositories/factory';
import { createSessionToken, setSessionCookie } from '@/lib/auth/session';
import { runPostLoginMigrations } from '@/lib/auth/user-migrations';
import { logger } from '@/lib/logger';

interface LoginRequest {
  username: string;
  password: string;
  totpCode?: string;
  trustedDeviceToken?: string;
  rememberDevice?: boolean;
}

interface LoginResponse {
  success: boolean;
  user?: {
    id: string;
    email: string;
    name?: string | null;
    image?: string | null;
  };
  requires2FA?: boolean;
  error?: string;
}

export async function POST(request: NextRequest): Promise<NextResponse<LoginResponse>> {
  try {
    const body = (await request.json()) as LoginRequest;
    const { username, password, totpCode, trustedDeviceToken, rememberDevice } = body;

    // Validate required fields
    if (!username || !password) {
      logger.debug('Missing credentials', {
        context: 'login.POST',
        hasUsername: !!username,
      });
      return NextResponse.json(
        { success: false, error: 'Username and password are required' },
        { status: 400 }
      );
    }

    // Find user from MongoDB
    const user = await getRepositories().users.findByUsername(username);

    if (!user?.passwordHash) {
      logger.debug('User not found or no password hash', {
        context: 'login.POST',
        username,
      });
      return NextResponse.json(
        { success: false, error: 'Invalid username or password' },
        { status: 401 }
      );
    }

    // Verify password
    const valid = await verifyPassword(password, user.passwordHash);

    if (!valid) {
      logger.debug('Invalid password', { context: 'login.POST', username });
      return NextResponse.json(
        { success: false, error: 'Invalid username or password' },
        { status: 401 }
      );
    }

    // Check if 2FA is enabled
    if (user.totp?.enabled) {
      const { verifyTOTP, checkTOTPLockout, verifyTrustedDevice } = await import(
        '@/lib/auth/totp'
      );

      // Check for lockout first
      const lockoutStatus = await checkTOTPLockout(user.id);
      if (lockoutStatus.locked) {
        logger.debug('Account locked due to too many 2FA attempts', {
          context: 'login.POST',
          username,
          secondsRemaining: lockoutStatus.secondsRemaining,
        });
        return NextResponse.json(
          {
            success: false,
            error: `Account temporarily locked. Try again in ${lockoutStatus.secondsRemaining} seconds.`,
          },
          { status: 429 }
        );
      }

      // Check for trusted device first (bypass TOTP if valid)
      let deviceTrusted = false;
      if (trustedDeviceToken) {
        deviceTrusted = await verifyTrustedDevice(user.id, trustedDeviceToken);
        if (deviceTrusted) {
          logger.debug('TOTP bypassed via trusted device', {
            context: 'login.POST',
            username,
          });
        }
      }

      // If device not trusted, require TOTP
      if (!deviceTrusted) {
        if (!totpCode) {
          logger.debug('2FA required but not provided', {
            context: 'login.POST',
            username,
          });
          return NextResponse.json(
            { success: false, requires2FA: true, error: '2FA code required' },
            { status: 200 } // Return 200 to indicate this is a normal flow, not an error
          );
        }

        // Verify TOTP code
        const totpValid = await verifyTOTP(user.id, totpCode);

        if (!totpValid) {
          // Check if now locked after this attempt
          const newLockoutStatus = await checkTOTPLockout(user.id);
          if (newLockoutStatus.locked) {
            logger.debug('Account now locked after failed 2FA attempt', {
              context: 'login.POST',
              username,
            });
            return NextResponse.json(
              {
                success: false,
                error: `Invalid 2FA code. Account locked for ${newLockoutStatus.secondsRemaining} seconds.`,
              },
              { status: 429 }
            );
          }
          logger.debug('Invalid 2FA code', { context: 'login.POST', username });
          return NextResponse.json(
            { success: false, error: 'Invalid 2FA code' },
            { status: 401 }
          );
        }
      }
    }

    logger.info('User authenticated successfully', {
      context: 'login.POST',
      userId: user.id,
      username: user.username,
    });

    // Run post-login migrations
    try {
      await runPostLoginMigrations(user.id);
    } catch (migrationError) {
      // Log but don't block login if migrations fail
      logger.error(
        'Post-login migrations failed',
        { context: 'login.POST', userId: user.id },
        migrationError instanceof Error ? migrationError : undefined
      );
    }

    // Create session token
    const token = await createSessionToken({
      userId: user.id,
      email: user.email || user.username,
      name: user.name,
      image: user.image,
    });

    // Create response with session cookie
    const response = NextResponse.json({
      success: true,
      user: {
        id: user.id,
        email: user.email || user.username,
        name: user.name,
        image: user.image,
      },
    });

    // Set session cookie
    setSessionCookie(response, token);

    // If remember device was requested and 2FA was verified, create trusted device
    // This is handled by the frontend calling /api/auth/2fa/trusted-devices

    return response;
  } catch (error) {
    logger.error(
      'Login error',
      { context: 'login.POST' },
      error instanceof Error ? error : undefined
    );
    return NextResponse.json(
      { success: false, error: 'An error occurred during login' },
      { status: 500 }
    );
  }
}
