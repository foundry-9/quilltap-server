/**
 * DEPRECATED - Legacy Route
 * This route has been moved to /api/v1/projects/[id]?action=list-characters
 *
 * 410 Gone - Endpoint permanently removed
 */

import { movedToV1 } from '@/lib/api/responses'

export async function GET() {
  return movedToV1('/api/v1/projects/[id]?action=list-characters')
}

export async function POST() {
  return movedToV1('/api/v1/projects/[id]?action=add-character')
}

export async function DELETE() {
  return movedToV1('/api/v1/projects/[id]?action=remove-character')
}
