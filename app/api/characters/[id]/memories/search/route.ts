/**
 * DEPRECATED: This endpoint has been moved to /api/v1/memories with action=search
 */
import { movedToV1 } from '@/lib/api/responses'

export const POST = () => movedToV1('/api/v1/memories', 'action=search (characterId in body)')
