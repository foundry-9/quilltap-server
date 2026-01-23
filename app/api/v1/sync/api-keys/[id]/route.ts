/**
 * Sync API Keys API v1 - Individual API Key Endpoint
 *
 * PATCH /api/v1/sync/api-keys/[id] - Update API key (name, isActive)
 * DELETE /api/v1/sync/api-keys/[id] - Delete API key
 */

import { z } from 'zod';
import { createAuthenticatedParamsHandler } from '@/lib/api/middleware';
import { logger } from '@/lib/logger';
import {
  notFound,
  badRequest,
  forbidden,
  serverError,
  validationError,
  successResponse,
  messageResponse,
} from '@/lib/api/responses';

// ============================================================================
// Schemas
// ============================================================================

const updateApiKeySchema = z.object({
  name: z.string().min(1).max(100).optional(),
  isActive: z.boolean().optional(),
});

// ============================================================================
// PATCH Handler
// ============================================================================

export const PATCH = createAuthenticatedParamsHandler<{ id: string }>(
  async (req, { user, repos }, { id }) => {
    const startTime = Date.now();

    try {
      logger.debug('[Sync API Keys v1] PATCH', { keyId: id, userId: user.id });

      // Parse request body
      let body: unknown;
      try {
        body = await req.json();
      } catch {
        logger.warn('[Sync API Keys v1] Invalid JSON body', {
          keyId: id,
          userId: user.id,
        });
        return badRequest('Invalid JSON body');
      }

      // Validate request
      const parseResult = updateApiKeySchema.safeParse(body);
      if (!parseResult.success) {
        logger.warn('[Sync API Keys v1] Validation failed', {
          keyId: id,
          userId: user.id,
          errors: parseResult.error.errors,
        });
        return validationError(parseResult.error);
      }

      // Check key exists and belongs to user
      const existingKey = await repos.userSyncApiKeys.findById(id);
      if (!existingKey) {
        logger.warn('[Sync API Keys v1] Key not found', {
          keyId: id,
          userId: user.id,
        });
        return notFound('API key');
      }

      if (existingKey.userId !== user.id) {
        logger.warn('[Sync API Keys v1] Ownership check failed', {
          keyId: id,
          userId: user.id,
          keyUserId: existingKey.userId,
        });
        return forbidden();
      }

      // Update the key
      const updatedKey = await repos.userSyncApiKeys.update(id, parseResult.data);

      if (!updatedKey) {
        logger.error('[Sync API Keys v1] Update failed', {
          keyId: id,
          userId: user.id,
        });
        return serverError('Failed to update API key');
      }

      const duration = Date.now() - startTime;
      logger.info('[Sync API Keys v1] Key updated', {
        keyId: id,
        userId: user.id,
        durationMs: duration,
      });

      return successResponse({
        key: {
          id: updatedKey.id,
          name: updatedKey.name,
          keyPrefix: updatedKey.keyPrefix,
          isActive: updatedKey.isActive,
          lastUsedAt: updatedKey.lastUsedAt,
          createdAt: updatedKey.createdAt,
          updatedAt: updatedKey.updatedAt,
        },
      });
    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error(
        '[Sync API Keys v1] Error updating key',
        { keyId: id, durationMs: duration },
        error instanceof Error ? error : undefined
      );
      return serverError('Failed to update API key');
    }
  }
);

// ============================================================================
// DELETE Handler
// ============================================================================

export const DELETE = createAuthenticatedParamsHandler<{ id: string }>(
  async (req, { user, repos }, { id }) => {
    const startTime = Date.now();

    try {
      logger.debug('[Sync API Keys v1] DELETE', { keyId: id, userId: user.id });

      // Check key exists and belongs to user
      const existingKey = await repos.userSyncApiKeys.findById(id);
      if (!existingKey) {
        logger.warn('[Sync API Keys v1] Key not found for delete', {
          keyId: id,
          userId: user.id,
        });
        return notFound('API key');
      }

      if (existingKey.userId !== user.id) {
        logger.warn('[Sync API Keys v1] Delete ownership check failed', {
          keyId: id,
          userId: user.id,
          keyUserId: existingKey.userId,
        });
        return forbidden();
      }

      // Delete the key
      const deleted = await repos.userSyncApiKeys.delete(id);

      if (!deleted) {
        logger.error('[Sync API Keys v1] Delete operation failed', {
          keyId: id,
          userId: user.id,
        });
        return serverError('Failed to delete API key');
      }

      const duration = Date.now() - startTime;
      logger.info('[Sync API Keys v1] Key deleted', {
        keyId: id,
        userId: user.id,
        durationMs: duration,
      });

      return messageResponse('API key deleted successfully');
    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error(
        '[Sync API Keys v1] Error deleting key',
        { keyId: id, durationMs: duration },
        error instanceof Error ? error : undefined
      );
      return serverError('Failed to delete API key');
    }
  }
);
