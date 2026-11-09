/**
 * Settings URL builders — a leaf module (no imports) so both the registry and
 * `lib/foundry/subsystem-defaults.ts` can derive their links from one spelling.
 *
 * @module lib/settings/hrefs
 */

/** `/settings?group=<id>` — opens a group. */
export function settingsGroupHref(group: string): string {
  return `/settings?group=${group}`
}

/** `/settings?section=<cardId>` — opens the card's group, opens the card and scrolls to it. */
export function settingsCardHref(cardId: string): string {
  return `/settings?section=${cardId}`
}

/** `/settings?persona=<subsystemId>` — the page through one persona's lens. */
export function settingsPersonaHref(persona: string): string {
  return `/settings?persona=${persona}`
}

/** `/settings?q=<text>` — the page with the search pre-filled. */
export function settingsSearchHref(query: string): string {
  return `/settings?q=${encodeURIComponent(query)}`
}
