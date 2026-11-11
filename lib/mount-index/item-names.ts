/**
 * Item names — the client-safe half of the item-store kernel
 * (`lib/mount-index/item-store.ts` re-exports it).
 *
 * {@link foldItemName} is the one fold for comparing Wardrobe titles,
 * Inventory names and titles and Atlas names as identity. Locale-sensitive
 * folding is never used for identity: under a Turkish locale
 * `toLocaleLowerCase` turns "I" into a dotless "ı", and the uniqueness rule and
 * the matcher could disagree about whether two names are one.
 *
 * Pure and client-safe.
 *
 * @module lib/mount-index/item-names
 */

/** NFC, trimmed, lower-cased without a locale. */
export function foldItemName(name: string): string {
  return name.normalize('NFC').trim().toLowerCase();
}
