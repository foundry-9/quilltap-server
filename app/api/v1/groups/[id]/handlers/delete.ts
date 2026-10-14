/**
 * Groups API v1 - DELETE Handler
 *
 * DELETE /api/v1/groups/[id] - Delete group
 * DELETE /api/v1/groups/[id]?action=removeMember - Remove character from group
 */

import { NextRequest, NextResponse } from 'next/server';
import { dispatchAction } from '@/lib/api/middleware/actions';
import {
  handleDeleteGroup,
  handleRemoveMember,
  handleResetState,
} from '../actions';
import type { RequestContext } from '@/lib/api/middleware';


/**
 * DELETE handler for individual group
 */
export async function handleDelete(
  req: NextRequest,
  ctx: RequestContext,
  groupId: string
): Promise<NextResponse> {
  // The fallback deletes the whole group, so an unknown action must be a 400
  // rather than falling through to it — `dispatchAction` guarantees that.
  return dispatchAction(
    req,
    {
      removeMember: () => handleRemoveMember(req, groupId, ctx),
      'reset-state': () => handleResetState(groupId, ctx),
    },
    () => handleDeleteGroup(groupId, ctx)
  );
}
