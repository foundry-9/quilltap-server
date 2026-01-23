/**
 * DEPRECATED: This endpoint has been moved to /api/v1/chats/[id]?action=turn
 */
import { movedToV1 } from '@/lib/api/responses';

export const POST = () => movedToV1('/api/v1/chats/[id]', 'action=turn');
export const PATCH = () => movedToV1('/api/v1/chats/[id]', 'action=turn (PATCH for persist)');
