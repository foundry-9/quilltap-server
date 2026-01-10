/**
 * Mount Point Default Management Endpoint
 *
 * POST /api/mount-points/[id]/set-default  - Set mount point as default
 */

import { NextResponse } from 'next/server'
import { createAuthenticatedParamsHandler } from '@/lib/api/middleware'
import { logger } from '@/lib/logger'
import { fileStorageManager } from '@/lib/file-storage/manager'

/**
 * POST /api/mount-points/[id]/set-default
 * Set this mount point as the system default
 *
 * Response: {
 *   success: boolean,
 *   mountPointId: string,
 *   isDefault: boolean,
 *   message: string
 * }
 */
export const POST = createAuthenticatedParamsHandler<{ id: string }>(
  async (req, { user, repos }, { id }) => {
    try {
      logger.debug('Setting mount point as default', {
        mountPointId: id,
        userId: user.id,
      })

      // Fetch the mount point
      const mountPoint = await repos.mountPoints.findById(id)

      if (!mountPoint) {
        logger.warn('Mount point not found for set-default', { mountPointId: id })
        return NextResponse.json(
          { error: 'Mount point not found' },
          { status: 404 }
        )
      }

      // Check ownership
      if (mountPoint.scope === 'user' && mountPoint.userId !== user.id) {
        logger.warn('Unauthorized set-default attempt', {
          mountPointId: id,
          userId: user.id,
          ownerId: mountPoint.userId,
        })
        return NextResponse.json(
          { error: 'Mount point not found' },
          { status: 404 }
        )
      }

      if (!mountPoint.enabled) {
        logger.warn('Cannot set disabled mount point as default', {
          mountPointId: id,
        })
        return NextResponse.json(
          { error: 'Cannot set a disabled mount point as default' },
          { status: 400 }
        )
      }

      // Set as default
      logger.info('Setting mount point as default', {
        mountPointId: id,
        name: mountPoint.name,
      })
      await repos.mountPoints.setDefault(id)

      // Fetch the updated mount point
      const updatedMountPoint = await repos.mountPoints.findById(id)

      if (!updatedMountPoint) {
        return NextResponse.json(
          { error: 'Failed to verify default setting' },
          { status: 500 }
        )
      }

      const response = {
        success: true,
        mountPointId: updatedMountPoint.id,
        isDefault: updatedMountPoint.isDefault,
        message: `Mount point "${updatedMountPoint.name}" is now the default storage location`,
      }

      logger.info('Mount point default status updated', {
        mountPointId: id,
        isDefault: updatedMountPoint.isDefault,
      })

      // Refresh the file storage manager to pick up the new default
      try {
        if (!fileStorageManager.isInitialized()) {
          await fileStorageManager.initialize()
        } else {
          await fileStorageManager.refreshMountPoints()
        }
        logger.debug('File storage manager refreshed after setting default', {
          mountPointId: id,
        })
      } catch (refreshError) {
        logger.warn('Failed to refresh file storage manager after setting default', {
          mountPointId: id,
          error: refreshError instanceof Error ? refreshError.message : String(refreshError),
        })
      }

      return NextResponse.json(response)
    } catch (error) {
      logger.error('Error setting mount point as default', { endpoint: '/api/mount-points/[id]/set-default', method: 'POST', mountPointId: id }, error instanceof Error ? error : undefined)
      return NextResponse.json(
        { error: 'Failed to set mount point as default' },
        { status: 500 }
      )
    }
  }
)
