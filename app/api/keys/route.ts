/**
 * Legacy API Keys routes - DEPRECATED
 * Moved to /api/v1/api-keys
 */

import { movedToV1 } from '@/lib/api/responses'

export async function GET() {
  return movedToV1('/api/v1/api-keys')
}

export async function POST() {
  return movedToV1('/api/v1/api-keys')
}
