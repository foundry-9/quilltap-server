/**
 * Scenario ordering — the one comparator every list of scenario objects sorts by.
 *
 * Order is the display title (frontmatter `name`, or whatever the scope's
 * parser falls back to), then the filename, each compared case-insensitively
 * with a leading definite article ignored — "The Gilded Cage" files under G.
 * The untrimmed title and then the path break any remaining tie, so the order
 * is total and stable.
 *
 * Pure and client-safe. Default-conflict resolution ("alphabetically-first
 * filename wins") is a separate rule and stays on path order.
 *
 * @module scenarios/sort
 */

/** What the comparator needs from a scenario. */
export interface SortableScenario {
  /** Display title. */
  title: string;
  /** Filename without `.md`, or the relative path when that is all there is. */
  filename: string;
  /** Final tiebreaker; usually the relative path. */
  path?: string;
}

// Whitespace, dash or underscore after it: filenames are dashed (`the-attic`).
const LEADING_ARTICLE = /^the[\s_-]+/i;

/** The string a title or filename sorts under: trimmed, leading "The " dropped. */
export function scenarioSortKey(value: string): string {
  const trimmed = value.trim();
  const stripped = trimmed.replace(LEADING_ARTICLE, '');
  // A title that is only "The" keeps itself rather than sorting as empty.
  return stripped.length > 0 ? stripped : trimmed;
}

const compareText = (a: string, b: string) =>
  a.localeCompare(b, undefined, { sensitivity: 'base' });

/** Compare two scenarios for display order. */
export function compareScenarios(a: SortableScenario, b: SortableScenario): number {
  return (
    compareText(scenarioSortKey(a.title), scenarioSortKey(b.title)) ||
    compareText(scenarioSortKey(a.filename), scenarioSortKey(b.filename)) ||
    compareText(a.title, b.title) ||
    (a.path ?? '').localeCompare(b.path ?? '')
  );
}

/** Return a sorted copy of `items`, reading each one's sort fields through `toSortable`. */
export function sortScenarios<T>(items: readonly T[], toSortable: (item: T) => SortableScenario): T[] {
  return items
    .map((item) => ({ item, key: toSortable(item) }))
    .sort((x, y) => compareScenarios(x.key, y.key))
    .map(({ item }) => item);
}
