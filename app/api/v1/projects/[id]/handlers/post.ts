/**
 * Projects API v1 - POST Handler
 *
 * POST /api/v1/projects/[id]?action=add-character - Add character to roster
 * POST /api/v1/projects/[id]?action=add-chat - Associate chat with project
 * POST /api/v1/projects/[id]?action=add-file - Associate file with project
 * POST /api/v1/projects/[id]?action=update-tool-settings - Update default tool settings
 */

import { NextRequest, NextResponse } from 'next/server';
import { getActionParam } from '@/lib/api/middleware/actions';
import { badRequest } from '@/lib/api/responses';
import { handleAddCharacter, handleAddChat, handleAddFile, handleUpdateToolSettings } from '../actions';
import type { AuthenticatedContext } from '@/lib/api/middleware';

/**
 * POST handler for individual project
 */
export async function handlePost(
  req: NextRequest,
  ctx: AuthenticatedContext,
  projectId: string
): Promise<NextResponse> {
  const action = getActionParam(req);

  switch (action) {
    case 'add-character':
      return handleAddCharacter(req, projectId, ctx);
    case 'add-chat':
      return handleAddChat(req, projectId, ctx);
    case 'add-file':
      return handleAddFile(req, projectId, ctx);
    case 'update-tool-settings':
      return handleUpdateToolSettings(req, projectId, ctx);
    default:
      return badRequest('Unknown action or missing action parameter');
  }
}
