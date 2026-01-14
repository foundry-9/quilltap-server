/**
 * Chat Settings Management Routes
 *
 * DEPRECATED: This endpoint has been moved to /api/v1/settings/chat
 */

import { movedToV1 } from '@/lib/api/responses'

export const GET = () => movedToV1('/api/v1/settings/chat')
export const POST = () => movedToV1('/api/v1/settings/chat')
export const PUT = () => movedToV1('/api/v1/settings/chat')

