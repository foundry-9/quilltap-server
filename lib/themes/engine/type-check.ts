/**
 * Theme engine — does a value fit its token type?
 *
 * The one type check, shared by validation (./validate.ts, the judge on save
 * and install) and the theme editor (through ./client.ts), so the editor
 * shows the message the server would return. Browser-safe: it reaches
 * neither PostCSS nor the file system.
 *
 * Literal values are checked where that is cheap and certain; a value with a
 * function in it (`var()`, `calc()`, `color-mix()`) is not second-guessed,
 * and neither is a CSS-wide keyword. A keyword token with `options` refuses
 * any other word (Spec E, decision 7).
 *
 * @module themes/engine/type-check
 */

import { parseColor } from '../color';
import type { TokenType } from '../registry/types';

/** The CSS-wide keywords every property accepts. */
export const CSS_WIDE_KEYWORDS: ReadonlySet<string> = new Set(['inherit', 'initial', 'unset', 'revert', 'revert-layer']);
const COLOR_KEYWORDS = new Set(['currentcolor', 'transparent', 'canvas', 'canvastext', 'linktext', 'buttonface', 'buttontext', 'highlight', 'highlighttext', 'graytext', 'field', 'fieldtext', 'mark', 'marktext', 'accentcolor', 'accentcolortext']);
/** Words a length or radius may be instead of a number and unit. */
export const LENGTH_KEYWORDS: ReadonlySet<string> = new Set(['auto', 'none', 'normal', 'fit-content', 'min-content', 'max-content', 'thin', 'medium', 'thick']);
/** The units a length may carry. */
export const LENGTH_UNITS = ['px', 'rem', 'em', '%', 'vh', 'vw', 'vmin', 'vmax', 'svh', 'lvh', 'dvh', 'svw', 'lvw', 'dvw', 'ch', 'ex', 'cap', 'ic', 'lh', 'rlh', 'pt', 'pc', 'cm', 'mm', 'q', 'in', 'cqw', 'cqh', 'cqi', 'cqb', 'cqmin', 'cqmax'] as const;
/** True for a colour keyword such as `transparent` or `currentcolor`. */
export function isColorKeyword(word: string): boolean {
  return COLOR_KEYWORDS.has(word.toLowerCase());
}
const LENGTH = new RegExp(`^-?(\\d+\\.?\\d*|\\.\\d+)(${LENGTH_UNITS.join('|')})$`, 'i');

/** Null when `value` is acceptable for `type`, else why not. */
export function typeProblem(type: TokenType, value: string, options?: readonly string[]): string | null {
  const v = value.trim();
  if (v.includes('(') || CSS_WIDE_KEYWORDS.has(v.toLowerCase())) return null;
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
    case 'keyword':
      return !options || options.includes(v) ? null : `"${v}" is not one of ${options.map((o) => `"${o}"`).join(', ')}`;
    default:
      return null;
  }
}
