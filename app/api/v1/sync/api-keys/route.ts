/**
 * Sync API Keys API v1
 *
 * GET /api/v1/sync/api-keys - List all sync API keys
 * POST /api/v1/sync/api-keys - Create a new sync API key
 */

import { NextRequest, NextResponse } from 'next/server';
import { createAuthenticatedHandler } from '@/lib/api/middleware';
import { z } from 'zod';
import { logger } from '@/lib/logger';
import {
  badRequest,
  serverError,
  validationError,
  successResponse,
  created,
} from '@/lib/api/responses';
import { randomBytes } from 'crypto';

// ============================================================================
// Schemas
// ============================================================================

const createApiKeySchema = z.object({
  name: z.string().min(1).max(200),
  expiresAt: z.string().datetime().optional(),
});

// ============================================================================
// GET Handler
// ============================================================================

export const GET = createAuthenticatedHandler(async (req, context) => {
  try {
    logger.debug('[Sync API Keys v1] GET list', { userId: context.user.id });

    // TODO: Implement actual API key retrieval from database
    const apiKeys: any[] = [];

    logger.info('[Sync API Keys v1] Listed API keys', {
      count: apiKeys.length,
    });

    return successResponse({
      apiKeys,
      count: apiKeys.length,
    });
  } catch (error) {
    logger.error(
      '[Sync API Keys v1] Error listing API keys',
      {},
      error instanceof Error ? error : undefined
    );
    return serverError('Failed to list sync API keys');
  }
});

// ============================================================================
// POST Handler
// ============================================================================

export const POST = createAuthenticatedHandler(async (req, context) => {
  try {
    const body = await req.json();
    const validatedData = createApiKeySchema.parse(body);

    logger.info('[Sync API Keys v1] Creating API key', {
      name: validatedData.name,
    });

    const { user } = context;

    // Generate random API key
    const key = randomBytes(32).toString('hex');

    // TODO: Store API key in database
    const apiKeyId = randomBytes(16).toString('hex');

    logger.info('[Sync API Keys v1] API key created', {
      keyId: apiKeyId,
      name: validatedData.name,
    });

    return created({
      apiKey: {
        id: apiKeyId,
        name: validatedData.name,
        key, // Return full key only on creation
        createdAt: new Date().toISOString(),
        expiresAt: validatedData.expiresAt,
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return validationError(error);
    }

    logger.error(
      '[Sync API Keys v1] Error creating API key',
      {},
      error instanceof Error ? error : undefined
    );
    return serverError('Failed to create sync API key');
  }
});
