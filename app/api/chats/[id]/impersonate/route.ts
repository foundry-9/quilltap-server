/**
 * DEPRECATED: This endpoint has been moved to /api/v1/chats/[id] with action dispatch
 */
import { movedToV1 } from '@/lib/api/responses';

export const POST = () => movedToV1('/api/v1/chats/[id]', 'action=impersonate or action=stop-impersonate');
