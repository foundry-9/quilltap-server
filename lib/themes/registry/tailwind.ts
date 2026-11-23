/**
 * Theme token registry — Tailwind's token map (app/styles/theme-tokens.css),
 * read off the registry: `--color-<x>` for every semantic colour,
 * `--radius-sm/md/lg`, `--font-<x>` for the font stacks. A test keeps it equal
 * to the CSS.
 *
 * @module themes/registry/tailwind
 */

import type { TokenDef } from './types';

/** [Tailwind name, the semantic token it reads], in registry order. */
export function tailwindTokenMap(tokens: readonly TokenDef[]): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const t of tokens) {
    if (t.group === 'colors' || t.group === 'sidebar-colors') out.push([t.name.replace(/^--theme-/, '--color-'), t.name]);
    else if (t.group === 'fonts') out.push([t.name.replace(/^--theme-font-/, '--font-'), t.name]);
    else if (/^--theme-radius-(sm|md|lg)$/.test(t.name)) out.push([t.name.replace(/^--theme-/, '--'), t.name]);
  }
  return out;
}

/** The Tailwind names, as a set. */
export function tailwindTokenNames(tokens: readonly TokenDef[]): Set<string> {
  return new Set(tailwindTokenMap(tokens).map(([name]) => name));
}

/**
 * The semantic token a Tailwind name reads (`--color-primary` →
 * `--theme-primary`, `--font-sans` → `--theme-font-sans`, `--radius-md` →
 * `--theme-radius-md`), or undefined.
 */
export function tailwindAlias(name: string): string | undefined {
  if (name.startsWith('--color-')) return `--theme-${name.slice('--color-'.length)}`;
  if (name.startsWith('--font-')) return `--theme-font-${name.slice('--font-'.length)}`;
  if (/^--radius-(sm|md|lg)$/.test(name)) return `--theme-${name.slice(2)}`;
  return undefined;
}
