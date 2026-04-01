/**
 * DEPRECATED: This endpoint has been moved to /api/v1/chats/[id] with action dispatch
 */
import { movedToV1 } from '@/lib/api/responses';

export const POST = () => movedToV1('/api/v1/chats/[id]', 'action=add-participant');
export const PUT = () => movedToV1('/api/v1/chats/[id]', 'action=update-participant');
export const DELETE = () => movedToV1('/api/v1/chats/[id]', 'action=remove-participant');
