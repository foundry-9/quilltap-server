/**
 * Legacy Queue Memory Analysis API Route (DEPRECATED)
 *
 * This endpoint has been moved to v1:
 * POST /api/v1/chats/[id]?action=queue-memories - Queue memory extraction jobs
 */

import { movedToV1 } from '@/lib/api/responses';

export const POST = () => movedToV1('/api/v1/chats/[id]', 'action=queue-memories');
