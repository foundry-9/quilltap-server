/**
 * Auth API v1 - Login Endpoint
 *
 * POST /api/v1/auth/login - Authenticate user and create session
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { logger } from '@/lib/logger';
import {
  badRequest,
  serverError,
  validationError,
  successResponse,
  unauthorized,
} from '@/lib/api/responses';
import { getRepositories } from '@/lib/repositories/factory';
import { createSessionToken, type SessionPayload } from '@/lib/auth/session/jwt';
import { setSessionCookieFromAction } from '@/lib/auth/session/cookies';
import { verifyPassword } from '@/lib/auth/password';

// ============================================================================
// Schemas
// ============================================================================

const loginSchema = z.object({
  email: z.email(),
  password: z.string().min(1),
});

// ============================================================================
// POST Handler
// ============================================================================

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { email, password } = loginSchema.parse(body);

    logger.info('[Auth v1] Login attempt', { email });

    const repos = getRepositories();

    // Find user by email
    const user = await repos.users.findByEmail(email);

    if (!user) {
      logger.warn('[Auth v1] Login failed - user not found', { email });
      return unauthorized('Invalid email or password');
    }

    // Verify password
    if (!user.passwordHash) {
      logger.warn('[Auth v1] Login failed - user has no password', { email });
      return unauthorized('Invalid email or password');
    }

    const isValidPassword = await verifyPassword(password, user.passwordHash);

    if (!isValidPassword) {
      logger.warn('[Auth v1] Login failed - invalid password', { email });
      return unauthorized('Invalid email or password');
    }

    // Create session token
    const sessionPayload: SessionPayload = {
      userId: user.id,
      email: user.email || '',
      name: user.name,
      image: user.image,
    };
    const token = await createSessionToken(sessionPayload);

    // Set session cookie via server action
    await setSessionCookieFromAction(token);

    // Return success response
    const response = NextResponse.json(
      {
        success: true,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          image: user.image,
        },
      },
      { status: 200 }
    );

    logger.info('[Auth v1] Login successful', { userId: user.id, email });

    return response;
  } catch (error) {
    if (error instanceof z.ZodError) {
      return validationError(error);
    }

    logger.error(
      '[Auth v1] Login error',
      {},
      error instanceof Error ? error : undefined
    );
    return serverError('Login failed');
  }
}
