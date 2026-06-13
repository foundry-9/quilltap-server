/**
 * Project Wardrobe — collection endpoint.
 *
 * GET  /api/v1/projects/[id]/wardrobe          — list every wardrobe item in the
 *                                                 project's `Wardrobe/` folder.
 * POST /api/v1/projects/[id]/wardrobe          — create a new project wardrobe
 *                                                 item. Body: { title, description?,
 *                                                 types, appropriateness?, isDefault?,
 *                                                 componentItemIds?, replace? }.
 *
 * Project wardrobe is the project tier of the tri-tier wardrobe model (character
 * vault + project stores + Quilltap General), mirroring project scenarios. Both
 * routes ensure the project's official store and its `Wardrobe/` folder first so
 * callers don't have to wait for a startup heal pass.
 *
 * @module app/api/v1/projects/[id]/wardrobe
 */

import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { createAuthenticatedParamsHandler } from '@/lib/api/middleware';
import type { RequestContext } from '@/lib/api/middleware/auth';
import { z } from 'zod';
import { logger } from '@/lib/logger';
import { badRequest, notFound, serverError, created } from '@/lib/api/responses';
import { ensureProjectOfficialStore } from '@/lib/mount-index/ensure-project-store';
import {
  ensureProjectWardrobeFolder,
  readProjectWardrobe,
} from '@/lib/mount-index/project-wardrobe';
import { createProjectWardrobeItem } from '@/lib/database/repositories/vault-overlay/wardrobe-writes';
import { WardrobeItemTypeEnum, type WardrobeItem } from '@/lib/schemas/wardrobe.types';

const createWardrobeSchema = z.object({
  title: z.string().min(1, 'Title is required'),
  description: z.string().nullable().optional(),
  /** Plain-text image-generation cue; preferred over title in image prompts. */
  imagePrompt: z.string().nullable().optional(),
  types: z.array(WardrobeItemTypeEnum).min(1, 'At least one type is required'),
  appropriateness: z.string().nullable().optional(),
  isDefault: z.boolean().optional(),
  /** IDs of other items this composite bundles. Empty/omitted = leaf item. */
  componentItemIds: z.array(z.string()).optional(),
  /** Composite-only: clear the designated slots on equip instead of layering. */
  replace: z.boolean().optional(),
});

// ============================================================================
// GET — list project wardrobe items
// ============================================================================

export const GET = createAuthenticatedParamsHandler<{ id: string }>(
  async (_req: NextRequest, { repos }: RequestContext, { id }) => {
    try {
      const project = await repos.projects.findById(id);
      if (!project) return notFound('Project');

      const ensured = await ensureProjectOfficialStore(project.id, project.name);
      if (!ensured) {
        return serverError('Failed to ensure project document store');
      }
      await ensureProjectWardrobeFolder(ensured.mountPointId);

      const wardrobeItems = await readProjectWardrobe(ensured.mountPointId, true);

      return NextResponse.json({
        mountPointId: ensured.mountPointId,
        wardrobeItems,
      });
    } catch (error) {
      logger.error(
        '[Projects v1] Failed to list project wardrobe',
        { projectId: id, context: 'wardrobe' },
        error instanceof Error ? error : undefined,
      );
      return serverError('Failed to list project wardrobe');
    }
  },
);

// ============================================================================
// POST — create a new project wardrobe item
// ============================================================================

export const POST = createAuthenticatedParamsHandler<{ id: string }>(
  async (req: NextRequest, { user, repos }: RequestContext, { id }) => {
    try {
      const project = await repos.projects.findById(id);
      if (!project) return notFound('Project');

      const body = await req.json();
      const validated = createWardrobeSchema.parse(body);

      const ensured = await ensureProjectOfficialStore(project.id, project.name);
      if (!ensured) {
        return serverError('Failed to ensure project document store');
      }
      await ensureProjectWardrobeFolder(ensured.mountPointId);

      const now = new Date().toISOString();
      const item: WardrobeItem = {
        id: randomUUID(),
        characterId: null,
        title: validated.title,
        description: validated.description ?? null,
        imagePrompt: validated.imagePrompt ?? null,
        types: validated.types,
        componentItemIds: validated.componentItemIds ?? [],
        appropriateness: validated.appropriateness ?? null,
        isDefault: validated.isDefault ?? false,
        replace: validated.replace ?? false,
        migratedFromClothingRecordId: null,
        archivedAt: null,
        createdAt: now,
        updatedAt: now,
      };

      const stored = await createProjectWardrobeItem(ensured.mountPointId, item);

      logger.info('[Projects v1] Created project wardrobe item', {
        projectId: id,
        userId: user.id,
        mountPointId: ensured.mountPointId,
        itemId: stored.id,
        title: stored.title,
        context: 'wardrobe',
      });

      // Return the freshly listed items so the client doesn't need a follow-up GET.
      const wardrobeItems = await readProjectWardrobe(ensured.mountPointId, true);
      return created({
        mountPointId: ensured.mountPointId,
        wardrobeItem: stored,
        wardrobeItems,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return badRequest(`Invalid request body: ${error.issues.map((i) => i.message).join('; ')}`);
      }
      // Cycle rejection from the vault writer surfaces as a plain Error.
      if (error instanceof Error && error.message.includes('component cycle')) {
        return badRequest(error.message);
      }
      logger.error(
        '[Projects v1] Failed to create project wardrobe item',
        { projectId: id, context: 'wardrobe' },
        error instanceof Error ? error : undefined,
      );
      return serverError('Failed to create project wardrobe item');
    }
  },
);
