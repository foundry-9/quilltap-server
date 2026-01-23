/**
 * Legacy API Key export route - DEPRECATED
 * Moved to /api/v1/api-keys?action=export
 */

import { movedToV1 } from '@/lib/api/responses'

export async function POST() {
  return movedToV1('/api/v1/api-keys', 'action=export')
}
