/**
 * Mount Points Backends API Route
 *
 * GET /api/mount-points/backends
 * Returns the list of available storage backends from registered plugins
 */

import { NextResponse } from 'next/server'
import { getServerSession } from '@/lib/auth/session'
import { logger } from '@/lib/logger'
import { fileStorageManager } from '@/lib/file-storage/manager'

/**
 * GET /api/mount-points/backends
 * Get list of available storage backends
 */
export async function GET() {
  const log = logger.child({ context: 'api.mount-points.backends' })

  try {
    // Check authentication
    const session = await getServerSession()
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    log.debug('Getting available backends', { userId: session.user.id })

    // Get registered backends from the file storage manager
    const backends = fileStorageManager.getAvailableBackends()

    // Transform to the format expected by the UI
    // - Map providerId to backendId
    // - Map 'password' type to 'secret' type for config fields
    const result = backends.map((backend) => ({
      backendId: backend.providerId,
      displayName: backend.displayName,
      description: backend.description,
      configFields: (backend.configFields || []).map((field) => ({
        name: field.name,
        label: field.label,
        type: field.type === 'password' ? 'secret' : field.type,
        required: field.required,
        description: field.description,
        placeholder: field.placeholder,
        defaultValue: field.defaultValue,
      })),
    }))

    log.debug('Returning available backends', { count: result.length })

    return NextResponse.json(result)
  } catch (error) {
    log.error('Failed to get available backends', {}, error instanceof Error ? error : undefined)

    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to get available backends' },
      { status: 500 }
    )
  }
}
