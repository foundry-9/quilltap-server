/**
 * DEPRECATED - Legacy Route
 * This route has been moved to /api/v1/ui/sidebar?type=chats
 *
 * 410 Gone - Endpoint permanently removed
 */

import { movedToV1 } from '@/lib/api/responses'

export async function GET() {
  return movedToV1('/api/v1/ui/sidebar?type=chats')
}
