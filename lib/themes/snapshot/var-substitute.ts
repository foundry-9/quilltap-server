/**
 * `var()` substitution over plain strings — no PostCSS, no file access.
 *
 * Shared by the root-element cascade (./cascade.ts), the theme engine's
 * compile step and the browser-side preview (engine/client.ts), which is
 * why it lives apart from the PostCSS-based cascade.
 *
 * @module themes/snapshot/var-substitute
 */

export class InvalidValue extends Error {}

/** Normalise whitespace and drop comments, as the snapshot stores values. */
export function normaliseValue(value: string): string {
  return value.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ').trim();
}

export interface VarCall {
  start: number;
  end: number;
  name: string;
  fallback: string | null;
}

/**
 * The next `var(…)` at or after `from`, outside quoted strings: its span, the
 * referenced name and the fallback (everything after the first top-level
 * comma, or null when there is no comma).
 */
export function findVarCall(value: string, from: number): VarCall | null {
  let quote: string | null = null;
  for (let i = from; i < value.length; i++) {
    const ch = value[i];
    if (ch === '\\') {
      i++;
      continue;
    }
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (!/^var\(/i.test(value.slice(i, i + 4)) || /[\w-]/.test(value[i - 1] ?? '')) continue;
    let depth = 0;
    let comma = -1;
    let inner: string | null = null;
    for (let j = i + 3; j < value.length; j++) {
      const c = value[j];
      if (c === '\\') {
        j++;
        continue;
      }
      if (inner) {
        if (c === inner) inner = null;
        continue;
      }
      if (c === '"' || c === "'") inner = c;
      else if (c === '(') depth++;
      else if (c === ')') {
        depth--;
        if (depth === 0) {
          const name = value.slice(i + 4, comma >= 0 ? comma : j).trim();
          const fallback = comma >= 0 ? value.slice(comma + 1, j) : null;
          return { start: i, end: j + 1, name, fallback };
        }
      } else if (c === ',' && depth === 1 && comma < 0) comma = j;
    }
    throw new InvalidValue(`unbalanced var( in: ${value}`);
  }
  return null;
}

/**
 * Substitute every `var()` in `value` from `lookup` (recursively, honouring
 * fallbacks). Returns null when a reference has no value and no fallback.
 * Used by the Spec A fit report to evaluate registry formulas against a
 * theme's own values.
 */
export function substituteVars(value: string, lookup: (name: string) => string | undefined, depth = 0): string | null {
  if (depth > 32) return null;
  let out = '';
  let i = 0;
  try {
    while (i < value.length) {
      const call = findVarCall(value, i);
      if (!call) {
        out += value.slice(i);
        break;
      }
      const found = lookup(call.name);
      const replacement =
        found !== undefined
          ? substituteVars(found, lookup, depth + 1)
          : call.fallback !== null
            ? substituteVars(call.fallback, lookup, depth + 1)
            : null;
      if (replacement === null) return null;
      out += value.slice(i, call.start) + replacement;
      i = call.end;
    }
  } catch (error) {
    if (error instanceof InvalidValue) return null;
    throw error;
  }
  return normaliseValue(out);
}
