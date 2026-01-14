/**
 * DEPRECATED - Backup Delete API (Legacy Route)
 * This route has been moved to DELETE /api/v1/system/backup/[id]
 *
 * 410 Gone - Endpoint permanently removed
 */

import { movedToV1 } from '@/lib/api/responses';

/**
 * DELETE - Moved to DELETE /api/v1/system/backup/[id]
 */
export async function DELETE() {
  return movedToV1('/api/v1/system/backup/[id]');
}