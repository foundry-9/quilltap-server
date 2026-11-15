/**
 * One theme draft (Calliope Live, Spec D)
 *
 * GET    /api/v1/theme-drafts/[id]                - The draft: tokens, revision, compiled parts, issues
 * PUT    /api/v1/theme-drafts/[id]                - Save `{ revision, tokens?, name?, description? }`; 409 when `revision` is stale
 * DELETE /api/v1/theme-drafts/[id]                - Delete the draft folder (an installed copy stays)
 * POST   /api/v1/theme-drafts/[id]?action=install - Install the draft as a theme (422 when it has errors)
 */

import type { NextResponse } from 'next/server';
import { z } from 'zod';
import { createContextParamsHandler } from '@/lib/api/middleware';
import { withActionDispatch, type ActionHandler } from '@/lib/api/middleware/actions';
import { messageResponse, successResponse } from '@/lib/api/responses';
import { logger } from '@/lib/logger';
import { ThemeTokensDocumentSchema } from '@/lib/themes/engine';

const getDrafts = () => import('@/lib/themes/drafts');
const getDraftErrors = () => import('@/lib/themes/drafts/api-errors');
const getPluginInit = () => import('@/lib/startup/plugin-initialization');

async function ensureThemesLoaded() {
  const { isPluginSystemInitialized, initializePlugins } = await getPluginInit();
  if (!isPluginSystemInitialized()) await initializePlugins();
}

const SaveDraftSchema = z
  .object({
    revision: z.string().min(1),
    tokens: ThemeTokensDocumentSchema.optional(),
    name: z.string().trim().min(1).max(100).optional(),
    description: z.string().max(500).optional(),
  })
  .strict()
  .refine((b) => b.tokens !== undefined || b.name !== undefined || b.description !== undefined, {
    message: 'Nothing to save: send tokens, name or description',
  });

/** Run a drafts call, answering its known errors; anything else is the middleware's 500. */
async function answering<T>(run: () => Promise<T>, respond: (value: T) => NextResponse): Promise<NextResponse> {
  try {
    return respond(await run());
  } catch (error) {
    const response = (await getDraftErrors()).draftErrorResponse(error);
    if (response) return response;
    throw error;
  }
}

type Handler = ActionHandler<{ id: string }>;

const handleGet: Handler = async (_req, _ctx, { id }) => {
  const { readDraft } = await getDrafts();
  logger.debug('Reading theme draft', { context: 'theme-drafts-api', draftId: id });
  return answering(() => readDraft(id), (draft) => successResponse({ draft }));
};

const handlePut: Handler = async (request, _ctx, { id }) => {
  const body = SaveDraftSchema.parse(await request.json());
  const { readDraft, writeDraftTokens, writeDraftManifestFields, DraftRevisionConflictError } = await getDrafts();
  logger.debug('Saving theme draft', {
    context: 'theme-drafts-api',
    draftId: id,
    tokens: body.tokens !== undefined,
    manifestFields: body.name !== undefined || body.description !== undefined,
  });
  return answering(async () => {
    // The revision guards the whole save: check it before touching the
    // manifest, so a stale save writes nothing at all.
    const current = await readDraft(id);
    if (current.revision !== body.revision) throw new DraftRevisionConflictError(current.revision);
    if (body.name !== undefined || body.description !== undefined) {
      await writeDraftManifestFields(id, { name: body.name, description: body.description });
    }
    return body.tokens ? writeDraftTokens(id, { revision: body.revision, tokens: body.tokens }) : readDraft(id);
  }, (draft) => successResponse({ draft }));
};

const handleDelete: Handler = async (_req, _ctx, { id }) => {
  const { deleteDraft } = await getDrafts();
  return answering(() => deleteDraft(id), () => messageResponse('Theme draft deleted'));
};

const handleInstall: Handler = async (_req, _ctx, { id }) => {
  await ensureThemesLoaded();
  const { installDraft } = await getDrafts();
  logger.info('Installing theme draft', { context: 'theme-drafts-api', draftId: id });
  return answering(() => installDraft(id), (result) => successResponse({ result }));
};

export const GET = createContextParamsHandler<{ id: string }>(withActionDispatch({}, handleGet));
export const PUT = createContextParamsHandler<{ id: string }>(withActionDispatch({}, handlePut));
export const DELETE = createContextParamsHandler<{ id: string }>(withActionDispatch({}, handleDelete));
export const POST = createContextParamsHandler<{ id: string }>(withActionDispatch({ install: handleInstall }));
