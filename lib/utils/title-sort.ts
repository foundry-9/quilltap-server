/**
 * Title ordering — the one rule for alphabetising display titles.
 *
 * Case-insensitive, with a leading definite article ignored: "The Gilded Cage"
 * files under G. Used by scenario lists (`lib/scenarios/sort.ts`), Atlas
 * listings (`components/atlas/AtlasBrowser.tsx`), the Inventory browser and
 * the wardrobe's title sort (`lib/wardrobe/wear-display.ts`).
 *
 * Pure and client-safe.
 *
 * @module utils/title-sort
 */

// Whitespace, dash or underscore after it: filenames are dashed (`the-attic`).
const LEADING_ARTICLE = /^the[\s_-]+/i;

/** The string a title sorts under: trimmed, leading "The " dropped. */
export function titleSortKey(value: string): string {
  const trimmed = value.trim();
  const stripped = trimmed.replace(LEADING_ARTICLE, '');
  // A title that is only "The" keeps itself rather than sorting as empty.
  return stripped.length > 0 ? stripped : trimmed;
}

/** Case-insensitive comparison of two raw strings. */
export const compareText = (a: string, b: string): number =>
  a.localeCompare(b, undefined, { sensitivity: 'base' });

/**
 * Compare two titles for display order: by sort key, then by the untrimmed
 * title so "The Attic" and "Attic" keep a stable order.
 */
export function compareTitles(a: string, b: string): number {
  return compareText(titleSortKey(a), titleSortKey(b)) || compareText(a, b);
}
