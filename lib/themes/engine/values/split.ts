/**
 * Theme engine — splitting a token value into its parts.
 *
 * Top-level splits that honour parentheses and quotes, so `color-mix(in
 * srgb, red 5%, blue)` and `"Segoe UI"` stay whole. Pure and browser-safe.
 *
 * @module themes/engine/values/split
 */

/**
 * `value` split at top-level `separator` (`,` or whitespace), trimmed, or
 * null when its brackets or quotes do not balance.
 */
export function splitTopLevel(value: string, separator: ',' | 'space'): string[] | null {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let current = '';
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    if (quote) {
      current += ch;
      if (ch === '\\' && i + 1 < value.length) current += value[++i];
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === '(') depth++;
    if (ch === ')') {
      depth--;
      if (depth < 0) return null;
    }
    const splits = depth === 0 && (separator === ',' ? ch === ',' : /\s/.test(ch));
    if (splits) {
      if (separator === ',' || current !== '') parts.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  if (quote || depth !== 0) return null;
  if (separator === ',' || current !== '') parts.push(current.trim());
  return parts;
}

/** True when `part` is exactly one `var()` reference (with or without a fallback). */
export function isVarReference(part: string): boolean {
  if (!/^var\(/i.test(part) || !part.endsWith(')')) return false;
  // The opening `var(` must be closed by the final `)`.
  const inner = splitTopLevel(part.slice(4, -1), ',');
  return inner !== null && /^\s*--[\w-]+$/.test(inner[0] ?? '');
}

/** True when `part` is a function call such as `rgb(…)` or `cubic-bezier(…)`. */
export function isFunctionCall(part: string): boolean {
  const m = /^([a-z-]+)\(/i.exec(part);
  return m !== null && part.endsWith(')') && splitTopLevel(part, 'space')?.length === 1;
}

/** `n` written as CSS writes a number: no float noise, no needless zeros. */
export function formatNumber(n: number): string {
  if (Number.isInteger(n)) return String(n);
  return String(Number(n.toPrecision(12)));
}

const NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)$/;

/** The number `text` spells, or null (no exponents, no `+` noise beyond CSS's own). */
export function parseNumberText(text: string): number | null {
  return NUMBER.test(text) ? Number(text) : null;
}
