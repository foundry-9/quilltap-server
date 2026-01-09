/**
 * Mount Point Default Management Endpoint
 *
 * POST /api/mount-points/[id]/set-default  - Set mount point as default
 */

import { NextResponse } from 'next/server'
import { createAuthenticatedParamsHandler } from '@/lib/api/middleware'
import { logger } from '@/lib/logger'

/**
 * POST /api/mount-points/[id]/set-default
 * Set this mount point as the default
 *
 * Query params:
 *   - type: 'general' (default) to set as general default, 'project' to set as project default
 *
 * Response: {
 *   success: boolean,
 *   mountPointId: string,
 *   type: 'general' | 'project',
 *   isDefault: boolean,
 *   isProjectDefault: boolean,
 *   message: string
 * }
 */
export const POST = createAuthenticatedParamsHandler<{ id: string }>(
  async (req, { user, repos }, { id }) => {
    try {
      // Get query parameter for type
      const { searchParams } = new URL(req.url)
      const type = searchParams.get('type') || 'general'

      if (type !== 'general' && type !== 'project') {
        logger.warn('Invalid type parameter for set-default', {
          mountPointId: id,
          type,
        })
        return NextResponse.json(
          { error: 'Invalid type parameter. Use "general" or "project"' },
          { status: 400 }
        )
      }

      logger.debug('Setting mount point as default', {
        mountPointId: id,
        userId: user.id,
        type,
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

      // Set the appropriate default flag
      if (type === 'general') {
        logger.info('Setting mount point as general default', {
          mountPointId: id,
          name: mountPoint.name,
        })
        await repos.mountPoints.setDefault(id)
      } else {
        logger.info('Setting mount point as project default', {
          mountPointId: id,
          name: mountPoint.name,
        })
        await repos.mountPoints.setProjectDefault(id)
      }

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
        type,
        isDefault: updatedMountPoint.isDefault,
        isProjectDefault: updatedMountPoint.isProjectDefault,
        message:
          type === 'general'
            ? `Mount point "${updatedMountPoint.name}" is now the default storage location`
            : `Mount point "${updatedMountPoint.name}" is now the default project storage location`,
      }

      logger.info('Mount point default status updated', {
        mountPointId: id,
        type,
        isDefault: updatedMountPoint.isDefault,
        isProjectDefault: updatedMountPoint.isProjectDefault,
      })

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
