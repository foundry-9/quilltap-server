/**
 * Group Wardrobe — item endpoint.
 *
 * GET    /api/v1/groups/[id]/wardrobe/[itemId]                     — one item
 * GET    /api/v1/groups/[id]/wardrobe/[itemId]?action=wear-history — who wore it, how often, where last
 * PUT    /api/v1/groups/[id]/wardrobe/[itemId]                     — update it
 * DELETE /api/v1/groups/[id]/wardrobe/[itemId]                     — delete it
 *
 * Handler bodies: `lib/wardrobe/routes/wardrobe-route-factory.ts`.
 */

import { createWardrobeItemHandlers } from '@/lib/wardrobe/routes/wardrobe-route-factory';

export const { GET, PUT, DELETE } = createWardrobeItemHandlers<{ id: string; itemId: string }>({
  scope: 'group',
  paramsToId: ({ id }) => id,
  logTag: '[Groups v1]',
  logIdKey: 'groupId',
});
