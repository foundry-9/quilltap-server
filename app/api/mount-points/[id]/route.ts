/**
 * DEPRECATED - Individual Mount Point Operations (Legacy Route)
 * This route has been moved to /api/v1/system/mount-points/[id]
 *
 * 410 Gone - Endpoint permanently removed
 */

import { movedToV1 } from '@/lib/api/responses'

export async function GET() {
  return movedToV1('/api/v1/system/mount-points/{id}')
}

export async function PATCH() {
  return movedToV1('/api/v1/system/mount-points/{id}', 'Use PUT instead of PATCH')
}

export async function DELETE() {
  return movedToV1('/api/v1/system/mount-points/{id}')
}
