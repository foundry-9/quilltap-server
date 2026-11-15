/**
 * Renders `docs/developer/THEME_TOKENS.md` from the token registry. Pure; the
 * writer is `scripts/generate-theme-tokens-doc.ts`, and
 * `scripts/check-theme-references.ts` fails `npm run lint` when the committed
 * file differs from this output.
 *
 * @module themes/registry/doc
 */

import { THEME_CHOICES } from './choices';
import { TOKEN_GROUPS } from './groups';
import type { TokenDef, TokenGroupDef } from './types';

export const THEME_TOKENS_DOC_PATH = 'docs/developer/THEME_TOKENS.md';
export const THEME_TOKENS_DOC_REGENERATE_COMMAND = 'npm run generate:theme-tokens-doc';

function cell(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

function code(text: string): string {
  return text === '' ? '' : `\`${text.replace(/`/g, "'")}\``;
}

function renderRow(token: TokenDef): string {
  const what = token.description ? `${token.label}. ${token.description}` : token.label;
  const def = token.optional ? `${code(token.default)} (optional; unset by default)` : code(token.default);
  const choice = Object.entries(token.byChoice ?? {})
    .flatMap(([name, options]) => Object.entries(options).map(([option, value]) => `${name}=${option}: ${code(value)}`))
    .join('<br>');
  return `| ${code(token.name)} | ${token.type} | ${cell(def)} | ${cell(token.defaultDark !== undefined ? code(token.defaultDark) : '')} | ${cell(choice)} | ${token.visibility} | ${cell(what)} |`;
}

function renderGroup(group: TokenGroupDef): string[] {
  const lines = [`## ${group.label}`, '', `Group id ${code(group.id)}, ${group.tokens.length} tokens.`, ''];
  if (group.description) lines.push(cell(group.description), '');
  lines.push('| Token | Type | Default | Dark default | By choice | Visibility | What it is |');
  lines.push('| --- | --- | --- | --- | --- | --- | --- |');
  for (const token of group.tokens) lines.push(renderRow(token));
  lines.push('');
  return lines;
}

export function renderThemeTokensDoc(groups: readonly TokenGroupDef[] = TOKEN_GROUPS): string {
  const total = groups.reduce((n, g) => n + g.tokens.length, 0);
  const lines: string[] = [
    '# Theme tokens',
    '',
    `<!-- GENERATED FILE — DO NOT EDIT BY HAND. Source: lib/themes/registry/. Regenerate with \`${THEME_TOKENS_DOC_REGENERATE_COMMAND}\`. -->`,
    '',
    `Every token a theme's \`tokens.json\` may set — ${total} tokens in ${groups.length} groups. ` +
      'A theme stores only what it changes: a value for both modes, or `{ "value": …, "dark": … }`. ' +
      'Defaults may reference other tokens with `var()`. The registry lives in `lib/themes/registry/`; ' +
      'the authoring guide is [THEME_DEVELOPMENT.md](THEME_DEVELOPMENT.md) and the structural hooks are in [THEME_HOOKS.md](THEME_HOOKS.md).',
    '',
    '**Visibility:** `standard` tokens are the ones themes set often; `advanced` ones rarely; `internal` ones are app plumbing a theme should leave alone.',
    '',
    '## Choices',
    '',
    'A choice is set in `tokens.json` under `choices`, e.g. `"choices": { "density": "comfortable" }`. ' +
      'Tokens that vary with a choice list their non-default values under "By choice".',
    '',
    '| Choice | Options | Default | What it is |',
    '| --- | --- | --- | --- |',
    ...THEME_CHOICES.map((c) => `| ${code(c.name)} | ${c.options.map(code).join(', ')} | ${code(c.default)} | ${cell(`${c.label}. ${c.description}`)} |`),
    '',
  ];
  for (const group of groups) lines.push(...renderGroup(group));
  return `${lines.join('\n').replace(/\n+$/, '')}\n`;
}
