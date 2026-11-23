/**
 * Theme engine — font stacks: an ordered list of family names.
 *
 * A family is its name as the author would type it (`Segoe UI`, not
 * `"Segoe UI"`); a generic family (`serif`, `system-ui`) is a keyword and a
 * `var()` part is kept as written. `format` quotes a name only when CSS needs
 * it. Pure and browser-safe; `parse` returns null for anything it does not
 * fully understand (a quoted generic name, an unbalanced quote).
 *
 * @module themes/engine/values/font-stack
 */

import { isVarReference, splitTopLevel } from './split';

/** CSS's generic font families, which are never quoted. */
export const GENERIC_FONT_FAMILIES: ReadonlySet<string> = new Set([
  'serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'ui-serif', 'ui-sans-serif', 'ui-monospace', 'ui-rounded', 'math', 'emoji', 'fangsong',
]);

export interface FontStack {
  families: string[];
}

/** A run of CSS identifiers, which needs no quotes. */
const IDENTS = /^(-?[A-Za-z_][\w-]*)(\s+-?[A-Za-z_][\w-]*)*$/;

function unquote(part: string): string | null {
  const q = part[0];
  if ((q !== '"' && q !== "'") || part[part.length - 1] !== q || part.length < 2) return null;
  const inner = part.slice(1, -1);
  if (/\\/.test(inner) || inner.includes(q)) return null;
  return inner;
}

export function parseFontStack(value: string): FontStack | null {
  const parts = splitTopLevel(value.trim(), ',');
  if (!parts || parts.some((p) => p === '')) return null;
  const families: string[] = [];
  for (const p of parts) {
    if (isVarReference(p)) {
      families.push(p);
      continue;
    }
    if (p[0] === '"' || p[0] === "'") {
      const name = unquote(p);
      if (name === null || name.trim() === '' || GENERIC_FONT_FAMILIES.has(name.toLowerCase())) return null;
      families.push(name);
      continue;
    }
    const name = p.replace(/\s+/g, ' ');
    if (!IDENTS.test(name) || ['inherit', 'initial', 'unset', 'revert', 'revert-layer', 'default'].includes(name.toLowerCase())) return null;
    families.push(GENERIC_FONT_FAMILIES.has(name.toLowerCase()) ? name.toLowerCase() : name);
  }
  return { families };
}

/** One family as CSS writes it. */
export function formatFontFamily(name: string): string {
  if (isVarReference(name) || GENERIC_FONT_FAMILIES.has(name)) return name;
  const needsQuotes = !IDENTS.test(name) || /\s/.test(name) || GENERIC_FONT_FAMILIES.has(name.toLowerCase());
  return needsQuotes ? `"${name.replace(/["\\]/g, '')}"` : name;
}

export function formatFontStack(stack: FontStack): string {
  return stack.families.map(formatFontFamily).join(', ');
}
