/**
 * Episodic anchor resolution — one policy for turning a model's free-text
 * `when` phrase into the `occurredAt` / `narrativeTime` pair stamped on a
 * memory row.
 *
 * Called once, by the extraction pass runner (`lib/memory/extraction/run.ts`),
 * with the anchors each pass names: the turn passes resolve against the source
 * message's timestamp and fall back to the same stamp; the fold passes resolve
 * against the stretch's newest message (the episode pass falling back to its
 * oldest).
 * Pure: no I/O, no clock — callers supply every timestamp.
 *
 * Kept apart from `clock.ts` so it reaches `resolveWhenPhrase` through the
 * module boundary (a suite can substitute that parser).
 *
 * @module memory/time/anchors
 */

import { resolveWhenPhrase } from './clock'

export interface EpisodicAnchorInput<F extends string | null = string | null> {
  /** The model's free-text time phrase; empty/absent means "not stated". */
  when: string | null | undefined
  /** The ISO instant the phrase is relative to ("yesterday" counts back from here). */
  referenceIso: string | null
  /** `occurredAt` when the phrase is absent, unresolvable, or there is nothing to resolve against. */
  fallbackIso: F
  timelineMode: 'realtime' | 'narrative'
  /** An explicit in-story stamp the caller already holds; outranks `when` as `narrativeTime`. */
  narrativeTime?: string | null
  /**
   * The memory-calendar zone to resolve `when` in — the one the extractor's
   * clock was rendered in. Absent, `resolveWhenPhrase`'s default (the cached
   * instance zone) applies.
   */
  timeZone?: string
}

/** `occurredAt` is only nullable when the fallback was. */
export interface EpisodicAnchors<F extends string | null = string | null> {
  occurredAt: string | F
  narrativeTime: string | null
}

/**
 * Resolve a memory's episodic anchors.
 *
 *  - `occurredAt` — `when` resolved against `referenceIso`; `fallbackIso`
 *    when the phrase is absent or does not resolve.
 *  - `narrativeTime` — in narrative mode the explicit stamp if given, else
 *    the raw `when` phrase (the in-story time IS the phrase); in realtime
 *    mode only the explicit stamp survives.
 */
export function resolveEpisodicAnchors<F extends string | null>(
  input: EpisodicAnchorInput<F>,
): EpisodicAnchors<F> {
  let occurredAt: string | F = input.fallbackIso
  if (input.when && input.referenceIso) {
    const resolved = input.timeZone
      ? resolveWhenPhrase(input.when, input.referenceIso, input.timeZone)
      : resolveWhenPhrase(input.when, input.referenceIso)
    if (resolved) occurredAt = resolved
  }
  const explicit = input.narrativeTime ?? null
  const narrativeTime =
    input.timelineMode === 'narrative' ? (explicit ?? (input.when ? input.when : null)) : explicit
  return { occurredAt, narrativeTime }
}
