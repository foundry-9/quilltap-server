/**
 * Item rules — the small pure rules the Wardrobe, the Inventory and the Atlas
 * share; the client-safe part of the item-store kernel
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
 * @module lib/mount-index/item-rules
 */

/** NFC, trimmed, lower-cased without a locale. */
export function foldItemName(name: string): string {
  return name.normalize('NFC').trim().toLowerCase();
}

/** Matches a trailing ` (copy)` or ` (copy <N>)` suffix, case-insensitive. */
const COPY_SUFFIX = /\s*\(copy(?:\s+\d+)?\)\s*$/i;

/**
 * The title for a duplicated item: `(copy)` appended, escalating to
 * `(copy 2)`, `(copy 3)`, … when earlier copies exist. A trailing `(copy)` /
 * `(copy N)` on the source is stripped first, so duplicating `Shirt (copy)`
 * yields `Shirt (copy 2)` rather than `Shirt (copy) (copy)`. Collision is
 * compared through {@link foldItemName}.
 *
 * @param sourceTitle The title being duplicated.
 * @param existingTitles Titles already in use.
 */
export function nextCopyTitle(sourceTitle: string, existingTitles: string[]): string {
  const base = sourceTitle.replace(COPY_SUFFIX, '').trim() || sourceTitle.trim();
  const taken = new Set(existingTitles.map((t) => foldItemName(t)));

  for (let n = 1; ; n++) {
    const candidate = n === 1 ? `${base} (copy)` : `${base} (copy ${n})`;
    if (!taken.has(foldItemName(candidate))) return candidate;
  }
}

/**
 * The one place `archived: boolean` (what the API accepts) becomes
 * `archivedAt: string | null` (what an item stores). Archiving is
 * idempotent — re-archiving keeps the original stamp — and restoring clears
 * it. Returns `null` when the item is already in the requested state, so a
 * caller can skip a pointless rewrite.
 */
export function archivedPatch(
  currentArchivedAt: string | null | undefined,
  archived: boolean,
  now: string,
): { archivedAt: string | null } | null {
  const isArchived = Boolean(currentArchivedAt);
  if (isArchived === archived) return null;
  return { archivedAt: archived ? now : null };
}
