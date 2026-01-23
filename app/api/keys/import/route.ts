/**
 * Legacy API Key import route - DEPRECATED
 * Moved to /api/v1/api-keys?action=import
 */

import { movedToV1 } from '@/lib/api/responses'

export async function POST() {
  return movedToV1('/api/v1/api-keys', 'action=import')
}
