/**
 * Atlas — item endpoint for a project's tier.
 *
 * GET    /api/v1/projects/[id]/atlas/[entryId] — one entry
 * PUT    /api/v1/projects/[id]/atlas/[entryId] — edit it (`archived` archives, `imageFileId` picks the picture)
 * DELETE /api/v1/projects/[id]/atlas/[entryId] — delete it and its pictures
 *
 * Handler bodies: `lib/atlas/routes/atlas-route-factory.ts`.
 */

import { createAtlasItemHandlers } from '@/lib/atlas/routes/atlas-route-factory';

export const { GET, PUT, DELETE } = createAtlasItemHandlers<{ id: string; entryId: string }>({
  scope: 'project',
  paramsToId: ({ id }) => id,
  logTag: '[Projects Atlas v1]',
  logIdKey: 'projectId',
});
