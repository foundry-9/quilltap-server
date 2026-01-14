/**
 * DEPRECATED: This endpoint has been moved to /api/v1/memories with action=embeddings
 */
import { movedToV1 } from '@/lib/api/responses'

export const GET = () => movedToV1('/api/v1/memories', 'action=embeddings&characterId=[id]')
export const POST = () => movedToV1('/api/v1/memories', 'action=embeddings (characterId in body)')
export const PUT = () => movedToV1('/api/v1/memories', 'action=embeddings (rebuild, characterId in body)')
