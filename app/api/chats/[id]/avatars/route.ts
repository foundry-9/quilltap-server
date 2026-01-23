/**
 * Legacy Chat Avatar Overrides API Routes (DEPRECATED)
 *
 * This endpoint has been moved to v1:
 * GET  /api/v1/chats/[id]?action=get-avatars
 * POST /api/v1/chats/[id]?action=set-avatar
 * POST /api/v1/chats/[id]?action=remove-avatar (DELETE changed to POST)
 */

import { movedToV1 } from '@/lib/api/responses';

export const GET = () => movedToV1('/api/v1/chats/[id]', 'action=get-avatars');
export const POST = () => movedToV1('/api/v1/chats/[id]', 'action=set-avatar');
export const DELETE = () => movedToV1('/api/v1/chats/[id]', 'action=remove-avatar');
