/**
 * Mount Point Orphan Adoption Endpoint
 *
 * POST /api/mount-points/[id]/adopt-orphans - Adopt orphaned files by creating database entries
 *
 * This creates new file entries in the database for files that exist in
 * storage but don't have corresponding database records.
 */

import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createAuthenticatedParamsHandler } from '@/lib/api/middleware'
import { logger } from '@/lib/logger'
import { fileStorageManager } from '@/lib/file-storage/manager'
import { adoptOrphans } from '@/lib/file-storage/orphan-recovery'
import { FileSourceEnum } from '@/lib/schemas/file.types'

/**
 * Request body schema for adopting orphans
 */
const AdoptOrphansRequestSchema = z.object({
  storageKeys: z.array(z.string().min(1)).min(1, 'At least one storage key is required'),
  defaultProjectId: z.string().uuid().nullable().optional(),
  source: FileSourceEnum.optional().default('IMPORTED'),
  computeHashes: z.boolean().optional().default(false),
})

/**
 * POST /api/mount-points/[id]/adopt-orphans
 * Adopt orphaned files by creating database entries
 *
 * Request body: {
 *   storageKeys: string[],     // Storage keys of orphan files to adopt
 *   defaultProjectId?: string, // Default project ID for files without one
 *   source?: 'IMPORTED' | 'UPLOADED' | 'GENERATED' | 'SYSTEM',
 *   computeHashes?: boolean    // Whether to compute SHA256 hashes (slower but accurate)
 * }
 *
 * Response: {
 *   adopted: number,
 *   failed: Array<{ storageKey: string, error: string }>,
 *   files: FileEntry[]
 * }
 */
export const POST = createAuthenticatedParamsHandler<{ id: string }>(
  async (req, { user, repos }, { id }) => {
    try {
      // Parse and validate request body
      const body = await req.json()
      const parseResult = AdoptOrphansRequestSchema.safeParse(body)

      if (!parseResult.success) {
        return NextResponse.json(
          { error: 'Invalid request', details: parseResult.error.issues },
          { status: 400 }
        )
      }

      const { storageKeys, defaultProjectId, source, computeHashes } = parseResult.data

      logger.debug('Adopting orphan files', {
        context: 'api.mount-points.adopt-orphans',
        mountPointId: id,
        userId: user.id,
        fileCount: storageKeys.length,
        computeHashes,
      })

      // Fetch the mount point
      const mountPoint = await repos.mountPoints.findById(id)

      if (!mountPoint) {
        logger.warn('Mount point not found for orphan adoption', { mountPointId: id })
        return NextResponse.json(
          { error: 'Mount point not found' },
          { status: 404 }
        )
      }

      // Check ownership - only allow adopting from system mount points or user's own
      if (mountPoint.scope === 'user' && mountPoint.userId !== user.id) {
        logger.warn('Unauthorized orphan adoption attempt', {
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
        logger.debug('Mount point is disabled, cannot adopt', { mountPointId: id })
        return NextResponse.json(
          { error: 'Mount point is disabled' },
          { status: 400 }
        )
      }

      // Ensure the file storage manager is initialized
      if (!fileStorageManager.isInitialized()) {
        logger.debug('Initializing file storage manager for orphan adoption', { mountPointId: id })
        await fileStorageManager.initialize()
      }

      logger.info('Starting orphan adoption', {
        context: 'api.mount-points.adopt-orphans',
        mountPointId: id,
        backendType: mountPoint.backendType,
        userId: user.id,
        fileCount: storageKeys.length,
      })

      // Perform the adoption
      const result = await adoptOrphans(id, {
        storageKeys,
        defaultUserId: user.id,
        defaultProjectId: defaultProjectId ?? null,
        source,
        computeHashes,
      })

      logger.info('Orphan adoption complete', {
        context: 'api.mount-points.adopt-orphans',
        mountPointId: id,
        adopted: result.adopted,
        failed: result.failed.length,
      })

      return NextResponse.json(result)
    } catch (error) {
      logger.error(
        'Error adopting orphan files',
        {
          endpoint: '/api/mount-points/[id]/adopt-orphans',
          method: 'POST',
          mountPointId: id,
        },
        error instanceof Error ? error : undefined
      )
      return NextResponse.json(
        { error: error instanceof Error ? error.message : 'Failed to adopt orphan files' },
        { status: 500 }
      )
    }
  }
)
