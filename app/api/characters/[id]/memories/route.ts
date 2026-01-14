/**
 * DEPRECATED: This endpoint has been moved to /api/v1/memories
 */
import { movedToV1 } from '@/lib/api/responses'

export const GET = () => movedToV1('/api/v1/memories', 'characterId=[id] query param')
export const POST = () => movedToV1('/api/v1/memories')
