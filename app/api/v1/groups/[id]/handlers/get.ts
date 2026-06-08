/**
 * Groups API v1 - GET Handler
 *
 * GET /api/v1/groups/[id] - Get group details
 * GET /api/v1/groups/[id]?action=members - List member characters
 * GET /api/v1/groups/[id]?action=stores - List linked document stores
 */

import { NextRequest, NextResponse } from 'next/server';
import { getActionParam, isValidAction } from '@/lib/api/middleware/actions';
import {
  handleGetDefault,
  handleGetMembers,
  handleGetStores,
} from '../actions';
import type { AuthenticatedContext } from '@/lib/api/middleware';

const GROUP_GET_ACTIONS = ['members', 'stores'] as const;
type GroupGetAction = typeof GROUP_GET_ACTIONS[number];

/**
 * GET handler for individual group
 */
export async function handleGet(
  req: NextRequest,
  ctx: AuthenticatedContext,
  groupId: string
): Promise<NextResponse> {
  const action = getActionParam(req);

  if (!action || !isValidAction(action, GROUP_GET_ACTIONS)) {
    return handleGetDefault(groupId, ctx);
  }

  const actionHandlers: Record<GroupGetAction, () => Promise<NextResponse>> = {
    members: () => handleGetMembers(groupId, ctx),
    stores: () => handleGetStores(groupId, ctx),
  };

  return actionHandlers[action]();
}
