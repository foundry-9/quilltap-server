/**
 * Mount Point Connection Test Endpoint
 *
 * POST /api/mount-points/[id]/test  - Test the connection to a mount point's backend
 */

import { NextResponse } from 'next/server'
import { createAuthenticatedParamsHandler } from '@/lib/api/middleware'
import { logger } from '@/lib/logger'
import { fileStorageManager } from '@/lib/file-storage/manager'

/**
 * POST /api/mount-points/[id]/test
 * Test the connection to the mount point's backend
 *
 * Returns health status of the mount point backend
 * Response: {
 *   mountPointId: string,
 *   healthy: boolean,
 *   status: 'healthy' | 'degraded' | 'unhealthy' | 'unknown',
 *   message: string,
 *   testedAt: string
 * }
 */
export const POST = createAuthenticatedParamsHandler<{ id: string }>(
  async (req, { user, repos }, { id }) => {
    try {
      logger.debug('Testing mount point connection', { mountPointId: id, userId: user.id })

      // Fetch the mount point
      const mountPoint = await repos.mountPoints.findById(id)

      if (!mountPoint) {
        logger.warn('Mount point not found for test', { mountPointId: id })
        return NextResponse.json(
          { error: 'Mount point not found' },
          { status: 404 }
        )
      }

      // Check ownership
      if (mountPoint.scope === 'user' && mountPoint.userId !== user.id) {
        logger.warn('Unauthorized test attempt', {
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
        logger.debug('Mount point is disabled, cannot test', { mountPointId: id })
        return NextResponse.json(
          {
            mountPointId: id,
            healthy: false,
            status: 'unhealthy' as const,
            message: 'Mount point is disabled',
            testedAt: new Date().toISOString(),
          },
          { status: 400 }
        )
      }

      logger.info('Mount point health check initiated', {
        mountPointId: id,
        backendType: mountPoint.backendType,
        scope: mountPoint.scope,
      })

      const now = new Date().toISOString()

      // Try to get the backend from the file storage manager
      const backend = fileStorageManager.getBackend(id)

      if (!backend) {
        // Backend could not be instantiated
        logger.warn('Could not get backend for mount point', {
          mountPointId: id,
          backendType: mountPoint.backendType,
        })

        await repos.mountPoints.updateHealth(id, 'unhealthy')

        return NextResponse.json({
          mountPointId: id,
          healthy: false,
          status: 'unhealthy' as const,
          message: `Failed to instantiate ${mountPoint.backendType} backend. Check configuration.`,
          testedAt: now,
          backendType: mountPoint.backendType,
          lastHealthCheck: now,
        })
      }

      // Test the connection
      const testResult = await backend.testConnection()

      // Determine health status based on test result
      let healthStatus: 'healthy' | 'degraded' | 'unhealthy' | 'unknown' = 'unknown'
      if (testResult.success) {
        healthStatus = 'healthy'
      } else {
        healthStatus = 'unhealthy'
      }

      // Update the health status in the database
      await repos.mountPoints.updateHealth(id, healthStatus)

      logger.info('Mount point health check complete', {
        mountPointId: id,
        backendType: mountPoint.backendType,
        healthy: testResult.success,
        latencyMs: testResult.latencyMs,
      })

      return NextResponse.json({
        mountPointId: id,
        healthy: testResult.success,
        status: healthStatus,
        message: testResult.message,
        testedAt: now,
        backendType: mountPoint.backendType,
        lastHealthCheck: now,
        latencyMs: testResult.latencyMs,
      })
    } catch (error) {
      logger.error('Error testing mount point connection', { endpoint: '/api/mount-points/[id]/test', method: 'POST', mountPointId: id }, error instanceof Error ? error : undefined)
      return NextResponse.json(
        { error: 'Failed to test mount point connection' },
        { status: 500 }
      )
    }
  }
)
