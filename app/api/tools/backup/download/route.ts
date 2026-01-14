/**
 * DEPRECATED - Backup Download API (Legacy Route)
 * This route has been moved to /api/v1/system/backup/[id]?action=download
 *
 * 410 Gone - Endpoint permanently removed
 */

import { movedToV1 } from '@/lib/api/responses';

/**
 * GET - Moved to /api/v1/system/backup/[id]?action=download
 */
export async function GET() {
  return movedToV1('/api/v1/system/backup/[id]', 'action=download');
}