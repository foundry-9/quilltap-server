/**
 * DEPRECATED: This endpoint has been moved to /api/v1/memories with chatId query parameter
 */
import { movedToV1 } from '@/lib/api/responses';

export const GET = () => movedToV1('/api/v1/memories', 'chatId=[id] query param');
export const DELETE = () => movedToV1('/api/v1/memories', 'chatId=[id] query param (DELETE)');
