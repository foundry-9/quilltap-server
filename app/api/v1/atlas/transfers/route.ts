/**
 * Atlas transfer API.
 *
 * POST /api/v1/atlas/transfers
 *   `{ action: 'move' | 'copy', entryId, from: { scope, id }, to: { scope, id } }`
 *   Moves or copies one Atlas entry between tiers (pictures carried; a move
 *   keeps the id). A live entry of the same name at the destination refuses
 *   it (`NAME_TAKEN`, 409).
 *
 * The rules live in `transferAtlasEntry` (`lib/atlas/transfers.ts`).
 */

import { createContextHandler } from '@/lib/api/middleware';
import { badRequest, notFound, successResponse } from '@/lib/api/responses';
import { atlasTransferSchema } from '@/lib/schemas/atlas.types';
import { resolveAtlasLocation } from '@/lib/atlas/location';
import { transferAtlasEntry } from '@/lib/atlas/transfers';
import { withAtlasErrors } from '@/lib/atlas/routes/responses';

export const POST = createContextHandler(withAtlasErrors(async (req, { user, repos }) => {
  const body = atlasTransferSchema.parse(await req.json());
  const source = await resolveAtlasLocation(body.from.scope, body.from.id, repos, user.id);
  const record = source ? await source.findEntry(body.entryId) : null;
  if (!source || !record) return notFound('Atlas entry');

  const destination = await resolveAtlasLocation(body.to.scope, body.to.id, repos, user.id, { ensure: true });
  if (!destination) return badRequest('Invalid destination');

  const { entry } = await transferAtlasEntry(repos, { action: body.action, source, destination, record, userId: user.id });
  return successResponse({ entry });
}));
