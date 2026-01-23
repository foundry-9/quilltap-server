/**
 * DEPRECATED - Legacy Route
 * This route has been moved to /api/v1/projects/[id] with action=get-mount-point, action=set-mount-point
 *
 * 410 Gone - Endpoint permanently removed
 */

import { movedToV1 } from '@/lib/api/responses'

export async function GET() {
  return movedToV1('/api/v1/projects/[id]?action=get-mount-point')
}

export async function PUT() {
  return movedToV1('/api/v1/projects/[id]?action=set-mount-point')
}

export async function DELETE() {
  return movedToV1('/api/v1/projects/[id]?action=clear-mount-point')
}
