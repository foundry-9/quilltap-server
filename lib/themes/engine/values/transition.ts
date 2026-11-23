/**
 * Theme engine — transitions: a list of `property duration [easing] [delay]`.
 * An empty list is `none`.
 *
 * Pure and browser-safe; `parse` returns null for anything it does not fully
 * understand (a `var()` part, a missing duration, `allow-discrete`).
 *
 * @module themes/engine/values/transition
 */

import { formatDuration, parseDuration, type Quantity } from './quantity';
import { isFunctionCall, splitTopLevel } from './split';

/** The named easings. */
export const EASING_KEYWORDS = ['ease', 'linear', 'ease-in', 'ease-out', 'ease-in-out', 'step-start', 'step-end'] as const;

export interface TransitionLayer {
  property: string;
  duration: Quantity;
  /** As written: a keyword or `cubic-bezier(…)` / `steps(…)` / `linear(…)`. */
  easing?: string;
  delay?: Quantity;
}

export interface Transition {
  layers: TransitionLayer[];
}

const isEasing = (w: string) =>
  (EASING_KEYWORDS as readonly string[]).includes(w.toLowerCase()) || (isFunctionCall(w) && /^(cubic-bezier|steps|linear)\(/i.test(w));

function parseLayer(text: string): TransitionLayer | null {
  const words = splitTopLevel(text, 'space');
  if (!words || words.length === 0) return null;
  let property: string | undefined;
  let duration: Quantity | undefined;
  let delay: Quantity | undefined;
  let easing: string | undefined;
  for (const w of words) {
    const time = parseDuration(w);
    if (time) {
      if (!duration) duration = time;
      else if (!delay) delay = time;
      else return null;
    } else if (isEasing(w)) {
      if (easing) return null;
      easing = w;
    } else if (/^-?[A-Za-z_][\w-]*$/.test(w) && w.toLowerCase() !== 'allow-discrete') {
      if (property || duration) return null;
      property = w;
    } else {
      return null;
    }
  }
  if (!property || !duration) return null;
  const layer: TransitionLayer = { property, duration };
  if (easing) layer.easing = easing;
  if (delay) layer.delay = delay;
  return layer;
}

export function parseTransition(value: string): Transition | null {
  const v = value.trim();
  if (v.toLowerCase() === 'none') return { layers: [] };
  const parts = splitTopLevel(v, ',');
  if (!parts || parts.some((p) => p === '')) return null;
  const layers: TransitionLayer[] = [];
  for (const p of parts) {
    const layer = parseLayer(p);
    if (!layer) return null;
    layers.push(layer);
  }
  return { layers };
}

export function formatTransition(t: Transition): string {
  if (t.layers.length === 0) return 'none';
  return t.layers
    .map((l) => [l.property, formatDuration(l.duration), l.easing, l.delay ? formatDuration(l.delay) : undefined].filter(Boolean).join(' '))
    .join(', ');
}
