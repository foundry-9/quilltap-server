/**
 * DEPRECATED - Sync Instance Manual Sync API (Legacy Route)
 * This route has been moved to /api/v1/sync/instances/[id]?action=sync
 *
 * 410 Gone - Endpoint permanently removed
 */

import { movedToV1 } from '@/lib/api/responses'

export async function POST() {
  return movedToV1('/api/v1/sync/instances/[id]', 'action=sync')
}
