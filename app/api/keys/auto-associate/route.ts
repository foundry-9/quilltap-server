/**
 * Legacy API Key auto-associate route - DEPRECATED
 * Moved to /api/v1/api-keys?action=auto-associate
 */

import { movedToV1 } from '@/lib/api/responses'

export async function POST() {
  return movedToV1('/api/v1/api-keys', 'action=auto-associate')
}
