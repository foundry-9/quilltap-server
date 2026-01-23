/**
 * Search and Replace Execute API (DEPRECATED)
 *
 * This route has been moved to /api/v1/search-replace?action=execute
 * @deprecated Use /api/v1/search-replace?action=execute instead - will be removed after 2026-04-15
 */

import { movedToV1 } from '@/lib/api/responses';

export async function POST() {
  return movedToV1('/api/v1/search-replace', 'action=execute');
}
