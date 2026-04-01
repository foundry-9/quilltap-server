/**
 * DEPRECATED: This endpoint has been moved to /api/v1/characters
 */
import { movedToV1 } from '@/lib/api/responses'

export const GET = () => movedToV1('/api/v1/characters')
export const POST = () => movedToV1('/api/v1/characters')
