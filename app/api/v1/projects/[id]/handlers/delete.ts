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
import { dispatchAction } from '@/lib/api/middleware/actions';
import {
  handleDeleteProject,
  handleRemoveCharacter,
  handleRemoveChat,
  handleRemoveFile,
  handleResetState,
} from '../actions';
import type { RequestContext } from '@/lib/api/middleware';


/**
 * DELETE handler for individual project
 */
export async function handleDelete(
  req: NextRequest,
  ctx: RequestContext,
  projectId: string
): Promise<NextResponse> {
  // The fallback deletes the whole project, so an unknown action must be a 400
  // rather than falling through to it — `dispatchAction` guarantees that.
  return dispatchAction(
    req,
    {
      'remove-character': () => handleRemoveCharacter(req, projectId, ctx),
      'remove-chat': () => handleRemoveChat(req, projectId, ctx),
      'remove-file': () => handleRemoveFile(req, projectId, ctx),
      'reset-state': () => handleResetState(projectId, ctx),
    },
    () => handleDeleteProject(projectId, ctx)
  );
}
