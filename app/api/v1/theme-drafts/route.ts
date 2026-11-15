/**
 * Theme drafts (Calliope Live, Spec D)
 *
 * GET  /api/v1/theme-drafts - List drafts (folders under `Themes/` in Quilltap General)
 * POST /api/v1/theme-drafts - Create a draft: `{ name, from? }` — blank, or a copy of the installed theme `from`
 */

import { NextRequest } from 'next/server';
import { z } from 'zod';
import { createContextHandler } from '@/lib/api/middleware';
import { withCollectionActionDispatch } from '@/lib/api/middleware/actions';
import { created, successResponse } from '@/lib/api/responses';
import { logger } from '@/lib/logger';

const getDrafts = () => import('@/lib/themes/drafts');
const getDraftErrors = () => import('@/lib/themes/drafts/api-errors');
const getPluginInit = () => import('@/lib/startup/plugin-initialization');

/** The registry must be loaded so ids and copy sources resolve. */
async function ensureThemesLoaded() {
  const { isPluginSystemInitialized, initializePlugins } = await getPluginInit();
  if (!isPluginSystemInitialized()) await initializePlugins();
}

const CreateDraftSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    from: z.string().min(1).max(64).optional(),
  })
  .strict();

async function handleList() {
  await ensureThemesLoaded();
  const { listDrafts } = await getDrafts();
  try {
    const drafts = await listDrafts();
    logger.debug('Listing theme drafts', { context: 'theme-drafts-api', count: drafts.length });
    return successResponse({ drafts });
  } catch (error) {
    const response = (await getDraftErrors()).draftErrorResponse(error);
    if (response) return response;
    throw error;
  }
}

async function handleCreate(request: NextRequest) {
  const body = CreateDraftSchema.parse(await request.json());
  await ensureThemesLoaded();
  const { createDraft } = await getDrafts();
  try {
    const draft = await createDraft(body);
    logger.info('Created theme draft', { context: 'theme-drafts-api', draftId: draft.id, from: body.from ?? 'blank' });
    return created({ draft });
  } catch (error) {
    const response = (await getDraftErrors()).draftErrorResponse(error);
    if (response) return response;
    throw error;
  }
}

export const GET = createContextHandler(withCollectionActionDispatch({}, () => handleList()));
export const POST = createContextHandler(withCollectionActionDispatch({}, (request) => handleCreate(request)));
