/**
 * Files API v1 - Collection Endpoint
 *
 * GET /api/v1/files - List files (filter by projectId, folderPath, or filter=general)
 * POST /api/v1/files?action=write - Write/create a file from text content
 * POST /api/v1/files?action=upload - Upload a file (multipart/form-data)
 */

import { createAuthenticatedHandler } from '@/lib/api/middleware';
import { handleGet, handlePost } from './handlers';

export const GET = createAuthenticatedHandler(handleGet);
export const POST = createAuthenticatedHandler(handlePost);
