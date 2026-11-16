/**
 * Calliope's references — what styles each hook (Calliope Live, Spec J
 * decision 6).
 *
 * The table is generated from the app's own stylesheets by
 * `./styled-by-build.ts` (`npm run generate:theme-styled-by`) into
 * `styled-by.generated.json`, and `npm run lint` fails while it is stale.
 * This module only reads it. Browser-safe.
 *
 * @module themes/assist/styled-by
 */

import generated from './styled-by.generated.json';

/** One property a hook's rules set, with the custom properties its value reads. */
export interface StyledByProperty {
  property: string;
  /** Custom properties the value reads (`var(--x)`), sorted; Tailwind names as written. */
  vars: string[];
  /** Some rule sets it with no `var()` at all. */
  literal?: true;
}

/** What rules under one condition set on a hook. */
export interface StyledByRow {
  /** The condition: '' for the element itself, else e.g. `[data-role="user"], :hover`. */
  when: string;
  properties: StyledByProperty[];
}

export interface StyledByTable {
  catalogueVersion: number;
  /** The stylesheets read, repo-relative. */
  sources: string[];
  /** Rows per hook class; a hook no rule selects is absent. */
  hooks: Record<string, StyledByRow[]>;
}

/** The committed table. */
export const STYLED_BY_TABLE: StyledByTable = generated as StyledByTable;

/** The rows for hook `className` (empty when no app rule selects it). */
export function styledBy(className: string): readonly StyledByRow[] {
  return STYLED_BY_TABLE.hooks[className] ?? [];
}
