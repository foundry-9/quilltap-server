/**
 * Legacy Connection Profile tags routes - DEPRECATED
 * Moved to /api/v1/connection-profiles/[id]?action=add-tag|remove-tag
 */

import { movedToV1 } from '@/lib/api/responses'

export async function GET() {
  return movedToV1('/api/v1/connection-profiles/{id}', 'Tags are included in profile response')
}

export async function POST() {
  return movedToV1('/api/v1/connection-profiles/{id}', 'action=add-tag')
}

export async function DELETE() {
  return movedToV1('/api/v1/connection-profiles/{id}', 'action=remove-tag')
}
