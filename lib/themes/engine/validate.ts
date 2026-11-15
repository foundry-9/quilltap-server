/**
 * Theme engine — validate a version 2 theme document.
 *
 * Pure: the caller reads the files and passes their contents and the list of
 * paths in the bundle. Every error names the file and key (or CSS line);
 * an unknown token name comes with the nearest registry name.
 *
 * Rules (Spec A 3.1, 3.3):
 * - theme.json and tokens.json match their schemas (./document.ts);
 * - every file the manifest names exists; icons are known app icons, `.svg`
 *   or `.webp`; subsystem keys are known subsystem ids, their images bundle
 *   paths (or "none");
 * - token keys are registry tokens, choices are registry choices and options;
 * - a value may not contain `;`, `{`, `}`, `!` or `</`; a `var()` names a
 *   primitive of this document, a registry token or a Tailwind token, or
 *   carries a fallback; literal values are checked against the token type
 *   where that is cheap and certain; `url()` follows ./urls.ts;
 * - no reference cycles, in either mode;
 * - the custom CSS scopes cleanly (./scope.ts).
 *
 * @module themes/engine/validate
 */

import { parseColor } from '../color';
import type { TokenType } from '../registry';
import { tailwindAlias, tailwindTokenNames as tailwindNamesOf } from '../registry/tailwind';
import {
  PRIMITIVE_TYPES,
  primitiveVar,
  ThemeManifestSchema,
  ThemeTokensDocumentSchema,
  tokenModes,
  type ThemeDocument,
} from './document';
import { hasImageExtension } from './css-text';
import { resolveTheme, type RegistryView } from './resolve';
import { scopeThemeCss } from './scope';
import { rewriteUrls } from './urls';

export interface ValidationContext {
  registry: RegistryView;
  /** Bundle-relative paths of every file in the bundle. */
  files: ReadonlySet<string>;
  /** The app's icon names. */
  iconNames: ReadonlySet<string>;
  /** The known subsystem ids. */
  subsystemIds: ReadonlySet<string>;
}

export interface ValidationInput {
  manifest: unknown;
  tokens: unknown;
  /** The custom CSS as written, when the manifest names one. */
  css?: string;
}

export type ThemeDocumentValidation =
  | { valid: true; document: ThemeDocument; scopedCss: string; errors: [] }
  | { valid: false; errors: string[] };

/** Tailwind's names (theme-tokens.css), read off the registry the engine is given. */
export function tailwindTokenNames(registry: RegistryView): Set<string> {
  return tailwindNamesOf(registry.tokens);
}

export { tailwindAlias };

function levenshtein(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return row[b.length];
}

/** The registry name nearest `name`, when one is reasonably close. */
export function nearestName(name: string, candidates: Iterable<string>): string | undefined {
  let best: string | undefined;
  let bestDistance = Infinity;
  for (const c of candidates) {
    const d = levenshtein(name, c);
    if (d < bestDistance) {
      bestDistance = d;
      best = c;
    }
  }
  return best !== undefined && bestDistance <= Math.max(3, Math.floor(name.length / 4)) ? best : undefined;
}

const KEYWORDS = new Set(['inherit', 'initial', 'unset', 'revert', 'revert-layer']);
const COLOR_KEYWORDS = new Set(['currentcolor', 'transparent', 'canvas', 'canvastext', 'linktext', 'buttonface', 'buttontext', 'highlight', 'highlighttext', 'graytext', 'field', 'fieldtext', 'mark', 'marktext', 'accentcolor', 'accentcolortext']);
const LENGTH_KEYWORDS = new Set(['auto', 'none', 'normal', 'fit-content', 'min-content', 'max-content', 'thin', 'medium', 'thick']);
const LENGTH = /^-?(\d+\.?\d*|\.\d+)(px|rem|em|%|vh|vw|vmin|vmax|svh|lvh|dvh|svw|lvw|dvw|ch|ex|cap|ic|lh|rlh|pt|pc|cm|mm|q|in|cqw|cqh|cqi|cqb|cqmin|cqmax)$/i;

/** Null when `value` is acceptable for `type`, else why not. Values with a function are not second-guessed. */
function typeProblem(type: TokenType, value: string): string | null {
  const v = value.trim();
  if (v.includes('(') || KEYWORDS.has(v.toLowerCase())) return null;
  switch (type) {
    case 'color':
      return parseColor(v) || COLOR_KEYWORDS.has(v.toLowerCase()) ? null : `"${v}" is not a colour`;
    case 'length':
    case 'radius': {
      const words = v.split(/\s+|\s*\/\s*/).filter(Boolean);
      const bad = words.find((w) => w !== '0' && !LENGTH.test(w) && !LENGTH_KEYWORDS.has(w.toLowerCase()));
      return bad ? `"${v}" is not a length` : null;
    }
    case 'duration':
      return /^(\d+\.?\d*|\.\d+)(ms|s)$/i.test(v) ? null : `"${v}" is not a duration`;
    case 'font-weight':
      return /^(normal|bold|bolder|lighter|[1-9]\d{0,2}|1000)$/i.test(v) ? null : `"${v}" is not a font weight`;
    case 'opacity':
      return /^(\d+\.?\d*|\.\d+)%?$/.test(v) ? null : `"${v}" is not an opacity`;
    case 'number':
      return /^-?(\d+\.?\d*|\.\d+)$/.test(v) ? null : `"${v}" is not a number`;
    default:
      return null;
  }
}

export function validateThemeDocument(input: ValidationInput, ctx: ValidationContext): ThemeDocumentValidation {
  const errors: string[] = [];
  const manifestResult = ThemeManifestSchema.safeParse(input.manifest);
  if (!manifestResult.success) {
    for (const issue of manifestResult.error.issues) errors.push(`theme.json: ${issue.path.join('.') || '(root)'}: ${issue.message}`);
  }
  const tokensResult = ThemeTokensDocumentSchema.safeParse(input.tokens);
  if (!tokensResult.success) {
    for (const issue of tokensResult.error.issues) errors.push(`tokens.json: ${issue.path.join('.') || '(root)'}: ${issue.message}`);
  }
  if (!manifestResult.success || !tokensResult.success) return { valid: false, errors };

  const manifest = manifestResult.data;
  const tokens = tokensResult.data;
  const { files, registry } = ctx;
  const exists = (where: string, p: string) => {
    if (!files.has(p)) errors.push(`theme.json: ${where}: file "${p}" is not in the bundle`);
  };

  // ---- manifest files
  exists('tokensPath', manifest.tokensPath);
  if (manifest.stylesPath) exists('stylesPath', manifest.stylesPath);
  if (manifest.stylesPath && input.css === undefined) errors.push(`theme.json: stylesPath: "${manifest.stylesPath}" could not be read`);
  if (manifest.previewImage) {
    exists('previewImage', manifest.previewImage);
    if (!hasImageExtension(manifest.previewImage)) errors.push('theme.json: previewImage: not an image file');
  }
  manifest.fonts?.forEach((font, i) => {
    exists(`fonts.${i}.src`, font.src);
    if (font.licenseFile) exists(`fonts.${i}.licenseFile`, font.licenseFile);
  });
  for (const [name, p] of Object.entries(manifest.icons ?? {})) {
    if (!ctx.iconNames.has(name)) {
      const near = nearestName(name, ctx.iconNames);
      errors.push(`theme.json: icons.${name}: not an app icon${near ? ` (did you mean "${near}"?)` : ''}`);
    }
    if (!/\.(svg|webp)$/i.test(p)) errors.push(`theme.json: icons.${name}: must be .svg or .webp`);
    exists(`icons.${name}`, p);
  }
  for (const [id, sub] of Object.entries(manifest.subsystems ?? {})) {
    if (!ctx.subsystemIds.has(id)) {
      const near = nearestName(id, ctx.subsystemIds);
      errors.push(`theme.json: subsystems.${id}: not a subsystem id${near ? ` (did you mean "${near}"?)` : ''}`);
    }
    for (const key of ['thumbnail', 'backgroundImage'] as const) {
      const p = sub[key];
      if (p === undefined || p === 'none') continue;
      if (!hasImageExtension(p)) errors.push(`theme.json: subsystems.${id}.${key}: not an image file`);
      exists(`subsystems.${id}.${key}`, p);
    }
  }

  // ---- tokens.json
  const registryNames = new Map<string, (typeof registry.tokens)[number]>(registry.tokens.map((t) => [t.name, t]));
  const tailwind = tailwindTokenNames(registry);
  const primitiveNames = new Set(Object.keys(tokens.primitives).map(primitiveVar));
  const urlContext = { themeId: manifest.id, version: manifest.version, files };

  const checkValue = (where: string, value: string, type: TokenType | (typeof PRIMITIVE_TYPES)[number]) => {
    if (/[;{}!]|<\//.test(value)) errors.push(`tokens.json: ${where}: a value may not contain ";", "{", "}", "!" or "</"`);
    for (const m of value.matchAll(/var\(\s*(--[\w-]+)\s*(,)?/g)) {
      const ref = m[1];
      if (m[2] || primitiveNames.has(ref) || registryNames.has(ref) || tailwind.has(ref)) continue;
      const near = nearestName(ref, [...primitiveNames, ...registryNames.keys()]);
      errors.push(`tokens.json: ${where}: var(${ref}) names no primitive or registry token and has no fallback${near ? ` (did you mean ${near}?)` : ''}`);
    }
    for (const e of rewriteUrls(value, urlContext).errors) errors.push(`tokens.json: ${where}: ${e}`);
    const problem = typeProblem(type as TokenType, value);
    if (problem) errors.push(`tokens.json: ${where}: ${problem}`);
  };

  for (const [name, primitive] of Object.entries(tokens.primitives)) {
    checkValue(`primitives.${name}.value`, primitive.value, primitive.type);
    if (primitive.dark !== undefined) checkValue(`primitives.${name}.dark`, primitive.dark, primitive.type);
  }
  for (const [name, entry] of Object.entries(tokens.tokens)) {
    const token = registryNames.get(name);
    if (!token) {
      const near = nearestName(name, registryNames.keys());
      const hint = name.startsWith('--p-') ? ' (primitives go under "primitives", without the --p- prefix)' : near ? ` (did you mean ${near}?)` : '';
      errors.push(`tokens.json: tokens.${name}: not a registry token${hint}`);
      continue;
    }
    const { value, dark } = tokenModes(entry);
    checkValue(`tokens.${name}`, value, token.type);
    if (dark !== undefined) checkValue(`tokens.${name}.dark`, dark, token.type);
  }
  for (const [name, option] of Object.entries(tokens.choices)) {
    const choice = registry.choices.find((c) => c.name === name);
    if (!choice) errors.push(`tokens.json: choices.${name}: not a choice (choices: ${registry.choices.map((c) => c.name).join(', ')})`);
    else if (!choice.options.includes(option)) errors.push(`tokens.json: choices.${name}: "${option}" is not an option (${choice.options.join(', ')})`);
  }

  // ---- cycles, per mode, over the theme's values on top of the registry
  if (errors.length === 0) {
    const resolved = resolveTheme(tokens, registry);
    for (const mode of ['light', 'dark'] as const) {
      const values = resolved[mode];
      const state = new Map<string, 'visiting' | 'done'>();
      const reported = new Set<string>();
      const valueOf = (name: string): string | undefined => {
        if (values[name]) return values[name].value;
        const alias = tailwindAlias(name);
        return alias && values[alias] ? `var(${alias})` : undefined;
      };
      const visit = (name: string, trail: string[]) => {
        const value = valueOf(name);
        if (value === undefined || state.get(name) === 'done') return;
        if (state.get(name) === 'visiting') {
          const cycle = [...trail.slice(trail.indexOf(name)), name];
          const key = [...cycle].sort().join(',');
          if (!reported.has(key)) {
            reported.add(key);
            errors.push(`tokens.json: reference cycle (${mode}): ${cycle.join(' -> ')}`);
          }
          return;
        }
        state.set(name, 'visiting');
        for (const m of value.matchAll(/var\(\s*(--[\w-]+)/g)) visit(m[1], [...trail, name]);
        state.set(name, 'done');
      };
      for (const name of Object.keys(values)) visit(name, []);
    }
  }

  // ---- custom CSS
  let scopedCss = '';
  if (input.css !== undefined) {
    const scoped = scopeThemeCss(input.css, { id: manifest.id, version: manifest.version, files });
    for (const e of scoped.errors) errors.push(`${manifest.stylesPath ?? 'styles'}: ${e}`);
    scopedCss = scoped.css;
  }

  if (errors.length > 0) return { valid: false, errors };
  return { valid: true, document: { manifest, tokens, css: input.css }, scopedCss, errors: [] };
}
