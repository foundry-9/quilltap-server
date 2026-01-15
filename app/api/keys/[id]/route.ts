/**
 * Legacy individual API Key routes - DEPRECATED
 * Moved to /api/v1/api-keys/[id]
 */

import { movedToV1 } from '@/lib/api/responses'

export async function GET() {
  return movedToV1('/api/v1/api-keys/{id}')
}

export async function PUT() {
  return movedToV1('/api/v1/api-keys/{id}')
}

export async function DELETE() {
  return movedToV1('/api/v1/api-keys/{id}')
}
