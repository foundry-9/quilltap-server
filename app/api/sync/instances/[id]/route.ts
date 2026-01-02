/**
 * Sync Instance Detail API
 *
 * GET /api/sync/instances/[id] - Get a sync instance
 * PUT /api/sync/instances/[id] - Update a sync instance
 * DELETE /api/sync/instances/[id] - Delete a sync instance
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { logger } from '@/lib/logger';
import { createAuthenticatedParamsHandler } from '@/lib/api/middleware';
import { encryptApiKey } from '@/lib/encryption';
import { notFound, badRequest, forbidden, serverError, validationError } from '@/lib/api/responses';

// Schema for updating a sync instance
const UpdateInstanceSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  apiKey: z.string().min(1).optional(),
  isActive: z.boolean().optional(),
});

/**
 * GET /api/sync/instances/[id]
 *
 * Get a specific sync instance.
 */
export const GET = createAuthenticatedParamsHandler<{ id: string }>(
  async (req, { user, repos }, { id }) => {
    const startTime = Date.now();

    try {
      logger.debug('Getting sync instance', {
        context: 'api:sync:instances:[id]',
        userId: user.id,
        instanceId: id,
      });

      const instance = await repos.syncInstances.findById(id);

      if (!instance) {
        logger.warn('Sync instance not found', {
          context: 'api:sync:instances:[id]',
          userId: user.id,
          instanceId: id,
        });
        return notFound('Instance');
      }

      // Verify ownership
      if (instance.userId !== user.id) {
        logger.warn('Sync instance access denied - not owner', {
          context: 'api:sync:instances:[id]',
          userId: user.id,
          instanceId: id,
          ownerId: instance.userId,
        });
        return forbidden();
      }

      const duration = Date.now() - startTime;

      logger.info('Sync instance GET complete', {
        context: 'api:sync:instances:[id]',
        userId: user.id,
        instanceId: id,
        durationMs: duration,
      });

      // Return sanitized instance (without API key)
      return NextResponse.json(
        {
          instance: {
            id: instance.id,
            name: instance.name,
            url: instance.url,
            isActive: instance.isActive,
            lastSyncAt: instance.lastSyncAt,
            lastSyncStatus: instance.lastSyncStatus,
            schemaVersion: instance.schemaVersion,
            appVersion: instance.appVersion,
            createdAt: instance.createdAt,
            updatedAt: instance.updatedAt,
          },
        },
        { status: 200 }
      );
    } catch (error) {
      const duration = Date.now() - startTime;

      logger.error('Error getting sync instance', {
        context: 'api:sync:instances:[id]',
        instanceId: id,
        error: error instanceof Error ? error.message : String(error),
        durationMs: duration,
      });

      return serverError();
    }
  }
);

/**
 * PUT /api/sync/instances/[id]
 *
 * Update a sync instance.
 */
export const PUT = createAuthenticatedParamsHandler<{ id: string }>(
  async (req, { user, repos }, { id }) => {
    const startTime = Date.now();

    try {
      // Parse request body
      let body: unknown;
      try {
        body = await req.json();
      } catch {
        logger.warn('Sync instance PUT received invalid JSON', {
          context: 'api:sync:instances:[id]',
          userId: user.id,
          instanceId: id,
        });
        return badRequest('Invalid JSON body');
      }

      // Validate request
      const parseResult = UpdateInstanceSchema.safeParse(body);
      if (!parseResult.success) {
        logger.warn('Sync instance PUT received invalid request', {
          context: 'api:sync:instances:[id]',
          userId: user.id,
          instanceId: id,
          errors: parseResult.error.errors,
        });
        return validationError(parseResult.error);
      }

      const updateData = parseResult.data;

      logger.info('Updating sync instance', {
        context: 'api:sync:instances:[id]',
        userId: user.id,
        instanceId: id,
        hasNameUpdate: !!updateData.name,
        hasApiKeyUpdate: !!updateData.apiKey,
        hasActiveUpdate: updateData.isActive !== undefined,
      });

      const instance = await repos.syncInstances.findById(id);

      if (!instance) {
        logger.warn('Sync instance not found for update', {
          context: 'api:sync:instances:[id]',
          userId: user.id,
          instanceId: id,
        });
        return notFound('Instance');
      }

      // Verify ownership
      if (instance.userId !== user.id) {
        logger.warn('Sync instance update denied - not owner', {
          context: 'api:sync:instances:[id]',
          userId: user.id,
          instanceId: id,
          ownerId: instance.userId,
        });
        return forbidden();
      }

      // Build update object
      const updates: Record<string, unknown> = {};

      if (updateData.name) {
        updates.name = updateData.name;
      }

      if (updateData.apiKey) {
        const encryptedResult = encryptApiKey(updateData.apiKey, user.id);
        updates.apiKey = {
          ciphertext: encryptedResult.encrypted,
          iv: encryptedResult.iv,
          authTag: encryptedResult.authTag,
        };
      }

      if (updateData.isActive !== undefined) {
        updates.isActive = updateData.isActive;
      }

      // Update instance
      const updatedInstance = await repos.syncInstances.update(id, updates);

      if (!updatedInstance) {
        logger.error('Failed to update sync instance', {
          context: 'api:sync:instances:[id]',
          userId: user.id,
          instanceId: id,
        });
        return serverError('Failed to update instance');
      }

      const duration = Date.now() - startTime;

      logger.info('Sync instance updated', {
        context: 'api:sync:instances:[id]',
        userId: user.id,
        instanceId: id,
        durationMs: duration,
      });

      // Return sanitized instance
      return NextResponse.json(
        {
          instance: {
            id: updatedInstance.id,
            name: updatedInstance.name,
            url: updatedInstance.url,
            isActive: updatedInstance.isActive,
            lastSyncAt: updatedInstance.lastSyncAt,
            lastSyncStatus: updatedInstance.lastSyncStatus,
            schemaVersion: updatedInstance.schemaVersion,
            appVersion: updatedInstance.appVersion,
            createdAt: updatedInstance.createdAt,
            updatedAt: updatedInstance.updatedAt,
          },
        },
        { status: 200 }
      );
    } catch (error) {
      const duration = Date.now() - startTime;

      logger.error('Error updating sync instance', {
        context: 'api:sync:instances:[id]',
        instanceId: id,
        error: error instanceof Error ? error.message : String(error),
        durationMs: duration,
      });

      return serverError();
    }
  }
);

/**
 * DELETE /api/sync/instances/[id]
 *
 * Delete a sync instance and all its mappings.
 */
export const DELETE = createAuthenticatedParamsHandler<{ id: string }>(
  async (req, { user, repos }, { id }) => {
    const startTime = Date.now();

    try {
      logger.info('Deleting sync instance', {
        context: 'api:sync:instances:[id]',
        userId: user.id,
        instanceId: id,
      });

      const instance = await repos.syncInstances.findById(id);

      if (!instance) {
        logger.warn('Sync instance not found for deletion', {
          context: 'api:sync:instances:[id]',
          userId: user.id,
          instanceId: id,
        });
        return notFound('Instance');
      }

      // Verify ownership
      if (instance.userId !== user.id) {
        logger.warn('Sync instance deletion denied - not owner', {
          context: 'api:sync:instances:[id]',
          userId: user.id,
          instanceId: id,
          ownerId: instance.userId,
        });
        return forbidden();
      }

      // Delete all mappings for this instance
      const deletedMappings = await repos.syncMappings.deleteByInstanceId(id);

      // Delete the instance
      await repos.syncInstances.delete(id);

      const duration = Date.now() - startTime;

      logger.info('Sync instance deleted', {
        context: 'api:sync:instances:[id]',
        userId: user.id,
        instanceId: id,
        deletedMappings,
        durationMs: duration,
      });

      return NextResponse.json(
        { success: true, deletedMappings },
        { status: 200 }
      );
    } catch (error) {
      const duration = Date.now() - startTime;

      logger.error('Error deleting sync instance', {
        context: 'api:sync:instances:[id]',
        instanceId: id,
        error: error instanceof Error ? error.message : String(error),
        durationMs: duration,
      });

      return serverError();
    }
  }
);
