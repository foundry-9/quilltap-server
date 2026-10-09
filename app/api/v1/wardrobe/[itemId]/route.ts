/**
 * Quilltap General Wardrobe — item endpoint.
 *
 * GET    /api/v1/wardrobe/[itemId]                     — one General item
 * GET    /api/v1/wardrobe/[itemId]?action=wear-history — who wore it, how often, where last
 * PUT    /api/v1/wardrobe/[itemId]                     — update it
 * DELETE /api/v1/wardrobe/[itemId]                     — delete it
 *
 * Handler bodies: `lib/wardrobe/routes/wardrobe-route-factory.ts`.
 */

import { createWardrobeItemHandlers } from '@/lib/wardrobe/routes/wardrobe-route-factory';

export const { GET, PUT, DELETE } = createWardrobeItemHandlers<{ itemId: string }>({
  scope: 'general',
  paramsToId: () => null,
  logTag: '[Wardrobe Archetypes v1]',
  logIdKey: 'generalId',
});
