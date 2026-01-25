/**
 * Mount Points API v1 - Collection Endpoint
 *
 * GET /api/v1/system/mount-points - List all mount points
 * GET /api/v1/system/mount-points?action=list-backends - List available backends
 * POST /api/v1/system/mount-points - Create a new mount point
 */

import { NextRequest, NextResponse } from 'next/server';
import { createAuthenticatedHandler, withCollectionActionDispatch } from '@/lib/api/middleware';
import { z } from 'zod';
import { logger } from '@/lib/logger';
import { badRequest, serverError, validationError } from '@/lib/api/responses';
import { fileStorageManager } from '@/lib/file-storage/manager';

// ============================================================================
// Schemas
// ============================================================================

const createMountPointSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  backendType: z.enum(['s3', 'local', 'azure'], {
    error: () => 'Invalid backend type',
  }),
  path: z.string().min(1, 'Path is required'),
  isDefault: z.boolean().prefault(false),
  config: z.record(z.string(), z.unknown()).optional(),
});

type CreateMountPointInput = z.infer<typeof createMountPointSchema>;

// ============================================================================
// Action Handlers
// ============================================================================

async function handleListBackends(req: NextRequest) {
  try {

    // Return available backend types
    const backends = [
      {
        type: 's3',
        name: 'S3 Compatible',
        description: 'AWS S3 or S3-compatible storage (MinIO, etc.)',
        requiresConfig: ['endpoint', 'accessKey', 'secretKey', 'bucket'],
      },
      {
        type: 'local',
        name: 'Local Filesystem',
        description: 'Store files on local filesystem (development only)',
        requiresConfig: ['basePath'],
      },
      {
        type: 'azure',
        name: 'Azure Blob Storage',
        description: 'Microsoft Azure Blob Storage',
        requiresConfig: ['accountName', 'accountKey', 'containerName'],
      },
    ];


    return NextResponse.json({ backends });
  } catch (error) {
    logger.error(
      '[Mount Points v1] Error listing backends',
      {},
      error instanceof Error ? error : undefined
    );
    return serverError('Failed to list backends');
  }
}

async function handleCreate(req: NextRequest, { user, repos }: any) {
  try {
    const body = await req.json();
    const validatedData = createMountPointSchema.parse(body);// Create the mount point in the repository
    const mountPoint = await repos.mountPoints.create({
      name: validatedData.name,
      description: undefined,
      backendType: validatedData.backendType,
      backendConfig: validatedData.config || {},
      encryptedSecrets: null,
      scope: 'user',
      userId: user.id,
      isDefault: validatedData.isDefault,
      enabled: true,
      healthStatus: 'unknown',
    });

    logger.info('[Mount Points v1] Mount point created', {
      mountPointId: mountPoint.id,
      name: validatedData.name,
    });

    return NextResponse.json({ mountPoint }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return validationError(error);
    }

    logger.error(
      '[Mount Points v1] Error creating mount point',
      {},
      error instanceof Error ? error : undefined
    );
    return serverError('Failed to create mount point');
  }
}

// ============================================================================
// GET Handler
// ============================================================================

export const GET = createAuthenticatedHandler(async (req: NextRequest, { user, repos }) => {
  const { searchParams } = new URL(req.url);
  const action = searchParams.get('action');

  if (action === 'list-backends') {
    return handleListBackends(req);
  }

  try {

    // Fetch all mount points from the repository
    const mountPoints = await repos.mountPoints.findAll();return NextResponse.json({
      mountPoints,
      count: mountPoints.length,
    });
  } catch (error) {
    logger.error(
      '[Mount Points v1] Error listing mount points',
      { userId: user.id },
      error instanceof Error ? error : undefined
    );
    return serverError('Failed to fetch mount points');
  }
});

// ============================================================================
// POST Handler
// ============================================================================

export const POST = createAuthenticatedHandler(async (req: NextRequest, { user, repos }) => {
  return handleCreate(req, { user, repos });
});
