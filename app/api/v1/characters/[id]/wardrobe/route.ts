/**
 * Character Wardrobe — collection endpoint.
 *
 * GET  /api/v1/characters/[id]/wardrobe                     — the character's own vault items
 * GET  /api/v1/characters/[id]/wardrobe?scope=group         — the group tier of their wearable pool,
 *                                                             each item tagged with its group
 * POST /api/v1/characters/[id]/wardrobe                     — create an item in the vault
 * GET  /api/v1/characters/[id]/wardrobe?action=instructions — read `Wardrobe/instructions.md`
 * POST /api/v1/characters/[id]/wardrobe?action=instructions — write (or clear) it
 *
 * Handler bodies: `lib/wardrobe/routes/wardrobe-route-factory.ts`.
 */

import { createWardrobeCollectionHandlers } from '@/lib/wardrobe/routes/wardrobe-route-factory';

export const { GET, POST } = createWardrobeCollectionHandlers<{ id: string }>({
  scope: 'character',
  paramsToId: ({ id }) => id,
  logTag: '[Wardrobe v1]',
  logIdKey: 'characterId',
});
