/**
 * DEPRECATED: This endpoint has been moved to /api/v1/memories/[memoryId]
 */
import { movedToV1 } from '@/lib/api/responses'

export const GET = () => movedToV1('/api/v1/memories/[memoryId]')
export const PUT = () => movedToV1('/api/v1/memories/[memoryId]')
export const DELETE = () => movedToV1('/api/v1/memories/[memoryId]')
