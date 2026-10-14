/**
 * Group Wardrobe — collection endpoint.
 *
 * GET  /api/v1/groups/[id]/wardrobe                     — every item in the group's `Wardrobe/` folder
 * POST /api/v1/groups/[id]/wardrobe                     — create an item there
 * GET  /api/v1/groups/[id]/wardrobe?action=instructions — read `Wardrobe/instructions.md`
 * POST /api/v1/groups/[id]/wardrobe?action=instructions — write (or clear) it
 *
 * The group tier of the wardrobe (character > group > project > General).
 * The group's official store and its `Wardrobe/` folder are provisioned on
 * the way, so nothing waits for a startup heal pass.
 *
 * Handler bodies: `lib/wardrobe/routes/wardrobe-route-factory.ts`.
 */

import { createWardrobeCollectionHandlers } from '@/lib/wardrobe/routes/wardrobe-route-factory';

export const { GET, POST } = createWardrobeCollectionHandlers<{ id: string }>({
  scope: 'group',
  paramsToId: ({ id }) => id,
  logTag: '[Groups v1]',
  logIdKey: 'groupId',
});
