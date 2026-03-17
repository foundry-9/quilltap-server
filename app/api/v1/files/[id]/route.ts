/**
 * Files API v1 - Individual File Endpoint
 *
 * GET /api/v1/files/[id] - Download a file
 * DELETE /api/v1/files/[id] - Delete a file
 * POST /api/v1/files/[id]?action=move - Move file to new folder/project
 * POST /api/v1/files/[id]?action=promote - Promote attachment to general/project files
 * GET /api/v1/files/[id]?action=thumbnail - Get thumbnail for image
 */

import { createAuthenticatedParamsHandler } from '@/lib/api/middleware';
import { handleDelete, handleGet, handlePost } from './handlers';

export const GET = createAuthenticatedParamsHandler<{ id: string }>(
  (req, ctx, { id }) => handleGet(req, ctx, id)
);

export const DELETE = createAuthenticatedParamsHandler<{ id: string }>(
  (req, ctx, { id }) => handleDelete(req, ctx, id)
);

export const POST = createAuthenticatedParamsHandler<{ id: string }>(
  (req, ctx, { id }) => handlePost(req, ctx, id)
);
