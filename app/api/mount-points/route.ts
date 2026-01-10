/**
 * Mount Points Management Routes
 *
 * GET    /api/mount-points           - List all mount points for current user
 * POST   /api/mount-points           - Create a new mount point
 */

import { NextRequest, NextResponse } from 'next/server'
import { createAuthenticatedHandler } from '@/lib/api/middleware'
import { logger } from '@/lib/logger'
import { z } from 'zod'
import { MountPointSchema, LocalBackendConfigSchema, S3BackendConfigSchema } from '@/lib/file-storage/mount-point.types'
import { fileStorageManager } from '@/lib/file-storage/manager'

// Validation schema for creating a mount point
const createMountPointSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100, 'Name must be 100 characters or less'),
  description: z.string().max(500, 'Description must be 500 characters or less').optional(),
  backendType: z.string().min(1, 'Backend type is required'),
  backendConfig: z.record(z.unknown()),
  encryptedSecrets: z.string().nullable().optional(),
  scope: z.enum(['system', 'user']).default('user'),
  enabled: z.boolean().default(true),
})

/**
 * GET /api/mount-points
 * List all mount points for the current user (system scope + user scope with matching userId)
 */
export const GET = createAuthenticatedHandler(async (req: NextRequest, { user, repos }) => {
  try {
    logger.debug('Fetching mount points for user', { userId: user.id })

    // Get system-scoped mount points
    const systemMountPoints = await repos.mountPoints.findByScope('system')

    // Get user-scoped mount points
    const userMountPoints = await repos.mountPoints.findByScope('user', user.id)

    // Combine and sort by createdAt descending
    const allMountPoints = [...systemMountPoints, ...userMountPoints]
    allMountPoints.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())

    logger.debug('Mount points retrieved', {
      systemCount: systemMountPoints.length,
      userCount: userMountPoints.length,
      totalCount: allMountPoints.length,
    })

    return NextResponse.json({ mountPoints: allMountPoints })
  } catch (error) {
    logger.error('Error fetching mount points', { endpoint: '/api/mount-points', method: 'GET' }, error instanceof Error ? error : undefined)
    return NextResponse.json(
      { error: 'Failed to fetch mount points' },
      { status: 500 }
    )
  }
})

/**
 * POST /api/mount-points
 * Create a new mount point
 *
 * Body: {
 *   name: string,
 *   description?: string,
 *   backendType: string,
 *   backendConfig: Record<string, unknown>,
 *   encryptedSecrets?: string | null,
 *   scope?: 'system' | 'user',
 *   enabled?: boolean
 * }
 */
export const POST = createAuthenticatedHandler(async (req: NextRequest, { user, repos }) => {
  try {
    const body = await req.json()

    logger.debug('Creating mount point', {
      name: body.name,
      backendType: body.backendType,
      scope: body.scope || 'user',
    })

    // Validate request body
    const validatedData = createMountPointSchema.parse(body)

    // Create the mount point
    const mountPoint = await repos.mountPoints.create({
      name: validatedData.name,
      description: validatedData.description || undefined,
      backendType: validatedData.backendType,
      backendConfig: validatedData.backendConfig,
      encryptedSecrets: validatedData.encryptedSecrets || null,
      scope: validatedData.scope,
      userId: validatedData.scope === 'user' ? user.id : null,
      isDefault: false,
      enabled: validatedData.enabled,
      healthStatus: 'unknown',
    })

    logger.info('Mount point created', {
      mountPointId: mountPoint.id,
      name: mountPoint.name,
      backendType: mountPoint.backendType,
      scope: mountPoint.scope,
    })

    // Refresh the file storage manager to pick up the new mount point
    try {
      if (!fileStorageManager.isInitialized()) {
        await fileStorageManager.initialize()
      } else {
        await fileStorageManager.refreshMountPoints()
      }
      logger.debug('File storage manager refreshed after mount point creation', {
        mountPointId: mountPoint.id,
      })
    } catch (refreshError) {
      logger.warn('Failed to refresh file storage manager after mount point creation', {
        mountPointId: mountPoint.id,
        error: refreshError instanceof Error ? refreshError.message : String(refreshError),
      })
    }

    return NextResponse.json({ mountPoint }, { status: 201 })
  } catch (error) {
    if (error instanceof z.ZodError) {
      logger.warn('Validation error creating mount point', {
        endpoint: '/api/mount-points',
        method: 'POST',
        errorCount: error.errors.length,
      })
      return NextResponse.json(
        { error: 'Validation error', details: error.errors },
        { status: 400 }
      )
    }

    logger.error('Error creating mount point', { endpoint: '/api/mount-points', method: 'POST' }, error instanceof Error ? error : undefined)
    return NextResponse.json(
      { error: 'Failed to create mount point' },
      { status: 500 }
    )
  }
})
