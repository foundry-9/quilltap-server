/**
 * Legacy Chat Files API Route (DEPRECATED)
 *
 * This endpoint has been moved to v1:
 * POST /api/v1/chats/[id]/files - Upload a file for a chat
 * GET  /api/v1/chats/[id]/files - List files for a chat
 */

import { movedToV1 } from '@/lib/api/responses';

export const POST = () => movedToV1('/api/v1/chats/[id]/files');
export const GET = () => movedToV1('/api/v1/chats/[id]/files');
