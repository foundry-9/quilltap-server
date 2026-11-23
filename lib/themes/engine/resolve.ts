/**
 * Theme engine — resolve and emit a version 2 theme's tokens.
 *
 * `resolveTheme` gives, for light and dark, every registry token (and the
 * theme's primitives) with its value as written and where that value came
 * from — what an editor needs to show provenance. `emitThemeCss` writes only
 * what the theme itself sets, under the selectors that outrank the generated
 * registry defaults. Pure: no file access.
 *
 * @module themes/engine/resolve
 */

import type { ChoiceDef, TokenDef } from '../registry';
import { primitiveVar, tokenModes, type ThemeTokensDocument } from './document';
import { rewriteUrls } from './urls';

export interface RegistryView {
  tokens: readonly TokenDef[];
  choices: readonly ChoiceDef[];
}

export type ValueSource = 'default' | 'default-dark' | 'choice' | 'theme' | 'theme-dark';

export interface ResolvedValue {
  /** The value as written (not var()-substituted). */
  value: string;
  source: ValueSource;
}

export interface ResolvedTheme {
  light: Record<string, ResolvedValue>;
  dark: Record<string, ResolvedValue>;
  /** Every choice with the option in force. */
  choices: Record<string, string>;
}

/** The option of each registry choice a theme picks (the choice's default when it picks none). */
export function choicesInForce(doc: Pick<ThemeTokensDocument, 'choices'>, registry: RegistryView): Record<string, string> {
  return Object.fromEntries(registry.choices.map((c) => [c.name, doc.choices[c.name] ?? c.default]));
}

export function resolveTheme(doc: ThemeTokensDocument, registry: RegistryView): ResolvedTheme {
  const choices = choicesInForce(doc, registry);
  const light: Record<string, ResolvedValue> = {};
  const dark: Record<string, ResolvedValue> = {};

  for (const token of registry.tokens) {
    if (token.optional && doc.tokens[token.name] === undefined) continue;
    let l: ResolvedValue = { value: token.default, source: 'default' };
    let d: ResolvedValue = token.defaultDark !== undefined ? { value: token.defaultDark, source: 'default-dark' } : { value: token.default, source: 'default' };
    for (const [name, option] of Object.entries(choices)) {
      const byChoice = token.byChoice?.[name]?.[option];
      if (byChoice !== undefined) {
        l = { value: byChoice, source: 'choice' };
        d = { value: byChoice, source: 'choice' };
      }
    }
    const own = doc.tokens[token.name];
    if (own !== undefined) {
      const { value, dark: darkValue } = tokenModes(own);
      l = { value, source: 'theme' };
      d = darkValue !== undefined ? { value: darkValue, source: 'theme-dark' } : { value, source: 'theme' };
    }
    light[token.name] = l;
    dark[token.name] = d;
  }
  for (const [name, primitive] of Object.entries(doc.primitives)) {
    light[primitiveVar(name)] = { value: primitive.value, source: 'theme' };
    dark[primitiveVar(name)] = primitive.dark !== undefined ? { value: primitive.dark, source: 'theme-dark' } : { value: primitive.value, source: 'theme' };
  }
  return { light, dark, choices };
}

export interface EmitOptions {
  id: string;
  version: string;
}

/**
 * CSS declaring only what the theme sets: shared values under
 * `[data-theme="<id>"], [data-theme="<id>"].light, [data-theme="<id>"].dark`
 * (0,2,0 — it outranks the generated defaults by coming later), dark values
 * under `[data-theme="<id>"].dark` after it. Relative `url()`s are rewritten
 * to the theme's asset route.
 */
export function emitThemeCss(doc: ThemeTokensDocument, options: EmitOptions): string {
  const t = `[data-theme="${options.id}"]`;
  const shared: string[] = [];
  const dark: string[] = [];
  const write = (name: string, value: string) => `  ${name}: ${rewriteUrls(value, { themeId: options.id, version: options.version }).value};`;

  for (const [name, primitive] of Object.entries(doc.primitives)) {
    shared.push(write(primitiveVar(name), primitive.value));
    if (primitive.dark !== undefined) dark.push(write(primitiveVar(name), primitive.dark));
  }
  for (const [name, entry] of Object.entries(doc.tokens)) {
    const { value, dark: darkValue } = tokenModes(entry);
    shared.push(write(name, value));
    if (darkValue !== undefined) dark.push(write(name, darkValue));
  }

  const blocks: string[] = [`/* Theme ${options.id} ${options.version}: tokens (generated) */`];
  if (shared.length > 0) blocks.push(`${t},\n${t}.light,\n${t}.dark {\n${shared.join('\n')}\n}`);
  if (dark.length > 0) blocks.push(`${t}.dark {\n${dark.join('\n')}\n}`);
  return `${blocks.join('\n\n')}\n`;
}
