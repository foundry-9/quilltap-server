/**
 * Groups API v1 - DELETE Handler
 *
 * DELETE /api/v1/groups/[id] - Delete group
 * DELETE /api/v1/groups/[id]?action=removeMember - Remove character from group
 * DELETE /api/v1/groups/[id]?action=unlinkStore - Unlink document store from group
 */

import { NextRequest, NextResponse } from 'next/server';
import { getActionParam, isValidAction } from '@/lib/api/middleware/actions';
import {
  handleDeleteGroup,
  handleRemoveMember,
  handleUnlinkStore,
} from '../actions';
import type { AuthenticatedContext } from '@/lib/api/middleware';

const GROUP_DELETE_ACTIONS = ['removeMember', 'unlinkStore'] as const;
type GroupDeleteAction = typeof GROUP_DELETE_ACTIONS[number];

/**
 * DELETE handler for individual group
 */
export async function handleDelete(
  req: NextRequest,
  ctx: AuthenticatedContext,
  groupId: string
): Promise<NextResponse> {
  const action = getActionParam(req);

  if (!action || !isValidAction(action, GROUP_DELETE_ACTIONS)) {
    return handleDeleteGroup(groupId, ctx);
  }

  const actionHandlers: Record<GroupDeleteAction, () => Promise<NextResponse>> = {
    removeMember: () => handleRemoveMember(req, groupId, ctx),
    unlinkStore: () => handleUnlinkStore(req, groupId, ctx),
  };

  return actionHandlers[action]();
}
