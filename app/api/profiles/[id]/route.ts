/**
 * Legacy individual Connection Profile routes - DEPRECATED
 * Moved to /api/v1/connection-profiles/[id]
 */

import { movedToV1 } from '@/lib/api/responses'

export async function GET() {
  return movedToV1('/api/v1/connection-profiles/{id}')
}

export async function PUT() {
  return movedToV1('/api/v1/connection-profiles/{id}')
}

export async function DELETE() {
  return movedToV1('/api/v1/connection-profiles/{id}')
}
