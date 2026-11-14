/**
 * Quilltap General Atlas — item endpoint.
 *
 * GET    /api/v1/atlas/[entryId] — one entry
 * PUT    /api/v1/atlas/[entryId] — edit it (`archived` archives, `imageFileId` picks the picture)
 * DELETE /api/v1/atlas/[entryId] — delete it and its pictures
 *
 * Handler bodies: `lib/atlas/routes/atlas-route-factory.ts`.
 */

import { createAtlasItemHandlers } from '@/lib/atlas/routes/atlas-route-factory';

export const { GET, PUT, DELETE } = createAtlasItemHandlers<{ entryId: string }>({
  scope: 'general',
  paramsToId: () => null,
  logTag: '[Atlas General v1]',
  logIdKey: 'generalId',
});
