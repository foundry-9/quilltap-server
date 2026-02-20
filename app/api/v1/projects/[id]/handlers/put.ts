/**
 * Projects API v1 - PUT Handler
 *
 * PUT /api/v1/projects/[id] - Update project
 * PUT /api/v1/projects/[id]?action=set-mount-point - Set project mount point
 * PUT /api/v1/projects/[id]?action=set-state - Set project state
 */

import { NextRequest, NextResponse } from 'next/server';
import { getActionParam } from '@/lib/api/middleware/actions';
import { handlePutDefault, handleSetMountPoint, handleSetState } from '../actions';
import type { AuthenticatedContext } from '@/lib/api/middleware';

/**
 * PUT handler for individual project
 */
export async function handlePut(
  req: NextRequest,
  ctx: AuthenticatedContext,
  projectId: string
): Promise<NextResponse> {
  const action = getActionParam(req);

  switch (action) {
    case 'set-mount-point':
      return handleSetMountPoint(req, projectId, ctx);
    case 'set-state':
      return handleSetState(req, projectId, ctx);
    default:
      return handlePutDefault(req, projectId, ctx);
  }
}
