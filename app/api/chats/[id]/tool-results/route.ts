/**
 * Legacy Chat Tool Results API Route (DEPRECATED)
 *
 * This endpoint has been moved to v1:
 * POST /api/v1/chats/[id]?action=add-tool-result - Add a tool result message
 */

import { movedToV1 } from '@/lib/api/responses';

export const POST = () => movedToV1('/api/v1/chats/[id]', 'action=add-tool-result');
