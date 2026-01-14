/**
 * DEPRECATED: This endpoint has been moved to /api/v1/characters/[id]
 */
import { movedToV1 } from '@/lib/api/responses'

export const GET = () => movedToV1('/api/v1/characters/[id]')
export const PUT = () => movedToV1('/api/v1/characters/[id]')
export const DELETE = () => movedToV1('/api/v1/characters/[id]')
