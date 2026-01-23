/**
 * DEPRECATED: This endpoint has been moved to /api/v1/chats/[id]
 */
import { movedToV1 } from '@/lib/api/responses';

export const GET = () => movedToV1('/api/v1/chats/[id]');
export const PUT = () => movedToV1('/api/v1/chats/[id]');
export const DELETE = () => movedToV1('/api/v1/chats/[id]');
