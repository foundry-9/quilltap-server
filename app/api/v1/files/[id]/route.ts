/**
 * Files API v1 - Individual File Endpoint
 *
 * GET /api/v1/files/[id] - Download a file
 * DELETE /api/v1/files/[id] - Delete a file
 * POST /api/v1/files/[id]?action=move - Move file to new folder/project
 * POST /api/v1/files/[id]?action=promote - Promote attachment to general/project files
 * GET /api/v1/files/[id]?action=thumbnail - Get thumbnail for image
 */

import { createContextParamsHandler } from '@/lib/api/middleware';
import { withActionDispatch } from '@/lib/api/middleware/actions';
import { handleDelete, handleGet, handlePost } from './handlers';

export const GET = createContextParamsHandler<{ id: string }>(
  (req, ctx, { id }) => handleGet(req, ctx, id)
);

// No actions on DELETE: an unknown `?action=` is a 400, never a deletion.
export const DELETE = createContextParamsHandler<{ id: string }>(
  withActionDispatch<{ id: string }>({}, (req, ctx, { id }) => handleDelete(req, ctx, id))
);

export const POST = createContextParamsHandler<{ id: string }>(
  (req, ctx, { id }) => handlePost(req, ctx, id)
);
