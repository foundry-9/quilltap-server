/**
 * DEPRECATED - Tasks Queue API Route (Legacy Route)
 * This route has been moved to /api/v1/system/tools?action=tasks-queue
 *
 * 410 Gone - Endpoint permanently removed
 */

import { movedToV1 } from '@/lib/api/responses'

export async function GET() {
  return movedToV1('/api/v1/system/tools?action=tasks-queue')
}

export async function POST() {
  return movedToV1('/api/v1/system/tools?action=tasks-queue', 'POST for start/stop control')
}
