/**
 * @deprecated Use /api/v1/characters/[id]?action=toggle-controlled-by instead
 */
import { movedToV1 } from '@/lib/api/responses';

export async function PATCH() {
  return movedToV1('/api/v1/characters/[id]', 'action=toggle-controlled-by');
}
