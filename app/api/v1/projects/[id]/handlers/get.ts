/**
 * Projects API v1 - GET Handler
 *
 * GET /api/v1/projects/[id] - Get project details
 * GET /api/v1/projects/[id]?action=list-characters - List character roster
 * GET /api/v1/projects/[id]?action=list-chats - List project chats
 * GET /api/v1/projects/[id]?action=list-files - List project files
 * GET /api/v1/projects/[id]?action=get-state - Get project state
 * GET /api/v1/projects/[id]?action=get-background - Get project story background URL
 */

import { NextRequest, NextResponse } from 'next/server';
import { getActionParam } from '@/lib/api/middleware/actions';
import {
  handleGetDefault,
  handleListCharacters,
  handleListChats,
  handleListFiles,
  handleGetState,
  handleGetBackground,
} from '../actions';
import type { AuthenticatedContext } from '@/lib/api/middleware';

/**
 * GET handler for individual project
 */
export async function handleGet(
  req: NextRequest,
  ctx: AuthenticatedContext,
  projectId: string
): Promise<NextResponse> {
  const action = getActionParam(req);

  switch (action) {
    case 'list-characters':
      return handleListCharacters(projectId, ctx);
    case 'list-chats':
      return handleListChats(req, projectId, ctx);
    case 'list-files':
      return handleListFiles(projectId, ctx);
    case 'get-state':
      return handleGetState(projectId, ctx);
    case 'get-background':
      return handleGetBackground(projectId, ctx);
    default:
      return handleGetDefault(projectId, ctx);
  }
}
