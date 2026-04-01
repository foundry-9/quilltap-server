/**
 * DEPRECATED - Image Provider Models (Legacy Route)
 * This route has been moved to /api/v1/image-profiles with action=list-models
 *
 * 410 Gone - Endpoint permanently removed
 */

import { movedToV1 } from '@/lib/api/responses'

export async function GET() {
  return movedToV1('/api/v1/image-profiles', 'action=list-models')
}
