/**
 * Projects API v1 - DELETE Handler
 *
 * DELETE /api/v1/projects/[id] - Delete project
 * DELETE /api/v1/projects/[id]?action=remove-character - Remove character from roster
 * DELETE /api/v1/projects/[id]?action=remove-chat - Remove chat from project
 * DELETE /api/v1/projects/[id]?action=remove-file - Remove file from project
 * DELETE /api/v1/projects/[id]?action=reset-state - Reset project state to empty
 */

import { NextRequest, NextResponse } from 'next/server';
import { getActionParam } from '@/lib/api/middleware/actions';
import {
  handleDeleteProject,
  handleRemoveCharacter,
  handleRemoveChat,
  handleRemoveFile,
  handleResetState,
} from '../actions';
import type { AuthenticatedContext } from '@/lib/api/middleware';

/**
 * DELETE handler for individual project
 */
export async function handleDelete(
  req: NextRequest,
  ctx: AuthenticatedContext,
  projectId: string
): Promise<NextResponse> {
  const action = getActionParam(req);

  switch (action) {
    case 'remove-character':
      return handleRemoveCharacter(req, projectId, ctx);
    case 'remove-chat':
      return handleRemoveChat(req, projectId, ctx);
    case 'remove-file':
      return handleRemoveFile(req, projectId, ctx);
    case 'reset-state':
      return handleResetState(projectId, ctx);
    default:
      return handleDeleteProject(projectId, ctx);
  }
}
