/**
 * DEPRECATED: This endpoint has been moved to /api/v1/characters/[id] with PUT method
 */
import { movedToV1 } from '@/lib/api/responses'

export const PUT = () => movedToV1('/api/v1/characters/[id]')
