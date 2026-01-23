/**
 * DEPRECATED: This endpoint has been moved to /api/v1/messages/[id] with action=reattribute
 */
import { movedToV1 } from '@/lib/api/responses'

export const POST = () => movedToV1('/api/v1/messages/[id]', 'action=reattribute')
