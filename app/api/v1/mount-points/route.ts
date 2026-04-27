/**
 * Mount Points API v1 - Collection Endpoint
 *
 * GET /api/v1/mount-points - List all mount points
 * POST /api/v1/mount-points - Create a new mount point
 */

import { NextRequest, NextResponse } from 'next/server';
import { createAuthenticatedHandler } from '@/lib/api/middleware';
import { z } from 'zod';
import { logger } from '@/lib/logger';
import { created, serverError } from '@/lib/api/responses';
import { attachMountPoint } from '@/lib/mount-index/watcher';
import { verifyBasePath } from '@/lib/mount-index/scanner';
import { scaffoldCharacterMount } from '@/lib/mount-index/character-scaffold';

// ============================================================================
// Schemas
// ============================================================================

const createMountPointSchema = z.object({
  name: z.string().min(1, 'Name is required').max(200),
  // basePath is only meaningful for filesystem/obsidian mounts. Database-backed
  // stores (mountType === 'database') persist everything inside
  // quilltap-mount-index.db and ignore this value.
  basePath: z.string().optional().default(''),
  mountType: z.enum(['filesystem', 'obsidian', 'database']).optional().default('filesystem'),
  storeType: z.enum(['documents', 'character']).optional().default('documents'),
  includePatterns: z.array(z.string()).optional(),
  excludePatterns: z.array(z.string()).optional(),
  enabled: z.boolean().optional().default(true),
}).refine(
  (data) => data.mountType === 'database' || (data.basePath && data.basePath.length > 0),
  { message: 'Base path is required for filesystem and obsidian mount types', path: ['basePath'] }
);

// ============================================================================
// GET Handler
// ============================================================================

export const GET = createAuthenticatedHandler(async (req: NextRequest, { user, repos }) => {
  try {
    logger.debug('[Mount Points v1] Listing all mount points', {
      userId: user.id,
    });

    const mountPoints = await repos.docMountPoints.findAll();

    // Sort by createdAt descending
    mountPoints.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    // Compute embedded chunk counts per mount point via a cheap GROUP BY —
    // no BLOBs hydrated.
    const mountPointIds = mountPoints.map(mp => mp.id);
    const embeddedCountMap = mountPointIds.length > 0
      ? await repos.docMountChunks.countEmbeddedByMountPointIds(mountPointIds)
      : new Map<string, number>();

    // Enrich mount points with embedded chunk count
    const enriched = mountPoints.map(mp => ({
      ...mp,
      embeddedChunkCount: embeddedCountMap.get(mp.id) || 0,
    }));

    logger.debug('[Mount Points v1] Found mount points', {
      count: mountPoints.length,
    });

    return NextResponse.json({ mountPoints: enriched });
  } catch (error) {
    logger.error('[Mount Points v1] Error fetching mount points', {}, error instanceof Error ? error : undefined);
    return serverError('Failed to fetch mount points');
  }
});

// ============================================================================
// POST Handler
// ============================================================================

export const POST = createAuthenticatedHandler(async (req: NextRequest, { user, repos }) => {
  const body = await req.json();
  const validatedData = createMountPointSchema.parse(body);

  logger.debug('[Mount Points v1] Creating mount point', {
    name: validatedData.name,
    basePath: validatedData.basePath,
    mountType: validatedData.mountType,
    userId: user.id,
  });

  const mountPoint = await repos.docMountPoints.create({
    name: validatedData.name,
    basePath: validatedData.basePath,
    mountType: validatedData.mountType,
    storeType: validatedData.storeType,
    includePatterns: validatedData.includePatterns ?? ['*.md', '*.txt', '*.pdf', '*.docx'],
    excludePatterns: validatedData.excludePatterns ?? ['.git', 'node_modules', '.obsidian', '.trash'],
    enabled: validatedData.enabled,
    lastScannedAt: null,
    scanStatus: 'idle',
    lastScanError: null,
    conversionStatus: 'idle',
    conversionError: null,
    fileCount: 0,
    chunkCount: 0,
    totalSizeBytes: 0,
  });

  // Database-backed stores have no basePath to verify — SQLCipher has already
  // persisted the mount point row, and documents are added via the doc_* tools
  // or the blob API once the user starts writing.
  let warning: string | undefined;
  if (validatedData.mountType !== 'database') {
    const accessible = await verifyBasePath(validatedData.basePath);
    if (accessible) {
      logger.debug('[Mount Points v1] Base path is accessible', {
        basePath: validatedData.basePath,
      });
    } else {
      warning = `Base path '${validatedData.basePath}' is not currently accessible. The mount point was created but scanning will fail until the path is available.`;
      logger.warn('[Mount Points v1] Base path not accessible', {
        basePath: validatedData.basePath,
        mountPointId: mountPoint.id,
      });
    }
  }

  logger.info('[Mount Points v1] Mount point created', {
    mountPointId: mountPoint.id,
    name: mountPoint.name,
    basePath: mountPoint.basePath,
    userId: user.id,
  });

  // Scaffold after creation so the mount ID exists.
  if (mountPoint.storeType === 'character' && mountPoint.mountType === 'database') {
    await scaffoldCharacterMount(mountPoint.id).catch((err) => {
      logger.warn('[Mount Points v1] Character scaffold failed', {
        mountPointId: mountPoint.id,
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }

  // Attach a real-time watcher if the mount point is enabled and accessible
  attachMountPoint(mountPoint).catch((err) => {
    logger.warn('[Mount Points v1] Failed to attach watcher for new mount point', {
      mountPointId: mountPoint.id,
      error: err instanceof Error ? err.message : String(err),
    });
  });

  if (warning) {
    return created({ mountPoint, warning });
  }

  return created({ mountPoint });
});
