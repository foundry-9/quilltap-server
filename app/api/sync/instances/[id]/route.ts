/**
 * DEPRECATED - Sync Instance Detail API (Legacy Route)
 * GET/PUT/DELETE have been moved to /api/v1/sync/instances/[id]
 *
 * 410 Gone - Endpoint permanently removed
 */

import { movedToV1 } from '@/lib/api/responses'

export async function GET() {
  return movedToV1('/api/v1/sync/instances/[id]')
}

export async function PUT() {
  return movedToV1('/api/v1/sync/instances/[id]')
}

export async function DELETE() {
  return movedToV1('/api/v1/sync/instances/[id]')
}
