import { movedToV1 } from '@/lib/api/responses';

/**
 * @deprecated Use /api/v1/system/deployment instead
 */
export const GET = () => movedToV1('/api/v1/system/deployment');
