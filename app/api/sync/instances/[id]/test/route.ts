/**
 * DEPRECATED - Sync Instance Test Connection API (Legacy Route)
 * POST has been moved to /api/v1/sync/instances/[id]?action=test
 *
 * 410 Gone - Endpoint permanently removed
 */

import { movedToV1 } from '@/lib/api/responses'

export async function POST() {
  return movedToV1('/api/v1/sync/instances/[id]', 'action=test')
}
