/**
 * DEPRECATED - Projects API (Legacy Route)
 * This route has been moved to /api/v1/projects
 *
 * 410 Gone - Endpoint permanently removed
 */

import { movedToV1 } from '@/lib/api/responses'

export async function GET() {
  return movedToV1('/api/v1/projects')
}

export async function POST() {
  return movedToV1('/api/v1/projects')
}
