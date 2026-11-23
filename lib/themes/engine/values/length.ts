/**
 * Theme engine — lengths: a number and a unit, a keyword, or a `var()`
 * reference kept as written. Lengths and radii take one to four parts (a
 * radius per corner, a padding per side); blur is a length inside `blur()`.
 *
 * Pure and browser-safe. `parse` returns null for anything it does not fully
 * understand (`calc()`, `clamp()`, an elliptical radius).
 *
 * @module themes/engine/values/length
 */

import { LENGTH_KEYWORDS, LENGTH_UNITS } from '../type-check';
import { formatNumber, isVarReference, parseNumberText, splitTopLevel } from './split';

export type LengthPart =
  | { kind: 'number'; number: number; unit: string }
  | { kind: 'keyword'; word: string }
  | { kind: 'reference'; text: string };

/** One length part, or null. A unitless number is only allowed for zero. */
export function parseLength(value: string, options: { keywords?: boolean } = {}): LengthPart | null {
  const v = value.trim();
  if (isVarReference(v)) return { kind: 'reference', text: v };
  if (options.keywords !== false && LENGTH_KEYWORDS.has(v.toLowerCase())) return { kind: 'keyword', word: v.toLowerCase() };
  const m = /^([+-]?(?:\d+\.?\d*|\.\d+))([a-z%]*)$/i.exec(v);
  if (!m) return null;
  const number = parseNumberText(m[1]);
  if (number === null) return null;
  const unit = m[2].toLowerCase();
  if (unit === '') return number === 0 ? { kind: 'number', number: 0, unit: '' } : null;
  return (LENGTH_UNITS as readonly string[]).includes(unit) ? { kind: 'number', number, unit } : null;
}

export function formatLength(part: LengthPart): string {
  if (part.kind === 'reference') return part.text;
  if (part.kind === 'keyword') return part.word;
  return `${formatNumber(part.number)}${part.unit}`;
}

/** One to four space-separated length parts (radius corners, padding sides). */
export function parseLengthList(value: string, options: { keywords?: boolean } = {}): LengthPart[] | null {
  const parts = splitTopLevel(value.trim(), 'space');
  if (!parts || parts.length < 1 || parts.length > 4) return null;
  const out: LengthPart[] = [];
  for (const p of parts) {
    const parsed = parseLength(p, options);
    if (!parsed) return null;
    out.push(parsed);
  }
  return out;
}

export function formatLengthList(parts: readonly LengthPart[]): string {
  return parts.map(formatLength).join(' ');
}

/** A radius's four corners (top-left, top-right, bottom-right, bottom-left) from one to four parts. */
export function radiusCorners(parts: readonly LengthPart[]): [LengthPart, LengthPart, LengthPart, LengthPart] {
  const [a, b = a, c = a, d = b] = parts;
  return [a, b, c, d];
}

/** The shortest list of parts that writes the four corners. */
export function collapseCorners(corners: readonly [LengthPart, LengthPart, LengthPart, LengthPart]): LengthPart[] {
  const [a, b, c, d] = corners.map(formatLength);
  if (b === d) {
    if (a === c) return a === b ? [corners[0]] : [corners[0], corners[1]];
    return [corners[0], corners[1], corners[2]];
  }
  return [...corners];
}

export type Blur = { kind: 'none' } | { kind: 'blur'; length: LengthPart };

/** `none` or `blur(<length>)`. */
export function parseBlur(value: string): Blur | null {
  const v = value.trim();
  if (v.toLowerCase() === 'none') return { kind: 'none' };
  const m = /^blur\((.*)\)$/i.exec(v);
  if (!m || splitTopLevel(v, 'space')?.length !== 1) return null;
  const length = parseLength(m[1], { keywords: false });
  return length ? { kind: 'blur', length } : null;
}

export function formatBlur(blur: Blur): string {
  return blur.kind === 'none' ? 'none' : `blur(${formatLength(blur.length)})`;
}
