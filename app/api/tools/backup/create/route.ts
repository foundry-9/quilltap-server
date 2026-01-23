/**
 * DEPRECATED - Backup Create API (Legacy Route)
 * This route has been moved to /api/v1/system/backup?action=create
 *
 * 410 Gone - Endpoint permanently removed
 */

import { movedToV1 } from '@/lib/api/responses';

/**
 * POST - Moved to /api/v1/system/backup?action=create
 */
export async function POST() {
  return movedToV1('/api/v1/system/backup', 'action=create');
}