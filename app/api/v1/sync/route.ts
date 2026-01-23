/**
 * Sync API v1 - Server-side collection endpoints
 *
 * POST /api/v1/sync?action=handshake - Version check and authentication
 * POST /api/v1/sync?action=delta - Fetch entities changed since timestamp
 * POST /api/v1/sync?action=push - Receive entities from remote instance
 * GET/POST /api/v1/sync?action=mappings - Exchange UUID mappings
 * POST /api/v1/sync?action=cleanup - Cleanup old sync data
 */

import { NextRequest, NextResponse } from 'next/server';
import { getActionParam } from '@/lib/api/middleware/actions';
import {
  createSyncAuthenticatedHandler,
  SyncAuthenticatedContext,
} from '@/lib/sync/api-key-auth';
import {
  checkVersionCompatibility,
  getLocalVersionInfo,
} from '@/lib/sync/version-checker';
import { detectDeltas } from '@/lib/sync/delta-detector';
import { applyRemoteDelta } from '@/lib/sync/sync-service';
import { z } from 'zod';
import { logger } from '@/lib/logger';
import {
  badRequest,
  serverError,
  serviceUnavailable,
  validationError,
  successResponse,
} from '@/lib/api/responses';
import {
  initializePlugins,
  isPluginSystemInitialized,
} from '@/lib/startup/plugin-initialization';
import type { SyncableEntityType } from '@/lib/sync/types';
import { SyncDeltaRequestSchema, SyncEntityDeltaSchema, SyncableEntityTypeEnum } from '@/lib/sync/types';

// ============================================================================
// Schemas
// ============================================================================

// Handshake request - matches SyncHandshakeRequestSchema from types.ts
const handshakeSchema = z.object({
  versionInfo: z.object({
    appVersion: z.string(),
    schemaVersion: z.string(),
    syncProtocolVersion: z.string(),
    supportedEntityTypes: z.array(z.string()),
  }),
  // Optional authentication fields
  email: z.string().email().optional(),
  password: z.string().optional(),
  apiKey: z.string().optional(),
});

// Using SyncDeltaRequestSchema from types.ts for consistency

// Push schema - accepts deltas from the client
// With ID preservation, mappings are optional (entities keep their original IDs)
const pushDataSchema = z.object({
  deltas: z.array(SyncEntityDeltaSchema),
  // Legacy support for mappings if provided
  mappings: z.array(
    z.object({
      localId: z.string().uuid(),
      remoteId: z.string().uuid().optional(),
      entityType: SyncableEntityTypeEnum,
    })
  ).optional(),
});

const mappingsExchangeSchema = z.object({
  instanceId: z.string().uuid(),
  localMappings: z.record(z.string().uuid(), z.string().uuid()),
});

// ============================================================================
// Handshake Handler
// ============================================================================

async function handleHandshake(
  req: NextRequest,
  context: SyncAuthenticatedContext
) {
  try {
    const body = await req.json();
    const request = handshakeSchema.parse(body);

    logger.info('[Sync v1] Handshake initiated', {
      remoteAppVersion: request.versionInfo.appVersion,
      authMethod: context.authMethod,
      localUserId: context.user.id,
    });

    // Check version compatibility using the versionInfo object
    const compatibility = checkVersionCompatibility({
      appVersion: request.versionInfo.appVersion,
      schemaVersion: request.versionInfo.schemaVersion,
      syncProtocolVersion: request.versionInfo.syncProtocolVersion,
      supportedEntityTypes: request.versionInfo.supportedEntityTypes as any[],
    });

    if (!compatibility.compatible) {
      logger.warn('[Sync v1] Version incompatibility detected', {
        reason: compatibility.reason,
        remoteVersion: request.versionInfo.appVersion,
      });
      return badRequest(`Version incompatible: ${compatibility.reason}`);
    }

    logger.info('[Sync v1] Handshake successful', {
      remoteAppVersion: request.versionInfo.appVersion,
      authMethod: context.authMethod,
    });

    const localVersion = getLocalVersionInfo();

    // Return response matching SyncHandshakeResponseSchema
    return successResponse({
      compatible: true,
      versionInfo: localVersion,
      remoteUserId: context.user.id,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      logger.debug('[Sync v1] Handshake validation error', { errors: error.errors });
      return validationError(error);
    }

    logger.error('[Sync v1] Handshake failed', {}, error instanceof Error ? error : undefined);
    return serverError('Handshake failed');
  }
}

// ============================================================================
// Delta Handler
// ============================================================================

async function handleDelta(
  req: NextRequest,
  context: SyncAuthenticatedContext
) {
  try {
    const body = await req.json();
    const request = SyncDeltaRequestSchema.parse(body);

    logger.debug('[Sync v1] Delta request', {
      entityTypes: request.entityTypes,
      sinceTimestamp: request.sinceTimestamp,
      limit: request.limit,
    });

    const { user } = context;

    // Detect deltas using the delta detector
    const result = await detectDeltas({
      userId: user.id,
      entityTypes: request.entityTypes as SyncableEntityType[] | undefined,
      sinceTimestamp: request.sinceTimestamp || null,
      limit: request.limit || 100,
    });

    logger.info('[Sync v1] Delta detection complete', {
      totalEntities: result.deltas.length,
      entityTypes: request.entityTypes,
      hasMore: result.hasMore,
    });

    return successResponse({
      deltas: result.deltas,
      hasMore: result.hasMore,
      nextCursor: result.newestTimestamp,
      detectedAt: new Date().toISOString(),
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      logger.debug('[Sync v1] Delta validation error', { errors: error.errors });
      return validationError(error);
    }

    logger.error('[Sync v1] Delta request failed', {}, error instanceof Error ? error : undefined);
    return serverError('Failed to fetch deltas');
  }
}

// ============================================================================
// Push Handler
// ============================================================================

async function handlePush(
  req: NextRequest,
  context: SyncAuthenticatedContext
) {
  try {
    const body = await req.json();
    const request = pushDataSchema.parse(body);

    logger.info('[Sync v1] Push received', {
      deltaCount: request.deltas.length,
    });

    const { user, repos } = context;
    const results = {
      applied: 0,
      conflicts: [] as Array<{
        entityType: string;
        localId: string;
        remoteId: string;
        localUpdatedAt: string;
        remoteUpdatedAt: string;
        resolution: string;
      }>,
      errors: [] as string[],
      mappingUpdates: [] as Array<{
        localId: string;
        remoteId: string;
        entityType: string;
      }>,
      details: [] as any[],
    };

    // Apply each delta
    for (const delta of request.deltas) {
      try {
        const result = await applyRemoteDelta(
          user.id,
          'remote-instance-id',
          {
            id: delta.id,
            entityType: delta.entityType as SyncableEntityType,
            data: delta.data as Record<string, unknown> | null,
            createdAt: delta.createdAt,
            updatedAt: delta.updatedAt,
            isDeleted: delta.isDeleted || false,
          }
        );

        if (result.success) {
          results.applied++;
          results.details.push({
            entityId: delta.id,
            status: 'applied',
            isNew: result.isNewEntity,
          });
          // Capture conflict even on success (conflict was resolved)
          if (result.conflict) {
            results.conflicts.push(result.conflict);
          }
        } else if (result.error) {
          results.errors.push(`${delta.entityType}:${delta.id}: ${result.error}`);
          results.details.push({
            entityId: delta.id,
            status: 'error',
            error: result.error,
          });
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        results.errors.push(`${delta.entityType}:${delta.id}: ${errorMsg}`);
        results.details.push({
          entityId: delta.id,
          status: 'error',
          error: errorMsg,
        });
        logger.error('[Sync v1] Error applying delta', {
          entityId: delta.id,
          entityType: delta.entityType,
        });
      }
    }

    logger.info('[Sync v1] Push completed', {
      applied: results.applied,
      conflicts: results.conflicts.length,
      errors: results.errors.length,
    });

    return successResponse({
      success: results.errors.length === 0,
      mappingUpdates: results.mappingUpdates,
      conflicts: results.conflicts,
      errors: results.errors,
      applied: results.applied,
      details: results.details,
      processedAt: new Date().toISOString(),
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return validationError(error);
    }

    logger.error('[Sync v1] Push failed', {}, error instanceof Error ? error : undefined);
    return serverError('Failed to apply push data');
  }
}

// ============================================================================
// Mappings Handler
// Note: With ID preservation sync, mappings are deprecated. Entity IDs are
// the same across instances, eliminating the need for local<->remote ID mappings.
// This endpoint is maintained for backward compatibility.
// ============================================================================

async function handleMappings(
  req: NextRequest,
  context: SyncAuthenticatedContext
) {
  if (req.method === 'GET') {
    try {
      const { searchParams } = new URL(req.url);
      const instanceId = searchParams.get('instanceId');

      if (!instanceId) {
        return badRequest('instanceId query parameter required');
      }

      logger.debug('[Sync v1] Fetching mappings (deprecated with ID preservation)', { instanceId });

      const { repos, user } = context;

      // Retrieve mappings for the instance
      const mappings = await repos.syncMappings?.findAllForInstance(user.id, instanceId) || [];

      logger.debug('[Sync v1] Mappings retrieved', {
        count: mappings.length,
      });

      return successResponse({ mappings });
    } catch (error) {
      logger.error('[Sync v1] Error fetching mappings', {}, error instanceof Error ? error : undefined);
      return serverError('Failed to fetch mappings');
    }
  } else {
    // POST - Exchange mappings (deprecated)
    try {
      const body = await req.json();
      const request = mappingsExchangeSchema.parse(body);

      logger.debug('[Sync v1] Exchanging mappings (deprecated with ID preservation)', {
        instanceId: request.instanceId,
        count: Object.keys(request.localMappings).length,
      });

      // With ID preservation, we don't actually need to store mappings
      // since entity IDs are the same on both instances.
      // Log and acknowledge for backward compatibility.

      logger.info('[Sync v1] Mappings exchange acknowledged', {
        instanceId: request.instanceId,
        count: Object.keys(request.localMappings).length,
      });

      return successResponse({ success: true });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return validationError(error);
      }

      logger.error('[Sync v1] Error exchanging mappings', {}, error instanceof Error ? error : undefined);
      return serverError('Failed to exchange mappings');
    }
  }
}

// ============================================================================
// Cleanup Handler
// ============================================================================

async function handleCleanup(
  req: NextRequest,
  context: SyncAuthenticatedContext
) {
  try {
    logger.info('[Sync v1] Cleanup initiated');

    const { searchParams } = new URL(req.url);
    const daysOld = parseInt(searchParams.get('daysOld') || '30', 10);

    const { repos } = context;

    // Calculate the cutoff date
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysOld);

    // Delete old sync operations
    const deletedCount = await repos.syncOperations?.deleteOlderThan(cutoffDate) || 0;

    logger.info('[Sync v1] Cleanup completed', {
      deletedCount,
      daysOld,
      cutoffDate: cutoffDate.toISOString(),
    });

    return successResponse({
      success: true,
      deletedCount,
    });
  } catch (error) {
    logger.error('[Sync v1] Cleanup failed', {}, error instanceof Error ? error : undefined);
    return serverError('Cleanup failed');
  }
}

// ============================================================================
// Main Handler
// ============================================================================

export const POST = createSyncAuthenticatedHandler(async (req, context) => {
  // Ensure plugin system is initialized before processing sync requests
  // This is critical for FILE entity syncing which requires the S3 storage backend plugin
  const pluginSystemInitialized = isPluginSystemInitialized();
  if (!pluginSystemInitialized) {
    logger.warn('[Sync v1] Plugin system not initialized, initializing now');
    const initResult = await initializePlugins();
    logger.info('[Sync v1] Plugin system initialization result', {
      success: initResult.success,
      stats: initResult.stats,
    });
    if (!initResult.success) {
      return serviceUnavailable('Server is still initializing. Please retry in a moment.');
    }
  }

  const action = getActionParam(req);

  switch (action) {
    case 'handshake':
      return handleHandshake(req, context);
    case 'delta':
      return handleDelta(req, context);
    case 'push':
      return handlePush(req, context);
    case 'mappings':
      return handleMappings(req, context);
    case 'cleanup':
      return handleCleanup(req, context);
    default:
      return badRequest(
        `Unknown action: ${action}. Available actions: handshake, delta, push, mappings, cleanup`
      );
  }
});

export const GET = createSyncAuthenticatedHandler(async (req, context) => {
  // Ensure plugin system is initialized before processing sync requests
  const pluginSystemInitialized = isPluginSystemInitialized();
  if (!pluginSystemInitialized) {
    logger.warn('[Sync v1] Plugin system not initialized, initializing now');
    const initResult = await initializePlugins();
    if (!initResult.success) {
      return serviceUnavailable('Server is still initializing. Please retry in a moment.');
    }
  }

  const action = getActionParam(req);

  if (action === 'mappings') {
    return handleMappings(req, context);
  }

  return badRequest('Unknown action');
});
