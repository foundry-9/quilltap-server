/**
 * Theme engine — single numbers: durations, opacities, z-indexes and font
 * weights.
 *
 * Each `parse` returns null for anything it does not fully understand
 * (a `var()`, `calc()`, an exponent); each `format` writes the value back.
 * Pure and browser-safe.
 *
 * @module themes/engine/values/quantity
 */

import { formatNumber, parseNumberText } from './split';

/** A number and its unit (`''` for none). */
export interface Quantity {
  number: number;
  unit: string;
}

function parseWithUnits(value: string, units: readonly string[]): Quantity | null {
  const v = value.trim();
  const m = /^([+-]?(?:\d+\.?\d*|\.\d+))([a-z%]*)$/i.exec(v);
  if (!m) return null;
  const number = parseNumberText(m[1]);
  const unit = m[2].toLowerCase();
  if (number === null || !units.includes(unit)) return null;
  return { number, unit };
}

const formatQuantity = (q: Quantity) => `${formatNumber(q.number)}${q.unit}`;

/** The units a duration may carry. */
export const DURATION_UNITS = ['ms', 's'] as const;

/** `150ms`, `1.2s`. */
export function parseDuration(value: string): Quantity | null {
  const q = parseWithUnits(value, DURATION_UNITS);
  return q && q.number >= 0 ? q : null;
}
export const formatDuration = formatQuantity;

/** `0.6` or `40%`, between nothing and all. */
export function parseOpacity(value: string): Quantity | null {
  const q = parseWithUnits(value, ['', '%']);
  if (!q || q.number < 0) return null;
  return q.number <= (q.unit === '%' ? 100 : 1) ? q : null;
}
export const formatOpacity = formatQuantity;

/** An opacity as a fraction of 1, whichever way it is written. */
export function opacityFraction(q: Quantity): number {
  return q.unit === '%' ? q.number / 100 : q.number;
}

/** An integer such as `50`, or `auto`. */
export function parseZIndex(value: string): { kind: 'auto' } | { kind: 'number'; number: number } | null {
  const v = value.trim();
  if (v === 'auto') return { kind: 'auto' };
  return /^-?\d+$/.test(v) ? { kind: 'number', number: Number(v) } : null;
}
export function formatZIndex(z: NonNullable<ReturnType<typeof parseZIndex>>): string {
  return z.kind === 'auto' ? 'auto' : String(z.number);
}

/** The named font weights, as CSS spells them. */
export const FONT_WEIGHT_KEYWORDS = ['normal', 'bold', 'bolder', 'lighter'] as const;
export type FontWeight = { kind: 'number'; number: number } | { kind: 'keyword'; word: (typeof FONT_WEIGHT_KEYWORDS)[number] };

/** `400`, `bold`. */
export function parseFontWeight(value: string): FontWeight | null {
  const v = value.trim();
  const word = FONT_WEIGHT_KEYWORDS.find((k) => k === v.toLowerCase());
  if (word) return { kind: 'keyword', word };
  if (!/^\d{1,4}$/.test(v)) return null;
  const n = Number(v);
  return n >= 1 && n <= 1000 ? { kind: 'number', number: n } : null;
}
export function formatFontWeight(w: FontWeight): string {
  return w.kind === 'keyword' ? w.word : String(w.number);
}
