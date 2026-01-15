/**
 * @deprecated Use /api/v1/characters/[id]?action=chats instead
 */
import { movedToV1 } from '@/lib/api/responses';

export async function GET() {
  return movedToV1('/api/v1/characters/[id]', 'action=chats');
}
