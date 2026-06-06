/**
 * Project Wardrobe — item detail endpoint.
 *
 * GET    /api/v1/projects/[id]/wardrobe/[itemId] — fetch one project wardrobe item.
 * PUT    /api/v1/projects/[id]/wardrobe/[itemId] — update one project wardrobe item.
 * DELETE /api/v1/projects/[id]/wardrobe/[itemId] — delete one project wardrobe item.
 *
 * @module app/api/v1/projects/[id]/wardrobe/[itemId]
 */

import { NextRequest, NextResponse } from 'next/server';
import { createAuthenticatedParamsHandler } from '@/lib/api/middleware';
import type { RequestContext } from '@/lib/api/middleware/auth';
import { z } from 'zod';
import { logger } from '@/lib/logger';
import { badRequest, notFound, serverError } from '@/lib/api/responses';
import { ensureProjectOfficialStore } from '@/lib/mount-index/ensure-project-store';
import { readProjectWardrobe } from '@/lib/mount-index/project-wardrobe';
import {
  updateProjectWardrobeItem,
  deleteProjectWardrobeItem,
} from '@/lib/database/repositories/vault-overlay/wardrobe-writes';
import { WardrobeItemTypeEnum } from '@/lib/schemas/wardrobe.types';

const updateWardrobeSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  types: z.array(WardrobeItemTypeEnum).min(1).optional(),
  appropriateness: z.string().nullable().optional(),
  isDefault: z.boolean().optional(),
  /** Replace this item's composite components (use `[]` to demote to a leaf). */
  componentItemIds: z.array(z.string()).optional(),
  /** Composite-only: clear the designated slots on equip instead of layering. */
  replace: z.boolean().optional(),
});

/** Resolve the project's official store mount, or null when unavailable. */
async function resolveProjectMount(
  repos: RequestContext['repos'],
  projectId: string,
): Promise<string | null> {
  const project = await repos.projects.findById(projectId);
  if (!project) return null;
  const ensured = await ensureProjectOfficialStore(project.id, project.name);
  return ensured?.mountPointId ?? null;
}

// ============================================================================
// GET — fetch one item
// ============================================================================

export const GET = createAuthenticatedParamsHandler<{ id: string; itemId: string }>(
  async (_req: NextRequest, { repos }: RequestContext, { id, itemId }) => {
    try {
      const mountPointId = await resolveProjectMount(repos, id);
      if (!mountPointId) return notFound('Project');

      const items = await readProjectWardrobe(mountPointId, true);
      const item = items.find((i) => i.id === itemId);
      if (!item) return notFound('Project wardrobe item');

      return NextResponse.json({ wardrobeItem: item });
    } catch (error) {
      logger.error(
        '[Projects v1] Error fetching project wardrobe item',
        { projectId: id, itemId, context: 'wardrobe' },
        error instanceof Error ? error : undefined,
      );
      return serverError('Failed to fetch project wardrobe item');
    }
  },
);

// ============================================================================
// PUT — update one item
// ============================================================================

export const PUT = createAuthenticatedParamsHandler<{ id: string; itemId: string }>(
  async (req: NextRequest, { user, repos }: RequestContext, { id, itemId }) => {
    try {
      const mountPointId = await resolveProjectMount(repos, id);
      if (!mountPointId) return notFound('Project');

      const body = await req.json();
      const validated = updateWardrobeSchema.parse(body);

      const item = await updateProjectWardrobeItem(mountPointId, itemId, validated);
      if (!item) return notFound('Project wardrobe item');

      logger.info('[Projects v1] Updated project wardrobe item', {
        projectId: id,
        userId: user.id,
        mountPointId,
        itemId,
        context: 'wardrobe',
      });

      return NextResponse.json({ wardrobeItem: item });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return badRequest(`Invalid request body: ${error.issues.map((i) => i.message).join('; ')}`);
      }
      if (error instanceof Error && error.message.includes('component cycle')) {
        return badRequest(error.message);
      }
      logger.error(
        '[Projects v1] Error updating project wardrobe item',
        { projectId: id, itemId, context: 'wardrobe' },
        error instanceof Error ? error : undefined,
      );
      return serverError('Failed to update project wardrobe item');
    }
  },
);

// ============================================================================
// DELETE — delete one item
// ============================================================================

export const DELETE = createAuthenticatedParamsHandler<{ id: string; itemId: string }>(
  async (_req: NextRequest, { repos }: RequestContext, { id, itemId }) => {
    try {
      const mountPointId = await resolveProjectMount(repos, id);
      if (!mountPointId) return notFound('Project');

      // Clean up equipped references before deleting. Composite items may still
      // reference this id in `componentItemIds`, but `expandComposites` tolerates
      // unknown ids, so dangling references are harmless.
      try {
        await repos.chats.removeEquippedItemFromAllChats(itemId);
      } catch (cleanupError) {
        logger.warn('[Projects v1] Cleanup of equipped references had issues, proceeding with delete', {
          projectId: id,
          itemId,
          context: 'wardrobe',
          cleanupError: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
        });
      }

      const success = await deleteProjectWardrobeItem(mountPointId, itemId);
      if (!success) return notFound('Project wardrobe item');

      logger.info('[Projects v1] Deleted project wardrobe item', {
        projectId: id,
        mountPointId,
        itemId,
        context: 'wardrobe',
      });

      return NextResponse.json({ success: true });
    } catch (error) {
      logger.error(
        '[Projects v1] Error deleting project wardrobe item',
        { projectId: id, itemId, context: 'wardrobe' },
        error instanceof Error ? error : undefined,
      );
      return serverError('Failed to delete project wardrobe item');
    }
  },
);
