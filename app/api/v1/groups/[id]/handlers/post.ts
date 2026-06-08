/**
 * Groups API v1 - POST Handler
 *
 * POST /api/v1/groups/[id]?action=addMember - Add character to group
 * POST /api/v1/groups/[id]?action=linkStore - Link document store to group
 */

import { NextRequest, NextResponse } from 'next/server';
import { getActionParam, isValidAction } from '@/lib/api/middleware/actions';
import { badRequest } from '@/lib/api/responses';
import { handleAddMember, handleLinkStore } from '../actions';
import type { AuthenticatedContext } from '@/lib/api/middleware';

const GROUP_POST_ACTIONS = ['addMember', 'linkStore'] as const;
type GroupPostAction = typeof GROUP_POST_ACTIONS[number];

/**
 * POST handler for individual group
 */
export async function handlePost(
  req: NextRequest,
  ctx: AuthenticatedContext,
  groupId: string
): Promise<NextResponse> {
  const action = getActionParam(req);

  if (!isValidAction(action, GROUP_POST_ACTIONS)) {
    return badRequest('Unknown action or missing action parameter');
  }

  const actionHandlers: Record<GroupPostAction, () => Promise<NextResponse>> = {
    addMember: () => handleAddMember(req, groupId, ctx),
    linkStore: () => handleLinkStore(req, groupId, ctx),
  };

  return actionHandlers[action]();
}
