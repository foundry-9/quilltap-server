/**
 * Sync API Key Individual Operations
 *
 * PATCH /api/sync/api-keys/[id] - Update an API key (name, active status)
 * DELETE /api/sync/api-keys/[id] - Delete an API key
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { logger } from '@/lib/logger';
import { createAuthenticatedParamsHandler } from '@/lib/api/middleware';
import { notFound, badRequest, forbidden, serverError, validationError } from '@/lib/api/responses';

// Schema for updating an API key
const UpdateApiKeySchema = z.object({
  name: z.string().min(1).max(100).optional(),
  isActive: z.boolean().optional(),
});

/**
 * PATCH /api/sync/api-keys/[id]
 *
 * Update an API key's name or active status.
 */
export const PATCH = createAuthenticatedParamsHandler<{ id: string }>(
  async (req, { user, repos }, { id }) => {
    const startTime = Date.now();

    try {
      // Parse request body
      let body: unknown;
      try {
        body = await req.json();
      } catch {
        logger.warn('Sync API key PATCH received invalid JSON', {
          context: 'api:sync:api-keys',
          userId: user.id,
          keyId: id,
        });
        return badRequest('Invalid JSON body');
      }

      // Validate request
      const parseResult = UpdateApiKeySchema.safeParse(body);
      if (!parseResult.success) {
        logger.warn('Sync API key PATCH received invalid request', {
          context: 'api:sync:api-keys',
          userId: user.id,
          keyId: id,
          errors: parseResult.error.errors,
        });
        return validationError(parseResult.error);
      }

      logger.debug('Updating sync API key', {
        context: 'api:sync:api-keys',
        userId: user.id,
        keyId: id,
      });

      // Check key exists and belongs to user
      const existingKey = await repos.userSyncApiKeys.findById(id);
      if (!existingKey) {
        logger.warn('Sync API key not found for update', {
          context: 'api:sync:api-keys',
          userId: user.id,
          keyId: id,
        });
        return notFound('API key');
      }

      if (existingKey.userId !== user.id) {
        logger.warn('Sync API key update forbidden - wrong user', {
          context: 'api:sync:api-keys',
          userId: user.id,
          keyId: id,
          keyUserId: existingKey.userId,
        });
        return forbidden();
      }

      // Update the key
      const updatedKey = await repos.userSyncApiKeys.update(id, parseResult.data);

      if (!updatedKey) {
        logger.error('Failed to update sync API key', {
          context: 'api:sync:api-keys',
          userId: user.id,
          keyId: id,
        });
        return serverError('Failed to update API key');
      }

      const duration = Date.now() - startTime;

      logger.info('Sync API key updated', {
        context: 'api:sync:api-keys',
        userId: user.id,
        keyId: id,
        durationMs: duration,
      });

      return NextResponse.json(
        {
          key: {
            id: updatedKey.id,
            name: updatedKey.name,
            keyPrefix: updatedKey.keyPrefix,
            isActive: updatedKey.isActive,
            lastUsedAt: updatedKey.lastUsedAt,
            createdAt: updatedKey.createdAt,
            updatedAt: updatedKey.updatedAt,
          },
        },
        { status: 200 }
      );
    } catch (error) {
      const duration = Date.now() - startTime;

      logger.error('Error updating sync API key', {
        context: 'api:sync:api-keys',
        keyId: id,
        error: error instanceof Error ? error.message : String(error),
        durationMs: duration,
      });

      return serverError();
    }
  }
);

/**
 * DELETE /api/sync/api-keys/[id]
 *
 * Delete an API key.
 */
export const DELETE = createAuthenticatedParamsHandler<{ id: string }>(
  async (req, { user, repos }, { id }) => {
    const startTime = Date.now();

    try {
      logger.debug('Deleting sync API key', {
        context: 'api:sync:api-keys',
        userId: user.id,
        keyId: id,
      });

      // Check key exists and belongs to user
      const existingKey = await repos.userSyncApiKeys.findById(id);
      if (!existingKey) {
        logger.warn('Sync API key not found for delete', {
          context: 'api:sync:api-keys',
          userId: user.id,
          keyId: id,
        });
        return notFound('API key');
      }

      if (existingKey.userId !== user.id) {
        logger.warn('Sync API key delete forbidden - wrong user', {
          context: 'api:sync:api-keys',
          userId: user.id,
          keyId: id,
          keyUserId: existingKey.userId,
        });
        return forbidden();
      }

      // Delete the key
      const deleted = await repos.userSyncApiKeys.delete(id);

      if (!deleted) {
        logger.error('Failed to delete sync API key', {
          context: 'api:sync:api-keys',
          userId: user.id,
          keyId: id,
        });
        return serverError('Failed to delete API key');
      }

      const duration = Date.now() - startTime;

      logger.info('Sync API key deleted', {
        context: 'api:sync:api-keys',
        userId: user.id,
        keyId: id,
        durationMs: duration,
      });

      return NextResponse.json({ success: true }, { status: 200 });
    } catch (error) {
      const duration = Date.now() - startTime;

      logger.error('Error deleting sync API key', {
        context: 'api:sync:api-keys',
        keyId: id,
        error: error instanceof Error ? error.message : String(error),
        durationMs: duration,
      });

      return serverError();
    }
  }
);
