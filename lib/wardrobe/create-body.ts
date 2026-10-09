/**
 * The one mapping from a validated wardrobe create body to the stored shape
 * of a wardrobe item (everything but `id` / `createdAt` / `updatedAt`).
 *
 * Every create — the item routes, the `wardrobe_create` tool and the
 * transfer route's "land a copy here" write, all via `createItem` in
 * `item-mutations.ts` — builds its item through this, so the defaults
 * (`componentItemIds: []`, `isDefault: false`, `replace: false`, null for a
 * missing *or blank* prose field, no clothing-record provenance, no picture)
 * can't drift between tiers. A fresh item never carries an
 * `imageFileId`: a picture hangs off an item that already has an id, through
 * the images route.
 *
 * Client-safe: type-only imports.
 *
 * @module lib/wardrobe/create-body
 */

import type { z } from 'zod';
import type { createWardrobeSchema, WardrobeItem } from '@/lib/schemas/wardrobe.types';

/** A parsed `createWardrobeSchema` body. A full `WardrobeItem` satisfies it too. */
export type WardrobeCreateBody = z.infer<typeof createWardrobeSchema>;

/** What the repository's `create` takes: an item minus its id and timestamps. */
export type WardrobeCreateData = Omit<WardrobeItem, 'id' | 'createdAt' | 'updatedAt'>;

/**
 * Map a validated create body onto the stored item fields for `characterId`
 * (`null` for a shared item). Optional body fields resolve to their storage
 * defaults; `migratedFromClothingRecordId` is always `null` for a fresh item.
 */
/** A prose field as stored: trimmed-empty reads as absent. */
function prose(value: string | null | undefined): string | null {
  return value && value.trim().length > 0 ? value : null;
}

export function wardrobeItemFromCreateBody(
  body: WardrobeCreateBody,
  characterId: string | null,
): WardrobeCreateData {
  return {
    characterId,
    title: body.title,
    description: prose(body.description),
    imagePrompt: prose(body.imagePrompt),
    types: body.types,
    componentItemIds: Array.from(new Set(body.componentItemIds ?? [])),
    appropriateness: prose(body.appropriateness),
    isDefault: body.isDefault ?? false,
    replace: body.replace ?? false,
    migratedFromClothingRecordId: null,
    imageFileId: null,
  };
}
