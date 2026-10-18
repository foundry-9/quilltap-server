/**
 * The per-turn wardrobe containers: the announcement set and the outfit-history
 * intent map an orchestrator threads through one model turn's tools, drained
 * together by `flushPendingWardrobeAnnouncements`, and beside them the
 * Inventory's pending changes, drained by `flushPendingInventoryAnnouncements`
 * (`lib/inventory/equip-effects.ts`) at the same point. Pure, with no imports
 * that reach the database, so call sites can thread them under test mocks of
 * `outfit-change-effects`.
 *
 * @module wardrobe/turn-containers
 */

import type { WardrobeHistoryIntent } from '@/lib/schemas/chat-wardrobe-history.types';
import type { ResolvedInventoryItem } from '@/lib/schemas/inventory.types';

/**
 * One character's Inventory changes waiting for the turn's single Pascal
 * line: everything taken up, set down and picked up, netted (taken up then
 * set down in one turn is no change).
 */
export interface PendingInventoryChange {
  userId: string;
  chatId: string;
  characterId: string;
  equipped: ResolvedInventoryItem[];
  unequipped: ResolvedInventoryItem[];
  pickedUp: ResolvedInventoryItem[];
}

/** The per-turn wardrobe containers. */
export interface WardrobeTurnContainers {
  /** Per-turn announcement queue the orchestrator threads through the tools. */
  pendingWardrobeAnnouncements?: Set<string>;
  /** Per-turn history intents, created beside the Set. Last intent per character wins. */
  pendingWardrobeHistory?: Map<string, WardrobeHistoryIntent>;
  /** Per-turn Inventory changes, keyed `chatId:characterId`, one Pascal line each at turn end. */
  pendingInventoryAnnouncements?: Map<string, PendingInventoryChange>;
}

/** The per-turn wardrobe containers, created together so neither can be forgotten. */
export function newWardrobeTurnContainers(): Required<WardrobeTurnContainers> {
  return {
    pendingWardrobeAnnouncements: new Set(),
    pendingWardrobeHistory: new Map(),
    pendingInventoryAnnouncements: new Map(),
  };
}

/** Just the turn containers a context carries, for threading onward. Absent ones stay absent. */
export function turnContainersOf(source: WardrobeTurnContainers | undefined): WardrobeTurnContainers {
  return {
    ...(source?.pendingWardrobeAnnouncements ? { pendingWardrobeAnnouncements: source.pendingWardrobeAnnouncements } : {}),
    ...(source?.pendingWardrobeHistory ? { pendingWardrobeHistory: source.pendingWardrobeHistory } : {}),
    ...(source?.pendingInventoryAnnouncements ? { pendingInventoryAnnouncements: source.pendingInventoryAnnouncements } : {}),
  };
}
