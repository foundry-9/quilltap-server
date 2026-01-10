/**
 * Individual Mount Point Operations
 *
 * GET    /api/mount-points/[id]     - Get a specific mount point
 * PATCH  /api/mount-points/[id]     - Update a mount point
 * DELETE /api/mount-points/[id]     - Delete a mount point
 */

import { NextResponse } from 'next/server'
import { createAuthenticatedParamsHandler } from '@/lib/api/middleware'
import { logger } from '@/lib/logger'
import { z } from 'zod'
import { fileStorageManager } from '@/lib/file-storage/manager'

/**
 * GET /api/mount-points/[id]
 * Get a specific mount point
 */
export const GET = createAuthenticatedParamsHandler<{ id: string }>(
  async (req, { user, repos }, { id }) => {
    try {
      logger.debug('Fetching mount point', { mountPointId: id, userId: user.id })

      const mountPoint = await repos.mountPoints.findById(id)

      if (!mountPoint) {
        logger.warn('Mount point not found', { mountPointId: id })
        return NextResponse.json(
          { error: 'Mount point not found' },
          { status: 404 }
        )
      }

      // Check ownership: user-scoped mount points must belong to the current user
      // System-scoped mount points are visible to all users
      if (mountPoint.scope === 'user' && mountPoint.userId !== user.id) {
        logger.warn('Unauthorized access to mount point', {
          mountPointId: id,
          userId: user.id,
          ownerId: mountPoint.userId,
        })
        return NextResponse.json(
          { error: 'Mount point not found' },
          { status: 404 }
        )
      }

      logger.debug('Mount point retrieved', {
        mountPointId: id,
        scope: mountPoint.scope,
        backendType: mountPoint.backendType,
      })

      return NextResponse.json({ mountPoint })
    } catch (error) {
      logger.error('Error fetching mount point', { endpoint: '/api/mount-points/[id]', method: 'GET', mountPointId: id }, error instanceof Error ? error : undefined)
      return NextResponse.json(
        { error: 'Failed to fetch mount point' },
        { status: 500 }
      )
    }
  }
)

/**
 * PATCH /api/mount-points/[id]
 * Update a mount point
 *
 * Body: {
 *   name?: string,
 *   description?: string,
 *   backendConfig?: Record<string, unknown>,
 *   encryptedSecrets?: string | null,
 *   enabled?: boolean
 * }
 */
export const PATCH = createAuthenticatedParamsHandler<{ id: string }>(
  async (req, { user, repos }, { id }) => {
    try {
      logger.debug('Updating mount point', { mountPointId: id, userId: user.id })

      // Verify ownership
      const existingMountPoint = await repos.mountPoints.findById(id)

      if (!existingMountPoint) {
        logger.warn('Mount point not found for update', { mountPointId: id })
        return NextResponse.json(
          { error: 'Mount point not found' },
          { status: 404 }
        )
      }

      // Check ownership
      if (existingMountPoint.scope === 'user' && existingMountPoint.userId !== user.id) {
        logger.warn('Unauthorized update attempt', {
          mountPointId: id,
          userId: user.id,
          ownerId: existingMountPoint.userId,
        })
        return NextResponse.json(
          { error: 'Mount point not found' },
          { status: 404 }
        )
      }

      const body = await req.json()

      // Build update data
      const updateData: Record<string, any> = {}

      if (body.name !== undefined) {
        if (typeof body.name !== 'string' || body.name.trim().length === 0) {
          return NextResponse.json(
            { error: 'Name must be a non-empty string' },
            { status: 400 }
          )
        }
        if (body.name.length > 100) {
          return NextResponse.json(
            { error: 'Name must be 100 characters or less' },
            { status: 400 }
          )
        }
        updateData.name = body.name.trim()
      }

      if (body.description !== undefined) {
        if (typeof body.description !== 'string') {
          return NextResponse.json(
            { error: 'Description must be a string' },
            { status: 400 }
          )
        }
        if (body.description.length > 500) {
          return NextResponse.json(
            { error: 'Description must be 500 characters or less' },
            { status: 400 }
          )
        }
        updateData.description = body.description || undefined
      }

      if (body.backendConfig !== undefined) {
        if (typeof body.backendConfig !== 'object' || body.backendConfig === null) {
          return NextResponse.json(
            { error: 'Backend configuration must be an object' },
            { status: 400 }
          )
        }
        updateData.backendConfig = body.backendConfig
      }

      if (body.encryptedSecrets !== undefined) {
        if (body.encryptedSecrets !== null && typeof body.encryptedSecrets !== 'string') {
          return NextResponse.json(
            { error: 'Encrypted secrets must be a string or null' },
            { status: 400 }
          )
        }
        updateData.encryptedSecrets = body.encryptedSecrets
      }

      if (body.enabled !== undefined) {
        if (typeof body.enabled !== 'boolean') {
          return NextResponse.json(
            { error: 'Enabled must be a boolean' },
            { status: 400 }
          )
        }
        updateData.enabled = body.enabled
      }

      // Update the mount point
      const updatedMountPoint = await repos.mountPoints.update(id, updateData)

      if (!updatedMountPoint) {
        return NextResponse.json(
          { error: 'Failed to update mount point' },
          { status: 500 }
        )
      }

      logger.info('Mount point updated', {
        mountPointId: id,
        name: updatedMountPoint.name,
        backendType: updatedMountPoint.backendType,
      })

      // Refresh the file storage manager to pick up the updated mount point
      try {
        if (!fileStorageManager.isInitialized()) {
          await fileStorageManager.initialize()
        } else {
          await fileStorageManager.refreshMountPoints()
        }
        logger.debug('File storage manager refreshed after mount point update', {
          mountPointId: id,
        })
      } catch (refreshError) {
        logger.warn('Failed to refresh file storage manager after mount point update', {
          mountPointId: id,
          error: refreshError instanceof Error ? refreshError.message : String(refreshError),
        })
      }

      return NextResponse.json({ mountPoint: updatedMountPoint })
    } catch (error) {
      logger.error('Error updating mount point', { endpoint: '/api/mount-points/[id]', method: 'PATCH', mountPointId: id }, error instanceof Error ? error : undefined)
      return NextResponse.json(
        { error: 'Failed to update mount point' },
        { status: 500 }
      )
    }
  }
)

/**
 * DELETE /api/mount-points/[id]
 * Delete a mount point
 *
 * Note: If mount point is the default or project default, response includes a warning
 */
export const DELETE = createAuthenticatedParamsHandler<{ id: string }>(
  async (req, { user, repos }, { id }) => {
    try {
      logger.debug('Deleting mount point', { mountPointId: id, userId: user.id })

      // Verify ownership
      const existingMountPoint = await repos.mountPoints.findById(id)

      if (!existingMountPoint) {
        logger.warn('Mount point not found for deletion', { mountPointId: id })
        return NextResponse.json(
          { error: 'Mount point not found' },
          { status: 404 }
        )
      }

      // Check ownership
      if (existingMountPoint.scope === 'user' && existingMountPoint.userId !== user.id) {
        logger.warn('Unauthorized delete attempt', {
          mountPointId: id,
          userId: user.id,
          ownerId: existingMountPoint.userId,
        })
        return NextResponse.json(
          { error: 'Mount point not found' },
          { status: 404 }
        )
      }

      // Check if this is a default mount point and warn about orphaned files
      const isDefault = existingMountPoint.isDefault
      const isProjectDefault = existingMountPoint.isProjectDefault
      let orphanedWarning = null

      if (isDefault || isProjectDefault) {
        orphanedWarning = {
          message: 'Warning: This mount point is marked as default',
          isDefault,
          isProjectDefault,
          note: 'Files stored in this mount point may become orphaned if no other mount point is available',
        }

        logger.warn('Deleting default mount point', {
          mountPointId: id,
          isDefault,
          isProjectDefault,
        })
      }

      // Delete the mount point
      const deleted = await repos.mountPoints.delete(id)

      if (!deleted) {
        return NextResponse.json(
          { error: 'Failed to delete mount point' },
          { status: 500 }
        )
      }

      logger.info('Mount point deleted', {
        mountPointId: id,
        name: existingMountPoint.name,
        wasDefault: isDefault,
        wasProjectDefault: isProjectDefault,
      })

      // Refresh the file storage manager to remove the deleted mount point
      try {
        if (!fileStorageManager.isInitialized()) {
          await fileStorageManager.initialize()
        } else {
          await fileStorageManager.refreshMountPoints()
        }
        logger.debug('File storage manager refreshed after mount point deletion', {
          mountPointId: id,
        })
      } catch (refreshError) {
        logger.warn('Failed to refresh file storage manager after mount point deletion', {
          mountPointId: id,
          error: refreshError instanceof Error ? refreshError.message : String(refreshError),
        })
      }

      const response: Record<string, any> = {
        success: true,
        message: 'Mount point deleted successfully',
      }

      if (orphanedWarning) {
        response.warning = orphanedWarning
      }

      return NextResponse.json(response)
    } catch (error) {
      logger.error('Error deleting mount point', { endpoint: '/api/mount-points/[id]', method: 'DELETE', mountPointId: id }, error instanceof Error ? error : undefined)
      return NextResponse.json(
        { error: 'Failed to delete mount point' },
        { status: 500 }
      )
    }
  }
)
