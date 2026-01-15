/**
 * DEPRECATED: This endpoint has been moved to /api/v1/files/folders
 * Note: Actions are now POST with action param
 */

import { movedToV1 } from '@/lib/api/responses';

export const GET = () => movedToV1('/api/v1/files/folders');
export const POST = () => movedToV1('/api/v1/files/folders');
export const PATCH = () => movedToV1('/api/v1/files/folders');
export const DELETE = () => movedToV1('/api/v1/files/folders');
