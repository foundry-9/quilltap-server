/**
 * Theme engine — box shadows: a list of layers, each `[inset] x y [blur
 * [spread]] [colour]`. An empty list is `none`.
 *
 * The colour is kept as written (`rgb(0 0 0 / 0.1)`, `color-mix(…)`,
 * `var(--p-glow)`); offsets may be `var()` references. Pure and
 * browser-safe; `parse` returns null for anything it does not fully
 * understand (a lone `var()`, a `calc()` offset, five lengths).
 *
 * @module themes/engine/values/shadow
 */

import { parseColor } from '../../color';
import { isColorKeyword } from '../type-check';
import { formatLength, parseLength, type LengthPart } from './length';
import { isFunctionCall, isVarReference, splitTopLevel } from './split';

export interface ShadowLayer {
  inset: boolean;
  x: LengthPart;
  y: LengthPart;
  blur?: LengthPart;
  spread?: LengthPart;
  /** As written; absent means `currentcolor`. */
  color?: string;
}

export interface Shadow {
  layers: ShadowLayer[];
}

const ZERO: LengthPart = { kind: 'number', number: 0, unit: '' };

/** A new layer for an editor's "add": a soft drop shadow. */
export function defaultShadowLayer(): ShadowLayer {
  return { inset: false, x: ZERO, y: { kind: 'number', number: 2, unit: 'px' }, blur: { kind: 'number', number: 6, unit: 'px' }, color: 'rgb(0 0 0 / 0.15)' };
}

function isColorWord(part: string): boolean {
  if (isVarReference(part)) return true;
  if (isFunctionCall(part)) return !/^(calc|clamp|min|max|env)\(/i.test(part);
  return parseColor(part) !== null || isColorKeyword(part);
}

function parseLayer(text: string): ShadowLayer | null {
  const words = splitTopLevel(text, 'space');
  if (!words || words.length === 0) return null;
  let inset = false;
  if (words[0].toLowerCase() === 'inset') {
    inset = true;
    words.shift();
  } else if (words[words.length - 1].toLowerCase() === 'inset') {
    inset = true;
    words.pop();
  }
  let color: string | undefined;
  // A colour leads or trails the lengths; a trailing var() is the colour once two lengths stand before it.
  const lengthsBefore = (n: number) => words.slice(0, n).every((w) => parseLength(w, { keywords: false }) !== null);
  const last = words[words.length - 1];
  if (words.length >= 3 && isColorWord(last) && (!isVarReference(last) || lengthsBefore(words.length - 1))) {
    color = words.pop();
  } else if (words.length >= 3 && !isVarReference(words[0]) && isColorWord(words[0])) {
    color = words.shift();
  }
  if (words.length < 2 || words.length > 4) return null;
  const lengths: LengthPart[] = [];
  for (const w of words) {
    const l = parseLength(w, { keywords: false });
    if (!l) return null;
    lengths.push(l);
  }
  if (words.some((w) => w.toLowerCase() === 'inset')) return null;
  const [x, y, blur, spread] = lengths;
  const layer: ShadowLayer = { inset, x, y };
  if (blur) layer.blur = blur;
  if (spread) layer.spread = spread;
  if (color !== undefined) layer.color = color;
  return layer;
}

export function parseShadow(value: string): Shadow | null {
  const v = value.trim();
  if (v.toLowerCase() === 'none') return { layers: [] };
  if (isVarReference(v)) return null;
  const parts = splitTopLevel(v, ',');
  if (!parts || parts.some((p) => p === '')) return null;
  const layers: ShadowLayer[] = [];
  for (const p of parts) {
    const layer = parseLayer(p);
    if (!layer) return null;
    layers.push(layer);
  }
  return { layers };
}

function formatLayer(layer: ShadowLayer): string {
  const parts = [formatLength(layer.x), formatLength(layer.y)];
  if (layer.blur || layer.spread) parts.push(formatLength(layer.blur ?? ZERO));
  if (layer.spread) parts.push(formatLength(layer.spread));
  if (layer.inset) parts.unshift('inset');
  if (layer.color !== undefined && layer.color.trim() !== '') parts.push(layer.color.trim());
  return parts.join(' ');
}

export function formatShadow(shadow: Shadow): string {
  return shadow.layers.length === 0 ? 'none' : shadow.layers.map(formatLayer).join(', ');
}
