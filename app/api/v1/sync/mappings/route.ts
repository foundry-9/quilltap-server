/**
 * Sync Mappings API v1
 *
 * GET /api/v1/sync/mappings - List all sync mappings
 * POST /api/v1/sync/mappings - Create/update mappings
 *
 * Note: With ID preservation sync, mappings are largely deprecated.
 * Entity IDs are the same across instances, so mappings aren't needed.
 * This endpoint is maintained for backward compatibility.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createAuthenticatedHandler, AuthenticatedContext } from '@/lib/api/middleware';
import { z } from 'zod';
import { logger } from '@/lib/logger';
import {
  badRequest,
  serverError,
  validationError,
  successResponse,
} from '@/lib/api/responses';
import { SyncableEntityTypeEnum, SyncableEntityType } from '@/lib/sync/types';

// ============================================================================
// Schemas
// ============================================================================

const createMappingSchema = z.object({
  instanceId: z.uuid(),
  entityType: SyncableEntityTypeEnum,
  localId: z.uuid(),
  remoteId: z.uuid(),
});

const batchCreateSchema = z.array(createMappingSchema);

// ============================================================================
// GET Handler
// ============================================================================

export const GET = createAuthenticatedHandler(async (req, context) => {
  try {
    logger.debug('[Sync Mappings v1] GET list', { userId: context.user.id });

    const { searchParams } = new URL(req.url);
    const instanceId = searchParams.get('instanceId');
    const entityType = searchParams.get('entityType') as SyncableEntityType | null;
    const localId = searchParams.get('localId');

    const { repos, user } = context;

    let mappings: any[] = [];

    if (instanceId && entityType && localId) {
      // Get specific mapping by local ID
      const mapping = await repos.syncMappings?.findByLocalId(
        user.id,
        instanceId,
        entityType,
        localId
      );
      if (mapping) {
        mappings = [mapping];
      }
    } else if (instanceId && entityType) {
      // Get mappings by entity type for an instance
      mappings = await repos.syncMappings?.findByEntityType(
        user.id,
        instanceId,
        entityType
      ) || [];
    } else if (instanceId) {
      // Get all mappings for an instance
      mappings = await repos.syncMappings?.findAllForInstance(user.id, instanceId) || [];
    } else {
      // No filters provided - return empty (too broad a query)
      logger.warn('[Sync Mappings v1] GET called without instanceId filter');
      return badRequest('instanceId query parameter is required');
    }

    logger.info('[Sync Mappings v1] Listed mappings', {
      count: mappings.length,
      filters: { instanceId, entityType, localId },
    });

    return successResponse({
      mappings,
      count: mappings.length,
    });
  } catch (error) {
    logger.error(
      '[Sync Mappings v1] Error listing mappings',
      {},
      error instanceof Error ? error : undefined
    );
    return serverError('Failed to list sync mappings');
  }
});

// ============================================================================
// POST Handler
// ============================================================================

export const POST = createAuthenticatedHandler(async (req, context) => {
  try {
    const body = await req.json();

    // Check if it's a single mapping or batch
    let mappingsData: z.infer<typeof createMappingSchema>[];

    if (Array.isArray(body)) {
      mappingsData = batchCreateSchema.parse(body);
    } else {
      mappingsData = [createMappingSchema.parse(body)];
    }

    logger.info('[Sync Mappings v1] Creating mappings', {
      count: mappingsData.length,
    });

    const { repos, user } = context;

    const results = {
      created: 0,
      updated: 0,
      errors: [] as string[],
    };

    for (const mappingData of mappingsData) {
      try {
        // Check if mapping already exists
        const existingMapping = await repos.syncMappings?.findByLocalId(
          user.id,
          mappingData.instanceId,
          mappingData.entityType,
          mappingData.localId
        );

        if (existingMapping) {
          // Update existing mapping if remoteId changed
          if (existingMapping.remoteId !== mappingData.remoteId) {
            await repos.syncMappings?.update(existingMapping.id, {
              remoteId: mappingData.remoteId,
            });
            results.updated++;
          }
        } else {
          // Create new mapping
          await repos.syncMappings?.create({
            userId: user.id,
            instanceId: mappingData.instanceId,
            entityType: mappingData.entityType,
            localId: mappingData.localId,
            remoteId: mappingData.remoteId,
            lastSyncedAt: new Date().toISOString(),
            lastLocalUpdatedAt: new Date().toISOString(),
            lastRemoteUpdatedAt: new Date().toISOString(),
          });
          results.created++;
        }

        logger.debug('[Sync Mappings v1] Mapping processed', {
          localId: mappingData.localId,
          remoteId: mappingData.remoteId,
        });
      } catch (error) {
        const errorMsg = `Failed to process mapping ${mappingData.localId} -> ${mappingData.remoteId}: ${error instanceof Error ? error.message : String(error)}`;
        results.errors.push(errorMsg);
        logger.warn('[Sync Mappings v1] Mapping error', { error: errorMsg });
      }
    }

    logger.info('[Sync Mappings v1] Mappings created/updated', {
      created: results.created,
      updated: results.updated,
      errors: results.errors.length,
    });

    return successResponse({
      success: results.errors.length === 0,
      ...results,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return validationError(error);
    }

    logger.error(
      '[Sync Mappings v1] Error creating mappings',
      {},
      error instanceof Error ? error : undefined
    );
    return serverError('Failed to create sync mappings');
  }
});
