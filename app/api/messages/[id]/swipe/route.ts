/**
 * DEPRECATED: This endpoint has been moved to /api/v1/messages/[id] with action=swipe
 */
import { movedToV1 } from '@/lib/api/responses'

export const POST = () => movedToV1('/api/v1/messages/[id]', 'action=swipe')
export const PUT = () => movedToV1('/api/v1/messages/[id]', 'action=swipe')
