/**
 * @deprecated Use /api/v1/characters/[id]?action=personas, action=link-persona, action=unlink-persona instead
 */
import { movedToV1 } from '@/lib/api/responses';

export async function GET() {
  return movedToV1('/api/v1/characters/[id]', 'action=personas');
}

export async function POST() {
  return movedToV1('/api/v1/characters/[id]', 'action=link-persona');
}

export async function DELETE() {
  return movedToV1('/api/v1/characters/[id]', 'action=unlink-persona');
}
