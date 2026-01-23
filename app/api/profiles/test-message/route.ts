/**
 * Legacy Connection Profile test-message route - DEPRECATED
 * Moved to /api/v1/connection-profiles?action=test-message
 */

import { movedToV1 } from '@/lib/api/responses'

export async function POST() {
  return movedToV1('/api/v1/connection-profiles', 'action=test-message')
}
