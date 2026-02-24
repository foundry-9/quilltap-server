/**
 * Projects API v1 - Tool Settings Actions
 *
 * POST /api/v1/projects/[id]?action=update-tool-settings - Update default tool settings
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { checkOwnership } from '@/lib/api/middleware';
import { logger } from '@/lib/logger';
import { notFound, validationError, serverError, successResponse } from '@/lib/api/responses';
import { updateToolSettingsSchema } from '../schemas';
import type { AuthenticatedContext } from '@/lib/api/middleware';

/**
 * Update default tool settings for project
 */
export async function handleUpdateToolSettings(
  req: NextRequest,
  projectId: string,
  { user, repos }: AuthenticatedContext
): Promise<NextResponse> {
  try {
    const project = await repos.projects.findById(projectId);
    if (!checkOwnership(project, user.id)) {
      return notFound('Project');
    }

    const body = await req.json();
    const { defaultDisabledTools, defaultDisabledToolGroups } = updateToolSettingsSchema.parse(body);

    // Update project with new default tool settings
    await repos.projects.update(projectId, {
      defaultDisabledTools,
      defaultDisabledToolGroups,
    });

    logger.info('[Projects v1] Default tool settings updated', {
      projectId,
      disabledToolsCount: defaultDisabledTools.length,
      disabledGroupsCount: defaultDisabledToolGroups.length,
    });

    return successResponse({
      success: true,
      defaultDisabledTools,
      defaultDisabledToolGroups,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return validationError(error);
    }

    logger.error('[Projects v1] Error updating tool settings', { projectId }, error instanceof Error ? error : undefined);
    return serverError('Failed to update tool settings');
  }
}
