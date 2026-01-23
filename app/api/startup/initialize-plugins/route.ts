import { movedToV1 } from '@/lib/api/responses';

/**
 * @deprecated Use /api/v1/system/plugins/initialize instead
 */
export const GET = () => movedToV1('/api/v1/system/plugins/initialize');
export const POST = () => movedToV1('/api/v1/system/plugins/initialize');
