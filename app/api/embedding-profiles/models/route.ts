/**
 * DEPRECATED - Embedding Models List (Legacy Route)
 * This route has been moved to /api/v1/embedding-profiles with action=list-models
 *
 * 410 Gone - Endpoint permanently removed
 */

import { movedToV1 } from '@/lib/api/responses'

export async function GET() {
  return movedToV1('/api/v1/embedding-profiles', 'action=list-models')
}
