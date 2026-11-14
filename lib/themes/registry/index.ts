/**
 * Theme token registry.
 *
 * The single source of truth for every `--qt-*` and `--theme-*` default the
 * app declares (Calliope Live, Spec A). `app/styles/_theme-defaults.css` (the
 * semantic tier) and `app/styles/qt-components/_variables.css` (the component
 * tier) are generated from it — edit the group files under `./groups/`, then run
 * `npm run generate:theme-variables`; `npm run lint` fails while the two
 * disagree (`scripts/check-theme-variables.ts`).
 *
 * Framework-free: importable by the server, the client and scripts.
 *
 * @module themes/registry
 */

import { TOKEN_GROUPS } from './groups';
import type { TokenDef, TokenGroupDef } from './types';

export type { TokenDef, TokenGroupDef, TokenSheet, TokenTier, TokenType, TokenVisibility } from './types';
export { TOKEN_GROUPS } from './groups';
export { THEME_CHOICES, getThemeChoice, type ChoiceDef } from './choices';
export { tailwindAlias, tailwindTokenMap, tailwindTokenNames } from './tailwind';
export {
  GENERATED_THEME_SHEETS,
  renderThemeDefaultsCss,
  renderThemeVariablesCss,
  THEME_DEFAULTS_CSS_PATH,
  THEME_VARIABLES_CSS_PATH,
  THEME_VARIABLES_REGENERATE_COMMAND,
} from './emit-css';

/** Every token, in declaration order. */
export const THEME_TOKENS: readonly TokenDef[] = TOKEN_GROUPS.flatMap((g) => g.tokens);

const BY_NAME: ReadonlyMap<string, TokenDef> = new Map(THEME_TOKENS.map((t) => [t.name, t]));
const GROUP_BY_ID: ReadonlyMap<string, TokenGroupDef> = new Map(TOKEN_GROUPS.map((g) => [g.id, g]));

/** The token named `name`, or undefined. */
export function getThemeToken(name: string): TokenDef | undefined {
  return BY_NAME.get(name);
}

/** True when `name` is a registry token. */
export function isThemeToken(name: string): boolean {
  return BY_NAME.has(name);
}

/** The group with id `id`, or undefined. */
export function getTokenGroup(id: string): TokenGroupDef | undefined {
  return GROUP_BY_ID.get(id);
}

/** The tokens of group `id` (empty for an unknown id). */
export function getTokensInGroup(id: string): readonly TokenDef[] {
  return GROUP_BY_ID.get(id)?.tokens ?? [];
}
