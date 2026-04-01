/**
 * DEPRECATED - Background Jobs API (Legacy Route)
 * This route has been moved to /api/v1/system/jobs
 *
 * 410 Gone - Endpoint permanently removed
 */

import { movedToV1 } from '@/lib/api/responses';

/**
 * GET - Moved to /api/v1/system/jobs
 */
export async function GET() {
  return movedToV1('/api/v1/system/jobs');
}

/**
 * POST - Moved to /api/v1/system/jobs
 */
export async function POST() {
  return movedToV1('/api/v1/system/jobs');
}