/**
 * DEPRECATED - Legacy Route
 * This route has been moved to /api/v1/projects/[id]?action=list-files
 *
 * 410 Gone - Endpoint permanently removed
 */

import { movedToV1 } from '@/lib/api/responses'

export async function GET() {
  return movedToV1('/api/v1/projects/[id]?action=list-files')
}

export async function POST() {
  return movedToV1('/api/v1/projects/[id]?action=add-file')
}

export async function DELETE() {
  return movedToV1('/api/v1/projects/[id]?action=remove-file')
}
