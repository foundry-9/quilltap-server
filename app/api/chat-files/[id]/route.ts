/**
 * Chat File API Routes (DEPRECATED)
 *
 * POST has been moved to /api/v1/chat-files/[id]?action=tag
 * DELETE has been moved to /api/v1/chat-files/[id]
 * @deprecated Use /api/v1/chat-files/[id] instead - will be removed after 2026-04-15
 */

import { movedToV1 } from '@/lib/api/responses';

export async function POST() {
  return movedToV1('/api/v1/chat-files/[id]', 'action=tag');
}

export async function DELETE() {
  return movedToV1('/api/v1/chat-files/[id]');
}
