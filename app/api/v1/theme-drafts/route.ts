/**
 * Theme drafts (Calliope Live, Spec D)
 *
 * GET  /api/v1/theme-drafts - List drafts (folders under `Themes/` in Quilltap General)
 * POST /api/v1/theme-drafts - Create a draft: `{ name, from? }` — blank, or a copy of the installed theme `from`
 * POST /api/v1/theme-drafts?action=import - (multipart, the archive in `file`) open a `.qtap-theme` as a new draft (Spec G);
 *      413 past the bundle limits (refused on Content-Length before the body is read), 422 when it would not install
 */

import { NextRequest } from 'next/server';
import { z } from 'zod';
import { createContextHandler } from '@/lib/api/middleware';
import { withCollectionActionDispatch } from '@/lib/api/middleware/actions';
import { badRequest, created, errorResponse, successResponse } from '@/lib/api/responses';
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

/** The bundle limit, plus room for the multipart wrapping around the one file. */
const MULTIPART_ALLOWANCE = 64 * 1024;

async function handleImport(request: NextRequest) {
  const { MAX_BUNDLE_SIZE } = await import('@/lib/themes/bundle-archive');
  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.includes('multipart/form-data')) return badRequest('Expected multipart/form-data with the archive in "file"');
  // Refused before the body is read: an archive past the limit is never held whole.
  const length = Number(request.headers.get('content-length'));
  if (!Number.isFinite(length) || length <= 0) return errorResponse('The upload must say its length (Content-Length)', 411);
  if (length > MAX_BUNDLE_SIZE + MULTIPART_ALLOWANCE) {
    logger.info('Refusing a theme import past the bundle size limit', { context: 'theme-drafts-api', length });
    return errorResponse(`The archive is larger than a theme may be (${MAX_BUNDLE_SIZE / 1024 / 1024} MB)`, 413, { reason: 'limit' });
  }

  const form = await request.formData();
  const files = form.getAll('file');
  if (files.length !== 1 || !(files[0] instanceof File)) return badRequest('Expected exactly one file in "file"');
  for (const key of form.keys()) {
    if (key !== 'file') return badRequest(`Unexpected field "${key}"`);
  }
  const upload = files[0];
  if (upload.size > MAX_BUNDLE_SIZE) {
    return errorResponse(`The archive is larger than a theme may be (${MAX_BUNDLE_SIZE / 1024 / 1024} MB)`, 413, { reason: 'limit' });
  }

  await ensureThemesLoaded();
  const { importDraft } = await getDrafts();
  try {
    const result = await importDraft({ fileName: upload.name, bytes: Buffer.from(await upload.arrayBuffer()) });
    logger.info('Imported a theme archive as a draft', { context: 'theme-drafts-api', draftId: result.draft.id, bundleId: result.bundleId, idChanged: result.idChanged });
    return created(result);
  } catch (error) {
    const response = (await getDraftErrors()).draftErrorResponse(error);
    if (response) return response;
    throw error;
  }
}

export const GET = createContextHandler(withCollectionActionDispatch({}, () => handleList()));
export const POST = createContextHandler(
  withCollectionActionDispatch({ import: (request) => handleImport(request) }, (request) => handleCreate(request)),
);
