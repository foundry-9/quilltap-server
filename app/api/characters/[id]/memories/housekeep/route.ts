/**
 * DEPRECATED: This endpoint has been moved to /api/v1/memories with action=housekeep
 */
import { movedToV1 } from '@/lib/api/responses'

export const GET = () => movedToV1('/api/v1/memories', 'action=housekeep&characterId=[id]')
export const POST = () => movedToV1('/api/v1/memories', 'action=housekeep (characterId in body)')
