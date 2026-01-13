/**
 * Mount Point Orphan Scan Endpoint
 *
 * POST /api/mount-points/[id]/scan-orphans - Scan for orphaned files in a mount point
 *
 * Orphaned files are files that exist in the storage backend but don't have
 * corresponding entries in the database.
 */

import { NextResponse } from 'next/server'
import { createAuthenticatedParamsHandler } from '@/lib/api/middleware'
import { logger } from '@/lib/logger'
import { fileStorageManager } from '@/lib/file-storage/manager'
import { scanForOrphans } from '@/lib/file-storage/orphan-recovery'

/**
 * POST /api/mount-points/[id]/scan-orphans
 * Scan the mount point for orphaned files
 *
 * Response: {
 *   mountPointId: string,
 *   mountPointName: string,
 *   scannedAt: string,
 *   totalFilesInStorage: number,
 *   totalFilesInDatabase: number,
 *   orphans: OrphanFile[],
 *   errors: string[]
 * }
 */
export const POST = createAuthenticatedParamsHandler<{ id: string }>(
  async (req, { user, repos }, { id }) => {
    try {
      logger.debug('Scanning mount point for orphans', {
        context: 'api.mount-points.scan-orphans',
        mountPointId: id,
        userId: user.id,
      })

      // Fetch the mount point
      const mountPoint = await repos.mountPoints.findById(id)

      if (!mountPoint) {
        logger.warn('Mount point not found for orphan scan', { mountPointId: id })
        return NextResponse.json(
          { error: 'Mount point not found' },
          { status: 404 }
        )
      }

      // Check ownership - only allow scanning system mount points or user's own
      if (mountPoint.scope === 'user' && mountPoint.userId !== user.id) {
        logger.warn('Unauthorized orphan scan attempt', {
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
        logger.debug('Mount point is disabled, cannot scan', { mountPointId: id })
        return NextResponse.json(
          { error: 'Mount point is disabled' },
          { status: 400 }
        )
      }

      // Ensure the file storage manager is initialized
      if (!fileStorageManager.isInitialized()) {
        logger.debug('Initializing file storage manager for orphan scan', { mountPointId: id })
        await fileStorageManager.initialize()
      }

      // Check if backend supports listing
      const backend = await fileStorageManager.getBackend(id)
      if (!backend) {
        return NextResponse.json(
          { error: 'Could not access storage backend' },
          { status: 500 }
        )
      }

      const metadata = backend.getMetadata()
      if (!metadata.capabilities.list) {
        return NextResponse.json(
          { error: 'Storage backend does not support file listing' },
          { status: 400 }
        )
      }

      logger.info('Starting orphan scan', {
        context: 'api.mount-points.scan-orphans',
        mountPointId: id,
        backendType: mountPoint.backendType,
        userId: user.id,
      })

      // Perform the scan
      const result = await scanForOrphans(id)

      logger.info('Orphan scan complete', {
        context: 'api.mount-points.scan-orphans',
        mountPointId: id,
        totalFilesInStorage: result.totalFilesInStorage,
        totalFilesInDatabase: result.totalFilesInDatabase,
        orphanCount: result.orphans.length,
        errorCount: result.errors.length,
      })

      return NextResponse.json({
        ...result,
        scannedAt: result.scannedAt.toISOString(),
      })
    } catch (error) {
      logger.error(
        'Error scanning mount point for orphans',
        {
          endpoint: '/api/mount-points/[id]/scan-orphans',
          method: 'POST',
          mountPointId: id,
        },
        error instanceof Error ? error : undefined
      )
      return NextResponse.json(
        { error: error instanceof Error ? error.message : 'Failed to scan for orphans' },
        { status: 500 }
      )
    }
  }
)
