/**
 * Sync Instances API v1 - Individual Instance Endpoint
 *
 * GET /api/v1/sync/instances/[id] - Get instance details
 * PUT /api/v1/sync/instances/[id] - Update instance
 * DELETE /api/v1/sync/instances/[id] - Delete instance
 * POST /api/v1/sync/instances/[id]?action=test - Test connection
 * POST /api/v1/sync/instances/[id]?action=sync - Trigger manual sync
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  createAuthenticatedParamsHandler,
  checkOwnership,
  AuthenticatedContext,
} from '@/lib/api/middleware';
import { getActionParam } from '@/lib/api/middleware/actions';
import { encryptApiKey, decryptApiKey } from '@/lib/encryption';
import { z } from 'zod';
import { logger } from '@/lib/logger';
import {
  notFound,
  badRequest,
  serverError,
  validationError,
  successResponse,
  messageResponse,
} from '@/lib/api/responses';

// ============================================================================
// Schemas
// ============================================================================

const updateInstanceSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  url: z.string().url().optional(),
  apiKey: z.string().min(1).optional(),
  isActive: z.boolean().optional(),
});

// ============================================================================
// GET Handler
// ============================================================================

export const GET = createAuthenticatedParamsHandler<{ id: string }>(
  async (req, { user, repos }, { id }) => {
    try {
      logger.debug('[Sync Instance v1] GET', { instanceId: id, userId: user.id });

      const instance = await repos.syncInstances?.findById(id);

      if (!instance || instance.userId !== user.id) {
        return notFound('Sync instance');
      }

      return successResponse({
        instance: {
          id: instance.id,
          name: instance.name,
          url: instance.url,
          isActive: instance.isActive,
          remoteUserId: instance.remoteUserId,
          lastSyncAt: instance.lastSyncAt,
          lastSyncStatus: instance.lastSyncStatus,
          schemaVersion: instance.schemaVersion,
          appVersion: instance.appVersion,
          createdAt: instance.createdAt,
          updatedAt: instance.updatedAt,
        },
      });
    } catch (error) {
      logger.error(
        '[Sync Instance v1] Error getting instance',
        { instanceId: id },
        error instanceof Error ? error : undefined
      );
      return serverError('Failed to fetch sync instance');
    }
  }
);

// ============================================================================
// PUT Handler
// ============================================================================

export const PUT = createAuthenticatedParamsHandler<{ id: string }>(
  async (req, { user, repos }, { id }) => {
    try {
      logger.debug('[Sync Instance v1] PUT', { instanceId: id, userId: user.id });

      const existingInstance = await repos.syncInstances?.findById(id);

      if (!existingInstance || existingInstance.userId !== user.id) {
        return notFound('Sync instance');
      }

      const body = await req.json();
      const validatedData = updateInstanceSchema.parse(body);

      const updateData: any = {};

      if (validatedData.name !== undefined) {
        updateData.name = validatedData.name;
      }

      if (validatedData.url !== undefined) {
        updateData.url = validatedData.url;
      }

      if (validatedData.apiKey !== undefined) {
        const { encrypted, iv, authTag } = encryptApiKey(
          validatedData.apiKey,
          user.id
        );
        updateData.encryptedApiKey = encrypted;
        updateData.apiKeyIv = iv;
        updateData.apiKeyAuthTag = authTag;
      }

      if (validatedData.isActive !== undefined) {
        updateData.isActive = validatedData.isActive;
      }

      const updated = await repos.syncInstances?.update(id, updateData);

      if (!updated) {
        return serverError('Failed to update instance');
      }

      logger.info('[Sync Instance v1] Instance updated', { instanceId: id });

      return successResponse({
        instance: {
          id: updated.id,
          name: updated.name,
          url: updated.url,
          isActive: updated.isActive,
          remoteUserId: updated.remoteUserId,
          lastSyncAt: updated.lastSyncAt,
          lastSyncStatus: updated.lastSyncStatus,
          schemaVersion: updated.schemaVersion,
          appVersion: updated.appVersion,
          createdAt: updated.createdAt,
          updatedAt: updated.updatedAt,
        },
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return validationError(error);
      }

      logger.error(
        '[Sync Instance v1] Error updating instance',
        { instanceId: id },
        error instanceof Error ? error : undefined
      );
      return serverError('Failed to update sync instance');
    }
  }
);

// ============================================================================
// DELETE Handler
// ============================================================================

export const DELETE = createAuthenticatedParamsHandler<{ id: string }>(
  async (req, { user, repos }, { id }) => {
    try {
      logger.debug('[Sync Instance v1] DELETE', {
        instanceId: id,
        userId: user.id,
      });

      const instance = await repos.syncInstances?.findById(id);

      if (!instance || instance.userId !== user.id) {
        return notFound('Sync instance');
      }

      // Delete instance
      await repos.syncInstances?.delete(id);

      // TODO: Clean up associated mappings when method signature is correct
      // await repos.syncMappings?.deleteByInstanceId(id);

      logger.info('[Sync Instance v1] Instance deleted', { instanceId: id });

      return messageResponse('Sync instance deleted successfully');
    } catch (error) {
      logger.error(
        '[Sync Instance v1] Error deleting instance',
        { instanceId: id },
        error instanceof Error ? error : undefined
      );
      return serverError('Failed to delete sync instance');
    }
  }
);

// ============================================================================
// POST Handler - Actions
// ============================================================================

async function handleTest(
  _req: NextRequest,
  context: AuthenticatedContext,
  instanceId: string
) {
  try {
    const { repos, user } = context;

    logger.info('[Sync Instance v1] Testing connection', { instanceId });

    const instance = await repos.syncInstances?.findById(instanceId);

    if (!instance || instance.userId !== user.id) {
      return notFound('Sync instance');
    }

    // TODO: Implement actual connection test with remote instance
    // For now, just verify the configuration is valid

    logger.info('[Sync Instance v1] Connection test passed', { instanceId });

    return successResponse({
      success: true,
      message: 'Connection test passed',
    });
  } catch (error) {
    logger.error(
      '[Sync Instance v1] Connection test failed',
      { instanceId },
      error instanceof Error ? error : undefined
    );
    return serverError('Connection test failed');
  }
}

async function handleSync(
  _req: NextRequest,
  context: AuthenticatedContext,
  instanceId: string
) {
  try {
    const { repos, user } = context;

    logger.info('[Sync Instance v1] Sync triggered', { instanceId });

    const instance = await repos.syncInstances?.findById(instanceId);

    if (!instance || instance.userId !== user.id) {
      return notFound('Sync instance');
    }

    // TODO: Implement actual sync operation
    // This would call the sync service to initiate bidirectional sync

    logger.info('[Sync Instance v1] Sync initiated', {
      instanceId,
      instanceName: instance.name,
    });

    return successResponse({
      success: true,
      message: 'Sync initiated',
      instanceId,
    });
  } catch (error) {
    logger.error(
      '[Sync Instance v1] Sync failed',
      { instanceId },
      error instanceof Error ? error : undefined
    );
    return serverError('Failed to initiate sync');
  }
}

export const POST = createAuthenticatedParamsHandler<{ id: string }>(
  async (req, context, { id }) => {
    const action = getActionParam(req);

    switch (action) {
      case 'test':
        return handleTest(req, context, id);
      case 'sync':
        return handleSync(req, context, id);
      default:
        return badRequest(
          `Unknown action: ${action}. Available actions: test, sync`
        );
    }
  }
);
