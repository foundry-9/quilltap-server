/**
 * Legacy Chat Messages API Route (DEPRECATED)
 *
 * This endpoint has been moved to v1:
 * POST /api/v1/chats/[id]/messages - Send a message and get streaming response
 */

import { movedToV1 } from '@/lib/api/responses';

export const POST = () => movedToV1('/api/v1/chats/[id]/messages');
