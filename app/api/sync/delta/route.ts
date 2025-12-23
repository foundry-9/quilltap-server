/**
 * Sync Delta API
 *
 * POST /api/sync/delta
 *
 * Returns entities that have changed since a given timestamp.
 * Used by remote instances to pull changes during sync.
 */

import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { getServerSession } from '@/lib/auth/session';
import { SyncDeltaRequestSchema, SyncDeltaResponse } from '@/lib/sync/types';
import { detectDeltas } from '@/lib/sync/delta-detector';
import { getAuthenticatedUserForSync } from '@/lib/sync/api-key-auth';

/**
 * POST /api/sync/delta
 *
 * Get entities changed since a timestamp.
 *
 * Request body:
 * - entityTypes?: string[] - Filter by entity types
 * - sinceTimestamp?: string - Get changes since this ISO timestamp
 * - limit?: number - Maximum number of deltas to return (default 100, max 1000)
 * - cursor?: string - Pagination cursor for subsequent requests
 */
export async function POST(req: NextRequest) {
  const startTime = Date.now();

  try {
    // Check authentication (via session or API key)
    const session = await getServerSession();
    const authResult = await getAuthenticatedUserForSync(req, session?.user?.id || null);

    if (!authResult.userId) {
      logger.warn('Sync delta requested without authentication', {
        context: 'api:sync:delta',
      });
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userId = authResult.userId;

    // Parse request body
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      logger.warn('Sync delta received invalid JSON', {
        context: 'api:sync:delta',
        userId,
      });
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    // Validate request
    const parseResult = SyncDeltaRequestSchema.safeParse(body);
    if (!parseResult.success) {
      logger.warn('Sync delta received invalid request', {
        context: 'api:sync:delta',
        userId,
        errors: parseResult.error.errors,
      });
      return NextResponse.json(
        { error: 'Invalid request', details: parseResult.error.errors },
        { status: 400 }
      );
    }

    const { entityTypes, sinceTimestamp, limit = 100 } = parseResult.data;

    logger.info('Processing sync delta request', {
      context: 'api:sync:delta',
      userId,
      authMethod: authResult.authMethod,
      entityTypes,
      sinceTimestamp,
      limit,
    });

    // Detect deltas
    const result = await detectDeltas({
      userId,
      entityTypes,
      sinceTimestamp,
      limit: Math.min(limit, 1000), // Cap at 1000
    });

    const serverTimestamp = new Date().toISOString();

    const response: SyncDeltaResponse = {
      serverTimestamp,
      deltas: result.deltas,
      hasMore: result.hasMore,
      nextCursor: result.hasMore && result.newestTimestamp ? result.newestTimestamp : null,
    };

    const duration = Date.now() - startTime;

    logger.info('Sync delta request complete', {
      context: 'api:sync:delta',
      userId,
      deltaCount: result.deltas.length,
      hasMore: result.hasMore,
      durationMs: duration,
    });

    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    const duration = Date.now() - startTime;

    logger.error('Error processing sync delta request', {
      context: 'api:sync:delta',
      error: error instanceof Error ? error.message : String(error),
      durationMs: duration,
    });

    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
