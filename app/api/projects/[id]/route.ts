/**
 * DEPRECATED - Legacy Route
 * This route has been moved to /api/v1/projects/[id]
 *
 * 410 Gone - Endpoint permanently removed
 */

import { movedToV1 } from '@/lib/api/responses'

export async function GET() {
  return movedToV1('/api/v1/projects/[id]')
}

export async function PUT() {
  return movedToV1('/api/v1/projects/[id]')
}

export async function DELETE() {
  return movedToV1('/api/v1/projects/[id]')
}

export async function PATCH() {
  return movedToV1('/api/v1/projects/[id]')
}
