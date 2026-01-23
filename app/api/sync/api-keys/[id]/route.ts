/**
 * DEPRECATED - Sync API Key Individual Operations (Legacy Route)
 * PATCH/DELETE have been moved to /api/v1/sync/api-keys/[id]
 *
 * 410 Gone - Endpoint permanently removed
 */

import { movedToV1 } from '@/lib/api/responses'

export async function PATCH() {
  return movedToV1('/api/v1/sync/api-keys/[id]')
}

export async function DELETE() {
  return movedToV1('/api/v1/sync/api-keys/[id]')
}
