/**
 * Character Wardrobe — item endpoint.
 *
 * GET    /api/v1/characters/[id]/wardrobe/[itemId]                     — one vault item
 * GET    /api/v1/characters/[id]/wardrobe/[itemId]?action=wear-history — who wore it, how often, where last
 * PUT    /api/v1/characters/[id]/wardrobe/[itemId]                     — update it
 * DELETE /api/v1/characters/[id]/wardrobe/[itemId]                     — delete it
 *
 * Handler bodies: `lib/wardrobe/routes/wardrobe-route-factory.ts`.
 */

import { createWardrobeItemHandlers } from '@/lib/wardrobe/routes/wardrobe-route-factory';

export const { GET, PUT, DELETE } = createWardrobeItemHandlers<{ id: string; itemId: string }>({
  scope: 'character',
  paramsToId: ({ id }) => id,
  logTag: '[Wardrobe v1]',
  logIdKey: 'characterId',
});
