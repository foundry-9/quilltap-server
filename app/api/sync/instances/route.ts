/**
 * DEPRECATED - Sync Instances API (Legacy Route)
 * GET/POST have been moved to /api/v1/sync/instances
 *
 * 410 Gone - Endpoint permanently removed
 */

import { movedToV1 } from '@/lib/api/responses'

export async function GET() {
  return movedToV1('/api/v1/sync/instances')
}

export async function POST() {
  return movedToV1('/api/v1/sync/instances')
}
