/**
 * Atlas — collection endpoint for a group's tier.
 *
 * GET  /api/v1/groups/[id]/atlas                  — the tier's entries (`?includeArchived`)
 * GET  /api/v1/groups/[id]/atlas?action=folders   — its folders
 * GET  /api/v1/groups/[id]/atlas?action=overlaps  — terms its entries share with other entries or characters
 * POST /api/v1/groups/[id]/atlas                  — create an entry there
 * POST …?action=duplicate | create-folder | rename-folder | delete-folder | move-items | copy-items
 *
 * Handler bodies: `lib/atlas/routes/atlas-route-factory.ts`.
 */

import { createAtlasCollectionHandlers } from '@/lib/atlas/routes/atlas-route-factory';

export const { GET, POST } = createAtlasCollectionHandlers<{ id: string }>({
  scope: 'group',
  paramsToId: ({ id }) => id,
  logTag: '[Groups Atlas v1]',
  logIdKey: 'groupId',
});
