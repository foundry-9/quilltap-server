/**
 * DEPRECATED - Sync Mappings API (Legacy Route)
 * GET has been moved to /api/v1/sync/mappings
 * POST has been moved to /api/v1/sync/mappings
 *
 * 410 Gone - Endpoint permanently removed
 */

import { movedToV1 } from '@/lib/api/responses'

export async function GET() {
  return movedToV1('/api/v1/sync/mappings')
}

export async function POST() {
  return movedToV1('/api/v1/sync/mappings')
}
