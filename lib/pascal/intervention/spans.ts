/**
 * Operator intervention — what a roll or value could have been.
 *
 * The engine reports a {@link RunSpan} for the raw draw and for the value after
 * modifiers; the hold dialog prints them beside the fields, and recompute warns
 * when a pin lands outside one. One phrasing for both, here.
 *
 * Client-safe: no imports beyond types.
 */

import type { RunSpan } from '../custom-tools';

/** Integers plain, floats to 4 significant digits — the way Pascal prints numbers. */
function formatSpanNumber(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Number(n.toPrecision(4)));
}

/** Whether a number falls inside a span, honouring its open ends. */
export function withinSpan(n: number, span: RunSpan): boolean {
  const aboveLow = span.minExclusive ? n > span.min : n >= span.min;
  const belowHigh = span.maxExclusive ? n < span.max : n <= span.max;
  return aboveLow && belowHigh;
}

/**
 * A span in words: "exactly 5", "1 to 20", "1 up to (not including) 21",
 * "more than -42, up to -2".
 */
export function describeSpan(span: RunSpan): string {
  const min = formatSpanNumber(span.min);
  const max = formatSpanNumber(span.max);
  if (span.min === span.max && !span.minExclusive && !span.maxExclusive) return `exactly ${min}`;
  if (span.minExclusive) return `more than ${min}, up to ${span.maxExclusive ? `(not including) ${max}` : max}`;
  if (span.maxExclusive) return `${min} up to (not including) ${max}`;
  return `${min} to ${max}`;
}
