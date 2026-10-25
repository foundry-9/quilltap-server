/**
 * The Inventory's client-side addressing: which tier a browser is looking at,
 * and the URLs its reads and writes go to. A container is the wardrobe's
 * `{ scope, id }` shape (one encoder, `encodeWardrobeContainer`, names a tier
 * for both), so the dialogs' container selects read the same.
 *
 * Client-safe: pure.
 *
 * @module lib/inventory/container
 */

import {
  GENERAL_CONTAINER,
  decodeWardrobeContainer,
  encodeWardrobeContainer,
  type WardrobeContainer,
} from '@/lib/wardrobe/wardrobe-container';
import type { InventoryOrigin } from '@/lib/schemas/inventory.types';

export type InventoryContainer = WardrobeContainer;

export const GENERAL_INVENTORY_CONTAINER: InventoryContainer = GENERAL_CONTAINER;
export const GENERAL_INVENTORY_NAME = 'Quilltap General';

export const encodeInventoryContainer = encodeWardrobeContainer;
export const decodeInventoryContainer = decodeWardrobeContainer;

/** The collection URL of a tier. */
export function inventoryCollectionUrl(container: InventoryContainer): string {
  switch (container.scope) {
    case 'general':
      return '/api/v1/inventory';
    case 'character':
      return `/api/v1/characters/${container.id}/inventory`;
    case 'project':
      return `/api/v1/projects/${container.id}/inventory`;
    case 'group':
      return `/api/v1/groups/${container.id}/inventory`;
  }
}

/** A collection action URL, with optional extra query parameters. */
export function inventoryActionUrl(
  container: InventoryContainer,
  action: string,
  params: Record<string, string | null | undefined> = {},
): string {
  const query = new URLSearchParams({ action });
  for (const [key, value] of Object.entries(params)) if (value) query.set(key, value);
  return `${inventoryCollectionUrl(container)}?${query.toString()}`;
}

/** The item URL of one object in a tier. */
export function inventoryItemUrl(container: InventoryContainer, itemId: string): string {
  return `${inventoryCollectionUrl(container)}/${itemId}`;
}

/** The images URL of one object, with its container in the query. */
export function inventoryImagesUrl(container: InventoryContainer, itemId: string, action?: string): string {
  const query = new URLSearchParams({ scope: container.scope });
  if (container.id) query.set('id', container.id);
  if (action) query.set('action', action);
  return `/api/v1/inventory/${itemId}/images?${query.toString()}`;
}

/** The tier an object lives in, from the origin a read tagged it with. */
export function containerOfOrigin(origin: InventoryOrigin | null | undefined, fallback: InventoryContainer): InventoryContainer {
  if (!origin) return fallback;
  if (origin.scope === 'general') return GENERAL_INVENTORY_CONTAINER;
  return origin.id ? { scope: origin.scope, id: origin.id } : fallback;
}

/**
 * True when an object lives in the tier being browsed. A shared tier lists
 * only its own objects; a character's merged view also lists what it borrows
 * from groups, the project and General, tagged with their origin.
 */
export function isInContainer(item: { origin?: InventoryOrigin | null }, container: InventoryContainer): boolean {
  if (!item.origin) return true;
  if (container.scope !== 'character') return item.origin.scope === container.scope;
  return item.origin.scope === 'character' && item.origin.id === container.id;
}

/** A short label for the tier an object came from. */
export function inventoryOriginLabel(origin: InventoryOrigin | null | undefined): string | null {
  if (!origin) return null;
  if (origin.scope === 'general') return 'General';
  if (origin.scope === 'project') return `Project: ${origin.name}`;
  if (origin.scope === 'group') return `Group: ${origin.name}`;
  return null;
}
