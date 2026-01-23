/**
 * DEPRECATED: This endpoint has been moved to /api/v1/memories with messageId query param
 */
import { movedToV1 } from '@/lib/api/responses'

export const GET = () => movedToV1('/api/v1/memories', 'messageId query param')
