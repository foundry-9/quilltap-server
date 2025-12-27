/**
 * Sync Mappings API
 *
 * GET /api/sync/mappings - Get all mappings for an instance
 * POST /api/sync/mappings - Create or update mappings
 *
 * Manages the UUID mappings between local and remote entities.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { logger } from '@/lib/logger';
import { getServerSession } from '@/lib/auth/session';
import { getRepositories } from '@/lib/repositories/factory';
import { SyncMappingSchema, SyncableEntityTypeEnum, CreateSyncMapping } from '@/lib/sync/types';
import { getAuthenticatedUserForSync } from '@/lib/sync/api-key-auth';

// Schema for creating/updating mappings
const CreateMappingSchema = z.object({
  instanceId: z.string().uuid(),
  entityType: SyncableEntityTypeEnum,
  localId: z.string().uuid(),
  remoteId: z.string().uuid(),
  lastLocalUpdatedAt: z.string().datetime(),
  lastRemoteUpdatedAt: z.string().datetime(),
});

const BatchCreateMappingsSchema = z.object({
  mappings: z.array(CreateMappingSchema),
});

/**
 * GET /api/sync/mappings
 *
 * Get all sync mappings for a specific instance.
 *
 * Query params:
 * - instanceId: string (required) - The sync instance ID
 * - entityType?: string - Filter by entity type
 */
export async function GET(req: NextRequest) {
  const startTime = Date.now();

  try {
    // Check authentication (via session or API key)
    const session = await getServerSession();
    const authResult = await getAuthenticatedUserForSync(req, session?.user?.id || null);

    if (!authResult.userId) {
      logger.warn('Sync mappings GET requested without authentication', {
        context: 'api:sync:mappings',
      });
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userId = authResult.userId;

    // Get query params
    const { searchParams } = new URL(req.url);
    const instanceId = searchParams.get('instanceId');
    const entityType = searchParams.get('entityType');

    if (!instanceId) {
      logger.warn('Sync mappings GET missing instanceId', {
        context: 'api:sync:mappings',
        userId,
      });
      return NextResponse.json({ error: 'instanceId is required' }, { status: 400 });
    }

    logger.debug('Getting sync mappings', {
      context: 'api:sync:mappings',
      userId,
      instanceId,
      entityType,
    });

    const repos = getRepositories();
    let mappings;

    if (entityType) {
      // Validate entity type
      const parseResult = SyncableEntityTypeEnum.safeParse(entityType);
      if (!parseResult.success) {
        return NextResponse.json({ error: 'Invalid entityType' }, { status: 400 });
      }
      mappings = await repos.syncMappings.findByEntityType(
        userId,
        instanceId,
        parseResult.data
      );
    } else {
      mappings = await repos.syncMappings.findAllForInstance(userId, instanceId);
    }

    const duration = Date.now() - startTime;

    logger.info('Sync mappings GET complete', {
      context: 'api:sync:mappings',
      userId,
      instanceId,
      mappingCount: mappings.length,
      durationMs: duration,
    });

    return NextResponse.json({ mappings }, { status: 200 });
  } catch (error) {
    const duration = Date.now() - startTime;

    logger.error('Error getting sync mappings', {
      context: 'api:sync:mappings',
      error: error instanceof Error ? error.message : String(error),
      durationMs: duration,
    });

    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * POST /api/sync/mappings
 *
 * Create or update sync mappings.
 *
 * Request body:
 * - mappings: Array of mapping objects to create/update
 */
export async function POST(req: NextRequest) {
  const startTime = Date.now();

  try {
    // Check authentication (via session or API key)
    const session = await getServerSession();
    const authResult = await getAuthenticatedUserForSync(req, session?.user?.id || null);

    if (!authResult.userId) {
      logger.warn('Sync mappings POST requested without authentication', {
        context: 'api:sync:mappings',
      });
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userId = authResult.userId;

    // Parse request body
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      logger.warn('Sync mappings POST received invalid JSON', {
        context: 'api:sync:mappings',
        userId,
      });
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    // Validate request
    const parseResult = BatchCreateMappingsSchema.safeParse(body);
    if (!parseResult.success) {
      logger.warn('Sync mappings POST received invalid request', {
        context: 'api:sync:mappings',
        userId,
        errors: parseResult.error.errors,
      });
      return NextResponse.json(
        { error: 'Invalid request', details: parseResult.error.errors },
        { status: 400 }
      );
    }

    const { mappings } = parseResult.data;

    logger.info('Processing sync mappings POST', {
      context: 'api:sync:mappings',
      userId,
      mappingCount: mappings.length,
    });

    const repos = getRepositories();
    const now = new Date().toISOString();
    const created: string[] = [];
    const updated: string[] = [];
    const errors: string[] = [];

    for (const mapping of mappings) {
      try {
        // Check if mapping already exists
        const existing = await repos.syncMappings.findByLocalId(
          userId,
          mapping.instanceId,
          mapping.entityType,
          mapping.localId
        );

        if (existing) {
          // Update existing mapping
          await repos.syncMappings.update(existing.id, {
            remoteId: mapping.remoteId,
            lastLocalUpdatedAt: mapping.lastLocalUpdatedAt,
            lastRemoteUpdatedAt: mapping.lastRemoteUpdatedAt,
            lastSyncedAt: now,
          });
          updated.push(existing.id);
        } else {
          // Create new mapping
          const newMapping: CreateSyncMapping = {
            userId,
            instanceId: mapping.instanceId,
            entityType: mapping.entityType,
            localId: mapping.localId,
            remoteId: mapping.remoteId,
            lastSyncedAt: now,
            lastLocalUpdatedAt: mapping.lastLocalUpdatedAt,
            lastRemoteUpdatedAt: mapping.lastRemoteUpdatedAt,
          };

          const result = await repos.syncMappings.create(newMapping);
          created.push(result.id);
        }
      } catch (error) {
        const errorMsg = `Failed to process mapping for ${mapping.entityType}:${mapping.localId}: ${error instanceof Error ? error.message : String(error)}`;
        errors.push(errorMsg);
        logger.warn('Error processing individual mapping', {
          context: 'api:sync:mappings',
          userId,
          mapping,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const duration = Date.now() - startTime;

    logger.info('Sync mappings POST complete', {
      context: 'api:sync:mappings',
      userId,
      createdCount: created.length,
      updatedCount: updated.length,
      errorCount: errors.length,
      durationMs: duration,
    });

    return NextResponse.json(
      {
        success: errors.length === 0,
        created: created.length,
        updated: updated.length,
        errors,
      },
      { status: errors.length === 0 ? 200 : 207 }
    );
  } catch (error) {
    const duration = Date.now() - startTime;

    logger.error('Error processing sync mappings POST', {
      context: 'api:sync:mappings',
      error: error instanceof Error ? error.message : String(error),
      durationMs: duration,
    });

    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
