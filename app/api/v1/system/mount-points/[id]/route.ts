/**
 * Mount Points API v1 - Individual Mount Point Endpoint
 *
 * GET /api/v1/system/mount-points/[id] - Get a specific mount point
 * PUT /api/v1/system/mount-points/[id] - Update a mount point
 * DELETE /api/v1/system/mount-points/[id] - Delete a mount point
 * POST /api/v1/system/mount-points/[id]?action=test - Test mount point connection
 * POST /api/v1/system/mount-points/[id]?action=scan-orphans - Scan for orphaned files
 * POST /api/v1/system/mount-points/[id]?action=adopt-orphans - Adopt orphaned files
 * POST /api/v1/system/mount-points/[id]?action=set-default - Set as default mount point
 */

import { NextRequest, NextResponse } from 'next/server';
import { createAuthenticatedParamsHandler, withActionDispatch } from '@/lib/api/middleware';
import { z } from 'zod';
import { logger } from '@/lib/logger';
import { notFound, badRequest, serverError, validationError } from '@/lib/api/responses';
import { fileStorageManager } from '@/lib/file-storage/manager';

// ============================================================================
// Schemas
// ============================================================================

const adoptOrphansSchema = z.object({
  storageKeys: z.array(z.string().min(1)).min(1, 'At least one storage key is required'),
  defaultProjectId: z.string().optional().nullable(),
  source: z.enum(['IMPORTED', 'UPLOADED', 'GENERATED', 'SYSTEM']).prefault('IMPORTED'),
  computeHashes: z.boolean().optional().prefault(false),
});

const updateMountPointSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  path: z.string().min(1).optional(),
  config: z.record(z.string(), z.unknown()).optional(),
});

type UpdateMountPointInput = z.infer<typeof updateMountPointSchema>;

// ============================================================================
// Action Handlers
// ============================================================================

async function handleTest(req: NextRequest, { user, repos }: any, id: string) {
  try {
    logger.debug('[Mount Points v1] POST test connection', { mountPointId: id, userId: user.id });

    // Fetch the mount point
    const mountPoint = await repos.mountPoints.findById(id);

    if (!mountPoint) {
      logger.warn('Mount point not found for test', { mountPointId: id });
      return notFound('Mount point');
    }

    // Check ownership
    if (mountPoint.scope === 'user' && mountPoint.userId !== user.id) {
      logger.warn('Unauthorized test attempt', {
        mountPointId: id,
        userId: user.id,
        ownerId: mountPoint.userId,
      });
      return notFound('Mount point');
    }

    if (!mountPoint.enabled) {
      logger.debug('Mount point is disabled, cannot test', { mountPointId: id });
      return NextResponse.json(
        {
          mountPointId: id,
          healthy: false,
          status: 'unhealthy',
          message: 'Mount point is disabled',
          testedAt: new Date().toISOString(),
        },
        { status: 400 }
      );
    }

    logger.info('Mount point health check initiated', {
      mountPointId: id,
      backendType: mountPoint.backendType,
      scope: mountPoint.scope,
    });

    const now = new Date().toISOString();

    // Ensure the file storage manager is initialized
    if (!fileStorageManager.isInitialized()) {
      logger.debug('Initializing file storage manager for mount point test', { mountPointId: id });
      await fileStorageManager.initialize();
    }

    // Try to get the backend from the file storage manager
    const backend = await fileStorageManager.getBackend(id);

    if (!backend) {
      // Backend could not be instantiated
      logger.warn('Could not get backend for mount point', {
        mountPointId: id,
        backendType: mountPoint.backendType,
      });

      await repos.mountPoints.updateHealth(id, 'unhealthy');

      return NextResponse.json({
        mountPointId: id,
        healthy: false,
        status: 'unhealthy',
        message: `Failed to instantiate ${mountPoint.backendType} backend. Check configuration.`,
        testedAt: now,
        backendType: mountPoint.backendType,
      });
    }

    // Test the connection
    const isHealthy = await backend.testConnection();

    const status = isHealthy ? 'healthy' : 'unhealthy';
    await repos.mountPoints.updateHealth(id, status);

    logger.info('[Mount Points v1] Connection test completed', {
      mountPointId: id,
      status,
      healthy: isHealthy,
    });

    return NextResponse.json({
      mountPointId: id,
      healthy: isHealthy,
      status,
      message: isHealthy ? 'Mount point connection successful' : 'Mount point connection failed',
      testedAt: now,
      backendType: mountPoint.backendType,
    });
  } catch (error) {
    logger.error(
      '[Mount Points v1] Connection test failed',
      { mountPointId: id },
      error instanceof Error ? error : undefined
    );
    return serverError('Failed to test mount point connection');
  }
}

async function handleScanOrphans(req: NextRequest, { user, repos }: any, id: string) {
  try {
    logger.debug('[Mount Points v1] POST scan-orphans', {
      mountPointId: id,
      userId: user.id,
    });

    // Fetch the mount point
    const mountPoint = await repos.mountPoints.findById(id);

    if (!mountPoint) {
      logger.warn('Mount point not found for orphan scan', { mountPointId: id });
      return notFound('Mount point');
    }

    // Check ownership
    if (mountPoint.scope === 'user' && mountPoint.userId !== user.id) {
      logger.warn('Unauthorized orphan scan attempt', {
        mountPointId: id,
        userId: user.id,
        ownerId: mountPoint.userId,
      });
      return notFound('Mount point');
    }

    if (!mountPoint.enabled) {
      logger.debug('Mount point is disabled, cannot scan', { mountPointId: id });
      return NextResponse.json(
        { error: 'Mount point is disabled' },
        { status: 400 }
      );
    }

    // Ensure the file storage manager is initialized
    if (!fileStorageManager.isInitialized()) {
      logger.debug('Initializing file storage manager for orphan scan', { mountPointId: id });
      await fileStorageManager.initialize();
    }

    // Check if backend supports listing
    const backend = await fileStorageManager.getBackend(id);
    if (!backend) {
      return serverError('Could not access storage backend');
    }

    const metadata = backend.getMetadata();
    if (!metadata.capabilities.list) {
      return NextResponse.json(
        { error: 'Storage backend does not support file listing' },
        { status: 400 }
      );
    }

    logger.info('Starting orphan scan', {
      mountPointId: id,
      backendType: mountPoint.backendType,
      userId: user.id,
    });

    // Import orphan recovery function
    const { scanForOrphans } = await import('@/lib/file-storage/orphan-recovery');
    const result = await scanForOrphans(id);

    logger.info('[Mount Points v1] Orphan scan complete', {
      mountPointId: id,
      totalFilesInStorage: result.totalFilesInStorage,
      totalFilesInDatabase: result.totalFilesInDatabase,
      orphanCount: result.orphans.length,
      errorCount: result.errors.length,
    });

    return NextResponse.json({
      ...result,
      scannedAt: result.scannedAt.toISOString(),
    });
  } catch (error) {
    logger.error(
      '[Mount Points v1] Error scanning mount point for orphans',
      { mountPointId: id },
      error instanceof Error ? error : undefined
    );
    return serverError(error instanceof Error ? error.message : 'Failed to scan for orphans');
  }
}

async function handleAdoptOrphans(req: NextRequest, { user, repos }: any, id: string) {
  try {
    const body = await req.json();
    const parseResult = adoptOrphansSchema.safeParse(body);

    if (!parseResult.success) {
      logger.debug('[Mount Points v1] Validation error on adopt-orphans', {
        errors: parseResult.error.issues,
      });
      return NextResponse.json(
        { error: 'Invalid request', details: parseResult.error.issues },
        { status: 400 }
      );
    }

    const { storageKeys, defaultProjectId, source, computeHashes } = parseResult.data;

    logger.debug('[Mount Points v1] Adopting orphan files', {
      mountPointId: id,
      userId: user.id,
      fileCount: storageKeys.length,
      computeHashes,
    });

    // Fetch the mount point
    const mountPoint = await repos.mountPoints.findById(id);

    if (!mountPoint) {
      logger.warn('Mount point not found for orphan adoption', { mountPointId: id });
      return notFound('Mount point');
    }

    // Check ownership
    if (mountPoint.scope === 'user' && mountPoint.userId !== user.id) {
      logger.warn('Unauthorized orphan adoption attempt', {
        mountPointId: id,
        userId: user.id,
        ownerId: mountPoint.userId,
      });
      return notFound('Mount point');
    }

    if (!mountPoint.enabled) {
      logger.debug('Mount point is disabled, cannot adopt', { mountPointId: id });
      return NextResponse.json(
        { error: 'Mount point is disabled' },
        { status: 400 }
      );
    }

    // Ensure the file storage manager is initialized
    if (!fileStorageManager.isInitialized()) {
      logger.debug('Initializing file storage manager for orphan adoption', { mountPointId: id });
      await fileStorageManager.initialize();
    }

    logger.info('Starting orphan adoption', {
      mountPointId: id,
      backendType: mountPoint.backendType,
      userId: user.id,
      fileCount: storageKeys.length,
    });

    // Import and call the orphan recovery function
    const { adoptOrphans } = await import('@/lib/file-storage/orphan-recovery');
    const result = await adoptOrphans(id, {
      storageKeys,
      defaultUserId: user.id,
      defaultProjectId: defaultProjectId ?? null,
      source,
      computeHashes,
    });

    logger.info('[Mount Points v1] Orphan adoption complete', {
      mountPointId: id,
      adopted: result.adopted,
      failed: result.failed.length,
    });

    return NextResponse.json(result);
  } catch (error) {
    logger.error(
      '[Mount Points v1] Error adopting orphan files',
      { mountPointId: id },
      error instanceof Error ? error : undefined
    );
    return serverError(error instanceof Error ? error.message : 'Failed to adopt orphan files');
  }
}

async function handleSetDefault(req: NextRequest, { user, repos }: any, id: string) {
  try {
    logger.debug('[Mount Points v1] POST set-default', {
      mountPointId: id,
      userId: user.id,
    });

    // Fetch the mount point
    const mountPoint = await repos.mountPoints.findById(id);

    if (!mountPoint) {
      logger.warn('Mount point not found for set-default', { mountPointId: id });
      return notFound('Mount point');
    }

    // Check ownership
    if (mountPoint.scope === 'user' && mountPoint.userId !== user.id) {
      logger.warn('Unauthorized set-default attempt', {
        mountPointId: id,
        userId: user.id,
        ownerId: mountPoint.userId,
      });
      return notFound('Mount point');
    }

    // Set as default
    await repos.mountPoints.setDefault(id);

    logger.info('[Mount Points v1] Default mount point updated', {
      mountPointId: id,
      name: mountPoint.name,
    });

    return NextResponse.json({
      success: true,
      mountPointId: id,
      message: 'Mount point set as default',
    });
  } catch (error) {
    logger.error(
      '[Mount Points v1] Failed to set default mount point',
      { mountPointId: id },
      error instanceof Error ? error : undefined
    );
    return serverError('Failed to set default mount point');
  }
}

// ============================================================================
// GET Handler
// ============================================================================

export const GET = createAuthenticatedParamsHandler<{ id: string }>(
  async (req: NextRequest, { user, repos }, { id }) => {
    try {
      logger.debug('[Mount Points v1] GET mount point', { mountPointId: id, userId: user.id });

      const mountPoint = await repos.mountPoints.findById(id);

      if (!mountPoint) {
        logger.warn('Mount point not found', { mountPointId: id });
        return notFound('Mount point');
      }

      // Check ownership
      if (mountPoint.scope === 'user' && mountPoint.userId !== user.id) {
        logger.warn('Unauthorized access to mount point', {
          mountPointId: id,
          userId: user.id,
          ownerId: mountPoint.userId,
        });
        return notFound('Mount point');
      }

      logger.debug('[Mount Points v1] Mount point retrieved', {
        mountPointId: id,
        scope: mountPoint.scope,
        backendType: mountPoint.backendType,
      });

      return NextResponse.json({ mountPoint });
    } catch (error) {
      logger.error(
        '[Mount Points v1] Error fetching mount point',
        { mountPointId: id, userId: user.id },
        error instanceof Error ? error : undefined
      );
      return serverError('Failed to fetch mount point');
    }
  }
);

// ============================================================================
// PUT Handler
// ============================================================================

export const PUT = createAuthenticatedParamsHandler<{ id: string }>(
  async (req: NextRequest, { user, repos }, { id }) => {
    try {
      logger.debug('[Mount Points v1] PUT mount point', { mountPointId: id, userId: user.id });

      // Verify ownership
      const existingMountPoint = await repos.mountPoints.findById(id);

      if (!existingMountPoint) {
        logger.warn('Mount point not found for update', { mountPointId: id });
        return notFound('Mount point');
      }

      // Check ownership
      if (existingMountPoint.scope === 'user' && existingMountPoint.userId !== user.id) {
        logger.warn('Unauthorized update attempt', {
          mountPointId: id,
          userId: user.id,
          ownerId: existingMountPoint.userId,
        });
        return notFound('Mount point');
      }

      const body = await req.json();
      const validatedData = updateMountPointSchema.parse(body);

      // Build update data
      const updateData: Record<string, any> = {};

      if (validatedData.name !== undefined) {
        updateData.name = validatedData.name;
      }

      if (validatedData.path !== undefined) {
        updateData.backendConfig = {
          ...existingMountPoint.backendConfig,
          basePath: validatedData.path,
        };
      }

      if (validatedData.config !== undefined) {
        updateData.backendConfig = {
          ...existingMountPoint.backendConfig,
          ...validatedData.config,
        };
      }

      // Update the mount point
      const updatedMountPoint = await repos.mountPoints.update(id, updateData);

      if (!updatedMountPoint) {
        return serverError('Failed to update mount point');
      }

      logger.info('[Mount Points v1] Mount point updated', {
        mountPointId: id,
        name: updatedMountPoint.name,
        backendType: updatedMountPoint.backendType,
      });

      // Refresh the file storage manager to pick up the updated mount point
      try {
        if (!fileStorageManager.isInitialized()) {
          await fileStorageManager.initialize();
        } else {
          await fileStorageManager.refreshMountPoints();
        }
        logger.debug('File storage manager refreshed after mount point update', {
          mountPointId: id,
        });
      } catch (refreshError) {
        logger.warn('Failed to refresh file storage manager after mount point update', {
          mountPointId: id,
          error: refreshError instanceof Error ? refreshError.message : String(refreshError),
        });
      }

      return NextResponse.json({ mountPoint: updatedMountPoint });
    } catch (error) {
      if (error instanceof z.ZodError) {
        logger.debug('[Mount Points v1] Validation error on update', {
          errors: error.issues,
        });
        return validationError(error);
      }

      logger.error(
        '[Mount Points v1] Error updating mount point',
        { mountPointId: id, userId: user.id },
        error instanceof Error ? error : undefined
      );
      return serverError('Failed to update mount point');
    }
  }
);

// ============================================================================
// DELETE Handler
// ============================================================================

export const DELETE = createAuthenticatedParamsHandler<{ id: string }>(
  async (req: NextRequest, { user, repos }, { id }) => {
    try {
      logger.debug('[Mount Points v1] DELETE mount point', {
        mountPointId: id,
        userId: user.id,
      });

      // Verify ownership
      const existingMountPoint = await repos.mountPoints.findById(id);

      if (!existingMountPoint) {
        logger.warn('Mount point not found for deletion', { mountPointId: id });
        return notFound('Mount point');
      }

      // Check ownership
      if (existingMountPoint.scope === 'user' && existingMountPoint.userId !== user.id) {
        logger.warn('Unauthorized delete attempt', {
          mountPointId: id,
          userId: user.id,
          ownerId: existingMountPoint.userId,
        });
        return notFound('Mount point');
      }

      // Delete the mount point
      const deleted = await repos.mountPoints.delete(id);

      if (!deleted) {
        return serverError('Failed to delete mount point');
      }

      logger.info('[Mount Points v1] Mount point deleted', {
        mountPointId: id,
        name: existingMountPoint.name,
        wasDefault: existingMountPoint.isDefault,
      });

      // Refresh the file storage manager to remove the deleted mount point
      try {
        if (!fileStorageManager.isInitialized()) {
          await fileStorageManager.initialize();
        } else {
          await fileStorageManager.refreshMountPoints();
        }
        logger.debug('File storage manager refreshed after mount point deletion', {
          mountPointId: id,
        });
      } catch (refreshError) {
        logger.warn('Failed to refresh file storage manager after mount point deletion', {
          mountPointId: id,
          error: refreshError instanceof Error ? refreshError.message : String(refreshError),
        });
      }

      return NextResponse.json({
        success: true,
        message: 'Mount point deleted successfully',
      });
    } catch (error) {
      logger.error(
        '[Mount Points v1] Error deleting mount point',
        { mountPointId: id, userId: user.id },
        error instanceof Error ? error : undefined
      );
      return serverError('Failed to delete mount point');
    }
  }
);

// ============================================================================
// POST Handler - Actions
// ============================================================================

export const POST = createAuthenticatedParamsHandler<{ id: string }>(
  async (req: NextRequest, { user, repos }, { id }) => {
    const { searchParams } = new URL(req.url);
    const action = searchParams.get('action');

    switch (action) {
      case 'test':
        return handleTest(req, { user, repos }, id);
      case 'scan-orphans':
        return handleScanOrphans(req, { user, repos }, id);
      case 'adopt-orphans':
        return handleAdoptOrphans(req, { user, repos }, id);
      case 'set-default':
        return handleSetDefault(req, { user, repos }, id);
      default:
        return badRequest(
          `Unknown action: ${action}. Available actions: test, scan-orphans, adopt-orphans, set-default`
        );
    }
  }
);
