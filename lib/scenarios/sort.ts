/**
 * Scenario ordering — the one comparator every list of scenario objects sorts by.
 *
 * Order is the display title (frontmatter `name`, or whatever the scope's
 * parser falls back to), then the filename, each compared case-insensitively
 * with a leading definite article ignored (`lib/utils/title-sort.ts`) — "The Gilded Cage" files under G.
 * The untrimmed title and then the path break any remaining tie, so the order
 * is total and stable.
 *
 * Pure and client-safe. Default-conflict resolution ("alphabetically-first
 * filename wins") is a separate rule and stays on path order.
 *
 * @module scenarios/sort
 */

import { compareText, titleSortKey } from '@/lib/utils/title-sort';

/** What the comparator needs from a scenario. */
export interface SortableScenario {
  /** Display title. */
  title: string;
  /** Filename without `.md`, or the relative path when that is all there is. */
  filename: string;
  /** Final tiebreaker; usually the relative path. */
  path?: string;
}

/** The string a title or filename sorts under: trimmed, leading "The " dropped. */
export const scenarioSortKey = titleSortKey;

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
