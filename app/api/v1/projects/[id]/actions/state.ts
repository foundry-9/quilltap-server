/**
 * Projects API v1 - State Actions
 *
 * GET /api/v1/projects/[id]?action=get-state - Get project state
 * PUT /api/v1/projects/[id]?action=set-state - Set project state
 * DELETE /api/v1/projects/[id]?action=reset-state - Reset project state to empty
 */

import { NextRequest, NextResponse } from 'next/server';
import { checkOwnership } from '@/lib/api/middleware';
import { logger } from '@/lib/logger';
import { notFound, successResponse } from '@/lib/api/responses';
import { setStateSchema } from '../schemas';
import type { AuthenticatedContext } from '@/lib/api/middleware';

/**
 * Get project state
 */
export async function handleGetState(
  projectId: string,
  { user, repos }: AuthenticatedContext
): Promise<NextResponse> {
  const project = await repos.projects.findById(projectId);
  if (!checkOwnership(project, user.id)) {
    return notFound('Project');
  }

  const projectState = (project.state || {}) as Record<string, unknown>;

  return successResponse({
    success: true,
    state: projectState,
  });
}

/**
 * Set project state (replaces entire state object)
 */
export async function handleSetState(
  req: NextRequest,
  projectId: string,
  { user, repos }: AuthenticatedContext
): Promise<NextResponse> {
  const project = await repos.projects.findById(projectId);
  if (!checkOwnership(project, user.id)) {
    return notFound('Project');
  }

  const body = await req.json();
  const validated = setStateSchema.parse(body);

  // Update state
  const updatedProject = await repos.projects.update(projectId, {
    state: validated.state,
  });

  logger.info('[Projects v1] State updated', {
    projectId,
    userId: user.id,
    stateKeys: Object.keys(validated.state),
  });

  return successResponse({
    success: true,
    state: updatedProject?.state || validated.state,
  });
}

/**
 * Reset project state to empty object
 */
export async function handleResetState(
  projectId: string,
  { user, repos }: AuthenticatedContext
): Promise<NextResponse> {
  const project = await repos.projects.findById(projectId);
  if (!checkOwnership(project, user.id)) {
    return notFound('Project');
  }

  const previousState = (project.state || {}) as Record<string, unknown>;

  // Reset to empty object
  await repos.projects.update(projectId, {
    state: {},
  });

  logger.info('[Projects v1] State reset', {
    projectId,
    userId: user.id,
  });

  return successResponse({
    success: true,
    previousState,
  });
}
