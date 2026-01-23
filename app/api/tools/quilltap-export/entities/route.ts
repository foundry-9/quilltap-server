/**
 * DEPRECATED - Quilltap Export Entities API (Legacy Route)
 * This route has been moved to /api/v1/system/tools?action=export-entities
 *
 * 410 Gone - Endpoint permanently removed
 */

import { movedToV1 } from '@/lib/api/responses'

export async function GET() {
  return movedToV1('/api/v1/system/tools?action=export-entities')
}
