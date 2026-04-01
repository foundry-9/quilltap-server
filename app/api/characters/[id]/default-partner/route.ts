/**
 * @deprecated Use /api/v1/characters/[id]?action=default-partner and action=set-default-partner instead
 */
import { movedToV1 } from '@/lib/api/responses';

export async function GET() {
  return movedToV1('/api/v1/characters/[id]', 'action=default-partner');
}

export async function PUT() {
  return movedToV1('/api/v1/characters/[id]', 'action=set-default-partner');
}
