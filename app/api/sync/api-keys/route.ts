/**
 * DEPRECATED - Sync API Keys API (Legacy Route)
 * GET has been moved to /api/v1/sync/api-keys
 * POST has been moved to /api/v1/sync/api-keys
 *
 * 410 Gone - Endpoint permanently removed
 */

import { movedToV1 } from '@/lib/api/responses'

export async function GET() {
  return movedToV1('/api/v1/sync/api-keys')
}

export async function POST() {
  return movedToV1('/api/v1/sync/api-keys')
}
