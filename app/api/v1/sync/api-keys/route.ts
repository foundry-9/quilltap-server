/**
 * Sync API Keys API v1
 *
 * GET /api/v1/sync/api-keys - List all sync API keys
 * POST /api/v1/sync/api-keys - Create a new sync API key
 */

import { createAuthenticatedHandler } from '@/lib/api/middleware';
import { z } from 'zod';
import { logger } from '@/lib/logger';
import {
  serverError,
  validationError,
  successResponse,
  created,
} from '@/lib/api/responses';
import { getRepositories } from '@/lib/repositories/factory';

// ============================================================================
// Schemas
// ============================================================================

const createApiKeySchema = z.object({
  name: z.string().min(1).max(200),
});

// ============================================================================
// GET Handler
// ============================================================================

export const GET = createAuthenticatedHandler(async (req, context) => {
  try {
    logger.debug('[Sync API Keys v1] GET list', { userId: context.user.id });

    const repos = await getRepositories();
    const apiKeys = await repos.userSyncApiKeys.findByUserId(context.user.id);

    // Map to display format (without sensitive keyHash)
    const displayKeys = apiKeys.map((key) => ({
      id: key.id,
      name: key.name,
      keyPrefix: key.keyPrefix,
      isActive: key.isActive,
      lastUsedAt: key.lastUsedAt,
      createdAt: key.createdAt,
      updatedAt: key.updatedAt,
    }));

    logger.info('[Sync API Keys v1] Listed API keys', {
      count: displayKeys.length,
    });

    // Return in format expected by useSyncApiKeys hook: { keys: [...] }
    return successResponse({
      keys: displayKeys,
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

    const repos = await getRepositories();
    const result = await repos.userSyncApiKeys.createApiKey(
      context.user.id,
      validatedData.name
    );

    logger.info('[Sync API Keys v1] API key created', {
      keyId: result.key.id,
      name: validatedData.name,
    });

    // Return in format expected by useSyncApiKeys hook: { key: SyncApiKeyDisplay, plaintextKey: string }
    return created({
      key: {
        id: result.key.id,
        name: result.key.name,
        keyPrefix: result.key.keyPrefix,
        isActive: result.key.isActive,
        lastUsedAt: result.key.lastUsedAt,
        createdAt: result.key.createdAt,
        updatedAt: result.key.updatedAt,
      },
      plaintextKey: result.plaintextKey,
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
