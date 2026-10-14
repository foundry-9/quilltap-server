/**
 * Groups API v1 - Individual Group Endpoint
 *
 * GET /api/v1/groups/[id] - Get group details
 * PUT /api/v1/groups/[id] - Update group
 * DELETE /api/v1/groups/[id] - Delete group
 *
 * Actions:
 * GET /api/v1/groups/[id]?action=members - List member characters
 * POST /api/v1/groups/[id]?action=addMember - Add character to group
 * DELETE /api/v1/groups/[id]?action=removeMember - Remove character from group
 * GET /api/v1/groups/[id]?action=get-state - Get group state
 * PUT /api/v1/groups/[id]?action=set-state - Set group state
 * DELETE /api/v1/groups/[id]?action=reset-state - Reset group state to empty
 *
 * Linked document stores live under /api/v1/groups/[id]/mount-points.
 */

import { createContextParamsHandler } from '@/lib/api/middleware';
import { handleGet, handlePut, handleDelete, handlePost } from './handlers';

export const GET = createContextParamsHandler<{ id: string }>(
  (req, ctx, { id }) => handleGet(req, ctx, id)
);

export const PUT = createContextParamsHandler<{ id: string }>(
  (req, ctx, { id }) => handlePut(req, ctx, id)
);

export const DELETE = createContextParamsHandler<{ id: string }>(
  (req, ctx, { id }) => handleDelete(req, ctx, id)
);

export const POST = createContextParamsHandler<{ id: string }>(
  (req, ctx, { id }) => handlePost(req, ctx, id)
);
