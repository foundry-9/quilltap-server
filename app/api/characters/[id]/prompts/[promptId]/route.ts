/**
 * @deprecated Use /api/v1/characters/[id]/prompts/[promptId] instead
 */
import { movedToV1 } from '@/lib/api/responses';

export async function GET() {
  return movedToV1('/api/v1/characters/[id]/prompts/[promptId]');
}

export async function PUT() {
  return movedToV1('/api/v1/characters/[id]/prompts/[promptId]');
}

export async function DELETE() {
  return movedToV1('/api/v1/characters/[id]/prompts/[promptId]');
}
