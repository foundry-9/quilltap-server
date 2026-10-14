/**
 * Project Wardrobe — collection endpoint.
 *
 * GET  /api/v1/projects/[id]/wardrobe                     — every item in the project's `Wardrobe/` folder
 * POST /api/v1/projects/[id]/wardrobe                     — create an item there
 * GET  /api/v1/projects/[id]/wardrobe?action=instructions — read `Wardrobe/instructions.md`
 * POST /api/v1/projects/[id]/wardrobe?action=instructions — write (or clear) it
 *
 * The project tier of the wardrobe (character > group > project > General).
 * The project's official store and its `Wardrobe/` folder are provisioned on
 * the way, so nothing waits for a startup heal pass.
 *
 * Handler bodies: `lib/wardrobe/routes/wardrobe-route-factory.ts`.
 */

import { createWardrobeCollectionHandlers } from '@/lib/wardrobe/routes/wardrobe-route-factory';

export const { GET, POST } = createWardrobeCollectionHandlers<{ id: string }>({
  scope: 'project',
  paramsToId: ({ id }) => id,
  logTag: '[Projects v1]',
  logIdKey: 'projectId',
});
