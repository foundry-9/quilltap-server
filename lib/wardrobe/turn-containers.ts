/**
 * The per-turn wardrobe containers: the announcement set and the outfit-history
 * intent map an orchestrator threads through one model turn's tools, drained
 * together by `flushPendingWardrobeAnnouncements`. Pure, with no imports that
 * reach the database, so call sites can thread them under test mocks of
 * `outfit-change-effects`.
 *
 * @module wardrobe/turn-containers
 */

import type { WardrobeHistoryIntent } from '@/lib/schemas/chat-wardrobe-history.types';

/** The per-turn wardrobe containers. */
export interface WardrobeTurnContainers {
  /** Per-turn announcement queue the orchestrator threads through the tools. */
  pendingWardrobeAnnouncements?: Set<string>;
  /** Per-turn history intents, created beside the Set. Last intent per character wins. */
  pendingWardrobeHistory?: Map<string, WardrobeHistoryIntent>;
}

/** The per-turn wardrobe containers, created together so neither can be forgotten. */
export function newWardrobeTurnContainers(): Required<WardrobeTurnContainers> {
  return { pendingWardrobeAnnouncements: new Set(), pendingWardrobeHistory: new Map() };
}

/** Just the turn containers a context carries, for threading onward. Absent ones stay absent. */
export function turnContainersOf(source: WardrobeTurnContainers | undefined): WardrobeTurnContainers {
  return {
    ...(source?.pendingWardrobeAnnouncements ? { pendingWardrobeAnnouncements: source.pendingWardrobeAnnouncements } : {}),
    ...(source?.pendingWardrobeHistory ? { pendingWardrobeHistory: source.pendingWardrobeHistory } : {}),
  };
}
