/**
 * Atlas transfer — the handler behind
 * `POST /api/v1/atlas?action=move-to-tier` / `?action=copy-to-tier`
 * `{ entryId, from: { scope, id }, to: { scope, id } }`
 * (and, for one release, the old `POST /api/v1/atlas/transfers`, which took
 * `action` in the body). Pictures are carried; a move keeps the id. A live
 * entry of the same name at the destination refuses it (`NAME_TAKEN`, 409).
 *
 * The rules live in `transferAtlasEntry` (`lib/atlas/transfers.ts`).
 *
 * @module lib/atlas/routes/transfer
 */

import type { NextRequest } from 'next/server';
import type { RequestContext } from '@/lib/api/middleware';
import { badRequest, notFound, successResponse } from '@/lib/api/responses';
import { logger } from '@/lib/logger';
import { atlasTransferSchema } from '@/lib/schemas/atlas.types';
import { resolveAtlasLocation } from '@/lib/atlas/location';
import { transferAtlasEntry } from '@/lib/atlas/transfers';
import { withAtlasErrors } from '@/lib/atlas/routes/responses';

/** `mode` comes from the action; `'from-body'` is the deprecated path. */
export function handleAtlasTransfer(mode: 'move' | 'copy' | 'from-body') {
  return withAtlasErrors(async (req: NextRequest, { user, repos }: RequestContext) => {
    const raw = (await req.json()) as Record<string, unknown>;
    const body = atlasTransferSchema.parse(mode === 'from-body' ? raw : { ...raw, action: mode });
    const source = await resolveAtlasLocation(body.from.scope, body.from.id, repos, user.id);
    const record = source ? await source.findEntry(body.entryId) : null;
    if (!source || !record) return notFound('Atlas entry');

    const destination = await resolveAtlasLocation(body.to.scope, body.to.id, repos, user.id, { ensure: true });
    if (!destination) return badRequest('Invalid destination');

    const { entry } = await transferAtlasEntry(repos, { action: body.action, source, destination, record, userId: user.id });
    logger.debug('[Atlas transfer] Done', { action: body.action, entryId: body.entryId, to: body.to.scope });
    return successResponse({ entry });
  });
}
