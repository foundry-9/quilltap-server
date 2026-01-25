/**
 * Auth API v1 - Signup Endpoint
 *
 * POST /api/v1/auth/signup - Create new user account
 */

import { NextRequest } from 'next/server';
import { z } from 'zod';
import { logger } from '@/lib/logger';
import {
  badRequest,
  serverError,
  validationError,
  created,
  conflict,
} from '@/lib/api/responses';
import { getRepositories } from '@/lib/repositories/factory';
import { hashPassword, validatePasswordStrength } from '@/lib/auth/password';

// ============================================================================
// Schemas
// ============================================================================

const signupSchema = z.object({
  email: z.email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  name: z.string().optional(),
});

// ============================================================================
// POST Handler
// ============================================================================

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { email, password, name } = signupSchema.parse(body);

    logger.info('[Auth v1] Signup attempt', { email });

    // Validate password strength
    const validation = validatePasswordStrength(password);
    if (!validation.valid) {
      return badRequest('Password does not meet requirements', { details: validation.errors });
    }

    const repos = getRepositories();

    // Check if user already exists
    const existing = await repos.users.findByEmail(email);
    if (existing) {
      return conflict('User with this email already exists');
    }

    // Hash password and create user
    const passwordHash = await hashPassword(password);
    const user = await repos.users.create({
      email,
      username: email, // Use email as username for v1
      name: name || null,
      passwordHash,
    });

    logger.info('[Auth v1] User created successfully', { userId: user.id, email });

    return created({
      message: 'Account created successfully',
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return validationError(error);
    }

    logger.error('[Auth v1] Signup error', {}, error instanceof Error ? error : undefined);
    return serverError('Failed to create account');
  }
}
