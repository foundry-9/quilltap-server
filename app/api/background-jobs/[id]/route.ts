/**
 * DEPRECATED - Background Jobs by ID API (Legacy Route)
 * This route has been moved to /api/v1/system/jobs/[id]
 *
 * 410 Gone - Endpoint permanently removed
 */

import { movedToV1 } from '@/lib/api/responses';

/**
 * GET - Moved to /api/v1/system/jobs/[id]
 */
export async function GET() {
  return movedToV1('/api/v1/system/jobs/[id]');
}

/**
 * PATCH - Moved to /api/v1/system/jobs/[id]
 */
export async function PATCH() {
  return movedToV1('/api/v1/system/jobs/[id]');
}

/**
 * DELETE - Moved to /api/v1/system/jobs/[id]
 */
export async function DELETE() {
  return movedToV1('/api/v1/system/jobs/[id]');
}