/**
 * Theme API Routes (DEPRECATED)
 *
 * This route has been moved to /api/v1/themes
 * @deprecated Use /api/v1/themes instead - will be removed after 2026-04-15
 */

import { movedToV1 } from '@/lib/api/responses';

export async function GET() {
  return movedToV1('/api/v1/themes');
}
