/**
 * Renders the generated theme stylesheets from the token registry:
 * `app/styles/_theme-defaults.css` (semantic tier) and
 * `app/styles/qt-components/_variables.css` (component tier).
 *
 * Pure: the registry in, the file's exact text out. The generator
 * (`scripts/generate-theme-variables.ts`) writes it; the lint gate
 * (`scripts/check-theme-variables.ts`) compares it with the committed file.
 *
 * _variables.css has two blocks, with the selectors the hand-written file
 * always had:
 * - every default under `:root, [data-theme], [data-theme].dark,
 *   [data-theme].light` (specificity 0,2,0 — a theme outranks it with the same
 *   three selectors scoped to its id, injected later);
 * - every `defaultDark` under `[data-theme].dark`, after it.
 *
 * @module themes/registry/emit-css
 */

import { THEME_CHOICES } from './choices';
import { tailwindTokenMap } from './tailwind';
import type { TokenDef, TokenGroupDef } from './types';

export const THEME_VARIABLES_CSS_PATH = 'app/styles/qt-components/_variables.css';
export const THEME_DEFAULTS_CSS_PATH = 'app/styles/_theme-defaults.css';
export const THEME_VARIABLES_REGENERATE_COMMAND = 'npm run generate:theme-variables';

const RULE = '='.repeat(74);
const WIDTH = 76;

const HEADER = `/**
 * Quilltap theme variables — the defaults for every --qt-* and --theme-*
 * component token, in both colour modes.
 *
 * !!! GENERATED FILE — DO NOT EDIT BY HAND !!!
 * Source of truth: lib/themes/registry/ (one file per group under groups/)
 * Regenerate with: ${THEME_VARIABLES_REGENERATE_COMMAND}
 * \`npm run lint\` fails while this file and the registry disagree.
 *
 * Themes override any of these in their own [data-theme="<id>"] blocks.
 * :root is listed so the defaults resolve before the theme injector sets
 * data-theme — the startup, instance-lock and version-guard screens render
 * then, and without it their .qt-card had no background, leaving dark text
 * on the dark bootstrap art.
 *
 * The hand-written rules that used to live here (the root baseline,
 * ::selection, reduced motion) are in _base.css.
 */`;

/** Greedy word-wrap of one paragraph to `width` columns, each line prefixed. */
function wrap(text: string, prefix: string, width = WIDTH): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (line && prefix.length + line.length + 1 + word.length > width) {
      lines.push(prefix + line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(prefix + line);
  return lines;
}

function assertCommentSafe(text: string, where: string): void {
  if (text.includes('*/')) {
    throw new Error(`Registry text for ${where} contains "*/", which would end the CSS comment early.`);
  }
}

/** A token's note as a comment, keeping its line breaks (indented two spaces). */
function noteComment(text: string, where: string): string[] {
  assertCommentSafe(text, where);
  const lines = text.split('\n');
  if (lines.length === 1) return [`  /* ${lines[0]} */`];
  return [`  /* ${lines[0]}`, ...lines.slice(1, -1).map((l) => (l ? `     ${l}` : '')), `     ${lines[lines.length - 1]} */`];
}

function groupBanner(group: TokenGroupDef): string[] {
  assertCommentSafe(group.label, `group ${group.id}`);
  const out = [`  /* ${RULE}`, `     ${group.label.toUpperCase()}`];
  if (group.description) {
    assertCommentSafe(group.description, `group ${group.id}`);
    out.push(...wrap(group.description, '     '));
  }
  out.push(`     ${RULE} */`);
  return out;
}

function declaration(token: TokenDef, value: string): string {
  if (/[;{}]/.test(value.replace(/"[^"]*"|'[^']*'/g, ''))) {
    throw new Error(`Registry value for ${token.name} contains ";", "{" or "}" outside a string.`);
  }
  return `  ${token.name}: ${value};`;
}

/** The two declaration blocks for `groups`: every default, then every dark value. */
function renderBlocks(groups: readonly TokenGroupDef[]): { shared: string[]; dark: string[] } {
  const shared: string[] = [];
  const dark: string[] = [];

  for (const group of groups) {
    if (group.tokens.length === 0) continue;
    if (shared.length > 0) shared.push('');
    shared.push(...groupBanner(group));
    const optional = group.tokens.filter((t) => t.optional);
    for (const token of group.tokens) {
      if (token.optional) continue;
      if (token.description) {
        if (shared[shared.length - 1] !== `     ${RULE} */`) shared.push('');
        shared.push(...noteComment(token.description, token.name));
      }
      shared.push(declaration(token, token.default));
    }
    if (optional.length > 0) {
      if (shared[shared.length - 1] !== `     ${RULE} */`) shared.push('');
      shared.push(`  /* Optional hooks, read with a fallback and not declared here: ${optional.map((t) => t.name).join(', ')} */`);
    }

    const darkTokens = group.tokens.filter((t) => t.defaultDark !== undefined && !t.optional);
    if (darkTokens.length === 0) continue;
    if (dark.length > 0) dark.push('');
    dark.push(`  /* ---- ${group.label} ---- */`);
    for (const token of darkTokens) {
      if (token.descriptionDark) dark.push(...noteComment(token.descriptionDark, `${token.name} (dark)`));
      dark.push(declaration(token, token.defaultDark as string));
    }
  }
  return { shared, dark };
}

const sheetOf = (g: TokenGroupDef) => g.sheet ?? 'variables';

const banner = (...lines: string[]) => [`/* ${'='.repeat(76)}`, ...lines.map((l) => `   ${l}`), `   ${'='.repeat(76)} */`];

/** One block per non-default choice option, for the tokens that vary with it. */
function renderChoiceBlocks(groups: readonly TokenGroupDef[]): string[] {
  const out: string[] = [];
  for (const choice of THEME_CHOICES) {
    for (const option of choice.options) {
      if (option === choice.default) continue;
      const tokens = groups.flatMap((g) => g.tokens).filter((t) => t.byChoice?.[choice.name]?.[option] !== undefined);
      if (tokens.length === 0) continue;
      out.push(
        '',
        ...banner(`CHOICE: ${choice.name} = ${option}`, `Set by data-qt-${choice.name}="${option}" on <html>. ${choice.default} is the defaults above.`),
        `[data-theme][data-qt-${choice.name}="${option}"] {`,
        ...tokens.map((t) => declaration(t, t.byChoice![choice.name][option])),
        '}'
      );
    }
  }
  return out;
}

/** app/styles/qt-components/_variables.css: the component tier and the font stacks. */
export function renderThemeVariablesCss(groups: readonly TokenGroupDef[]): string {
  const variableGroups = groups.filter((g) => sheetOf(g) === 'variables');
  const { shared, dark } = renderBlocks(variableGroups);
  return [
    HEADER,
    '',
    ...banner('DEFAULTS - BASELINE FOR ALL THEMES (BOTH MODES)'),
    ':root,',
    '[data-theme],',
    '[data-theme].dark,',
    '[data-theme].light {',
    ...shared,
    '}',
    '',
    ...banner('DARK MODE DEFAULTS - BASELINE FOR ALL THEMES IN DARK MODE', 'Only the tokens whose dark value differs from the shared default.'),
    '[data-theme].dark {',
    ...dark,
    '}',
    ...renderChoiceBlocks(variableGroups),
    '',
  ].join('\n');
}

const DEFAULTS_HEADER = `/**
 * Quilltap theme defaults — the semantic tier: colours, radii, type and
 * spacing scales, effects. Component tokens (_variables.css) derive from these.
 *
 * !!! GENERATED FILE — DO NOT EDIT BY HAND !!!
 * Source of truth: lib/themes/registry/ (the groups whose sheet is 'theme-defaults')
 * Regenerate with: ${THEME_VARIABLES_REGENERATE_COMMAND}
 *
 * Declared on :root and .dark (specificity 0,1,0). A version 1 theme's
 * tokens.json is injected later as :root / .dark and so wins; Tailwind's
 * --color-* / --radius-* / --font-* map (theme-tokens.css) reads these names.
 */`;

/** app/styles/_theme-defaults.css: the semantic tier. */
export function renderThemeDefaultsCss(groups: readonly TokenGroupDef[]): string {
  const { shared, dark } = renderBlocks(groups.filter((g) => sheetOf(g) === 'theme-defaults'));
  const map = tailwindTokenMap(groups.flatMap((g) => g.tokens));
  return [
    DEFAULTS_HEADER,
    '',
    ...banner(
      'LIGHT MODE AND SHARED VALUES',
      'Also on any element carrying data-theme (a theme preview container), so',
      'a theme shown inside another one starts from the defaults, not from',
      'the page theme\'s values inherited down.'
    ),
    ':root,',
    '[data-theme] {',
    ...shared,
    '}',
    '',
    ...banner('DARK MODE'),
    '.dark {',
    ...dark,
    '}',
    '',
    ...banner(
      'TAILWIND MAP ON NESTED THEME CONTAINERS',
      'Tailwind declares --color-* / --radius-* / --font-* on :root only, so',
      'below it they arrive already resolved to the page theme. A container',
      'with its own data-theme re-declares them over its own tokens.'
    ),
    '[data-theme]:not(:root) {',
    ...map.map(([name, source]) => `  ${name}: var(${source});`),
    '}',
    '',
  ].join('\n');
}

/** Every generated stylesheet: where it is written and how it is rendered. */
export const GENERATED_THEME_SHEETS: ReadonlyArray<{ path: string; render: (groups: readonly TokenGroupDef[]) => string }> = [
  { path: THEME_DEFAULTS_CSS_PATH, render: renderThemeDefaultsCss },
  { path: THEME_VARIABLES_CSS_PATH, render: renderThemeVariablesCss },
];
