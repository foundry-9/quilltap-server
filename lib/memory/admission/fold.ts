/**
 * `foldInto` — the one combine (memory refactor §3.6).
 *
 * Wherever one memory takes in what others knew — a candidate reinforcing a
 * row at admission, near-duplicate rows folded into a survivor — the plan is
 * worked out here, the same way:
 *
 *  - novel details from each absorbed source append to the survivor as `[+]`
 *    footnotes, judged against the content as it grows, up to the cap;
 *  - `reinforcementCount` grows by the absorbed sources' counts, as a **delta**
 *    (`incrementReinforcement(by)`), never an absolute total (bugs 182, 226);
 *  - entities union (case-insensitive, survivor's first) up to the cap;
 *  - links union, minus the survivor and every absorbed source;
 *  - the earliest `occurredAt` wins, a missing `narrativeTime` is filled;
 *  - `lastReinforcedAt` is the latest observation (the write never rewinds it);
 *  - the survivor is re-embedded when its embedded text changed — unless it was
 *    already at the footnote cap, where its vector stays frozen until
 *    consolidation rewrites it.
 *
 * Pure: `applyFold` (`apply.ts`) writes the plan.
 *
 * @module memory/admission/fold
 */

import type { Memory } from '@/lib/schemas/types'
import { appendCappedFootnotes, countReinforcementFootnotes } from '../reinforcement-footnotes'
import { extractNovelDetails } from './novel-details'

/** Bounds a fold respects. */
export interface FoldCaps {
  footnoteCap: number
  entityCap: number
}

/** What a fold takes from each absorbed source. */
export interface FoldSource {
  /** The absorbed row's id; absent for a candidate that never became a row. */
  id?: string
  content: string
  occurredAt?: string | null
  narrativeTime?: string | null
  entities?: string[] | null
  relatedMemoryIds?: string[] | null
  /** Observations the source stands for (a row's count; a candidate is 1). */
  reinforcementCount?: number | null
  /** When it was last observed; a row never reinforced was observed at creation. */
  lastReinforcedAt?: string | null
  createdAt?: string | null
}

/** The survivor fields a fold reads. */
export type FoldSurvivor = Pick<
  Memory,
  'id' | 'content' | 'occurredAt' | 'narrativeTime' | 'entities' | 'relatedMemoryIds' | 'lastReinforcedAt'
>

export interface FoldPlan {
  survivorId: string
  /** Details to append as `[+]` footnotes (already capped, in order). */
  footnotes: string[]
  /** The survivor's content with the footnotes appended. */
  content: string
  /** Links to add to the survivor. */
  addLinks: string[]
  /** Anchor fields that change. Never the count, its importance or its time. */
  patch: Partial<Pick<Memory, 'occurredAt' | 'narrativeTime' | 'entities'>>
  /** Observations to add to the survivor's count. */
  reinforcementDelta: number
  /** Latest observation time among survivor and sources. */
  reinforcedAt: string | null
  /** The survivor already carried the footnote cap. */
  atCap: boolean
  /** The embedded text changed and the survivor is not frozen at the cap. */
  reembed: boolean
}

function earliest(values: ReadonlyArray<string | null | undefined>): string | null {
  let best: string | null = null
  let bestMs = Infinity
  for (const value of values) {
    if (!value) continue
    const ms = Date.parse(value)
    if (!Number.isFinite(ms)) continue
    if (ms < bestMs) {
      bestMs = ms
      best = value
    }
  }
  return best
}

function latest(values: ReadonlyArray<string | null | undefined>): string | null {
  return values.filter((v): v is string => typeof v === 'string' && v.length > 0).sort().pop() ?? null
}

/** Work out what folding `absorbed` into `survivor` changes. */
export function foldInto(
  survivor: FoldSurvivor,
  absorbed: readonly FoldSource[],
  caps: FoldCaps,
): FoldPlan {
  const atCap = countReinforcementFootnotes(survivor.content) >= caps.footnoteCap

  // Footnotes, judged against the content as it grows so two sources carrying
  // the same detail append it once.
  let content = survivor.content
  const footnotes: string[] = []
  for (const source of absorbed) {
    const novel = extractNovelDetails(source.content, content)
    if (novel.length === 0) continue
    const next = appendCappedFootnotes(content, novel, caps.footnoteCap)
    content = next.content
    footnotes.push(...next.appended)
  }

  // Links: the sources' links, minus the group and what the survivor has.
  const group = new Set<string>([survivor.id])
  for (const source of absorbed) if (source.id) group.add(source.id)
  const existingLinks = new Set(survivor.relatedMemoryIds ?? [])
  const addLinks: string[] = []
  for (const id of absorbed.flatMap((s) => s.relatedMemoryIds ?? [])) {
    if (group.has(id) || existingLinks.has(id) || addLinks.includes(id)) continue
    addLinks.push(id)
  }

  const patch: FoldPlan['patch'] = {}
  const occurredAt = earliest([survivor.occurredAt, ...absorbed.map((s) => s.occurredAt)])
  if (occurredAt && occurredAt !== survivor.occurredAt) patch.occurredAt = occurredAt
  if (!survivor.narrativeTime) {
    const narrativeTime = absorbed.map((s) => s.narrativeTime).find((v): v is string => !!v && v.trim().length > 0)
    if (narrativeTime) patch.narrativeTime = narrativeTime
  }
  const entities = [...(survivor.entities ?? [])]
  const seen = new Set(entities.map((e) => e.toLowerCase()))
  for (const entity of absorbed.flatMap((s) => s.entities ?? [])) {
    if (entities.length >= caps.entityCap) break
    if (typeof entity !== 'string' || entity.trim().length === 0) continue
    if (seen.has(entity.toLowerCase())) continue
    seen.add(entity.toLowerCase())
    entities.push(entity)
  }
  if (entities.length > (survivor.entities ?? []).length) patch.entities = entities

  const reinforcementDelta = absorbed.reduce((sum, s) => sum + Math.max(1, s.reinforcementCount ?? 1), 0)
  const reinforcedAt = latest([
    survivor.lastReinforcedAt,
    ...absorbed.map((s) => s.lastReinforcedAt ?? s.createdAt),
  ])

  const embeddedTextChanged = content !== survivor.content || Object.keys(patch).length > 0
  return {
    survivorId: survivor.id,
    footnotes,
    content,
    addLinks,
    patch,
    reinforcementDelta,
    reinforcedAt,
    atCap,
    reembed: embeddedTextChanged && !atCap,
  }
}
