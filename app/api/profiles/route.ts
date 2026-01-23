/**
 * Legacy Connection Profile routes - DEPRECATED
 * Moved to /api/v1/connection-profiles
 */

import { movedToV1 } from '@/lib/api/responses'

export async function GET() {
  return movedToV1('/api/v1/connection-profiles')
}

export async function POST() {
  return movedToV1('/api/v1/connection-profiles')
}
