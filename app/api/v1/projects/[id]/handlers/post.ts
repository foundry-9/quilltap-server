/**
 * Projects API v1 - POST Handler
 *
 * POST /api/v1/projects/[id]?action=add-character - Add character to roster
 * POST /api/v1/projects/[id]?action=add-chat - Associate chat with project
 * POST /api/v1/projects/[id]?action=add-file - Associate file with project
 * POST /api/v1/projects/[id]?action=update-tool-settings - Update default tool settings
 */

import { NextRequest, NextResponse } from 'next/server';
import { dispatchAction } from '@/lib/api/middleware/actions';
import { handleAddCharacter, handleAddChat, handleAddFile, handleUpdateToolSettings } from '../actions';
import type { RequestContext } from '@/lib/api/middleware';


/**
 * POST handler for individual project
 */
export async function handlePost(
  req: NextRequest,
  ctx: RequestContext,
  projectId: string
): Promise<NextResponse> {
  return dispatchAction(req, {
    'add-character': () => handleAddCharacter(req, projectId, ctx),
    'add-chat': () => handleAddChat(req, projectId, ctx),
    'add-file': () => handleAddFile(req, projectId, ctx),
    'update-tool-settings': () => handleUpdateToolSettings(req, projectId, ctx),
  });
}
