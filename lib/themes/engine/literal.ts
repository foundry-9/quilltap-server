/**
 * Theme engine — a token's value as a literal.
 *
 * Follows `var()` references through a resolved theme's values (one mode),
 * Tailwind's `--color-*` names and the registry, honouring fallbacks, and
 * returns the value with every reference substituted. What the picker's
 * swatches, the editor's swatches and the contrast check read. Pure and
 * browser-safe.
 *
 * @module themes/engine/literal
 */

import { tailwindAlias } from '../registry/tailwind';
import { substituteVars } from '../snapshot/var-substitute';
import type { ResolvedValue } from './resolve';

/**
 * `name` resolved to a literal through `values`, or null when a reference
 * along the way has no value and no fallback.
 */
export function resolveLiteral(values: Record<string, ResolvedValue>, name: string): string | null {
  const lookup = (n: string): string | undefined => {
    if (values[n]) return values[n].value;
    const alias = tailwindAlias(n);
    return alias ? `var(${alias})` : undefined;
  };
  return substituteVars(`var(${name})`, lookup);
}
