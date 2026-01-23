/**
 * DEPRECATED: This endpoint has been moved to /api/v1/chats/[id]?action=regenerate-title
 */
import { movedToV1 } from '@/lib/api/responses';

export const POST = () => movedToV1('/api/v1/chats/[id]', 'action=regenerate-title');
