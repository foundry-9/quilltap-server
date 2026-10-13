/**
 * The extraction parsers (memory refactor §3.7): one family, every pass.
 *
 * Each parser turns a cheap model's raw answer into `MemoryDraft`s — the
 * model's half of a `MemoryCandidate` (`lib/memory/candidate.ts`), which the
 * pass runner completes with subject and provenance. A malformed answer yields
 * nothing; a malformed item is skipped alone.
 *
 * Caps are one rule per pass ({@link passCap}): the pass's own base, clamped by
 * the call's output budget. The SELF and OTHER prompts promise one slot beyond
 * the cap for a dated or placed EVENT ({@link EVENT_EXTRA_SLOT}), and the
 * parsers honour it — at turn and fold grain alike.
 *
 * @module memory/extraction/parse
 */

import { stripCodeFences } from '@/lib/llm/llm-json'
import { coerceImportance, normaliseTargeting, type TargetingTags } from '../candidate'
import type { MemoryDraft } from '../cheap-llm-tasks/types'

/**
 * Hard ceiling on candidates from one per-turn call (per subject, for OTHER),
 * whatever the output budget. The base of the turn passes' {@link passCap}.
 */
export const HARD_CANDIDATE_CAP = 2

/** Extra candidate slot granted only when a dated/placed EVENT is present. */
export const EVENT_EXTRA_SLOT = 1

/** Output tokens one candidate slot is budgeted. */
const TOKENS_PER_CANDIDATE_SLOT = 8000

/** Most entities a parsed draft keeps. */
const DRAFT_ENTITY_CAP = 8

/**
 * The cap of one call: `min(base, ceil(maxTokens / 8000))`, never below 1. The
 * turn passes' base is {@link HARD_CANDIDATE_CAP}; the fold OTHER pass's is
 * `foldCandidatesPerSubject`; the episode pass's is `FOLD_EPISODE_CAP`.
 */
export function passCap(base: number, maxTokens: number | undefined): number {
  const budget = Math.ceil((maxTokens ?? TOKENS_PER_CANDIDATE_SLOT) / TOKENS_PER_CANDIDATE_SLOT)
  return Math.max(1, Math.min(Math.max(1, Math.floor(base)), budget))
}

/** True when a draft is a dated/placed EVENT that earns the extra slot. */
function isAnchoredEvent(d: MemoryDraft): boolean {
  return d.kind === 'episodic' && (!!d.when || (d.entities?.length ?? 0) > 0)
}

/**
 * The cap with the episodic soft-raise: `cap` drafts always, one more only
 * when a dated/placed EVENT survives inside the raised window.
 */
export function capWithEventSlot(drafts: MemoryDraft[], cap: number): MemoryDraft[] {
  const raised = drafts.slice(0, cap + EVENT_EXTRA_SLOT)
  if (raised.length > cap && raised.some(isAnchoredEvent)) return raised
  return drafts.slice(0, cap)
}

function parseJsonItems(raw: string): unknown[] | null {
  try {
    const parsed = JSON.parse(stripCodeFences(raw))
    return Array.isArray(parsed) ? parsed : [parsed]
  } catch {
    return null
  }
}

function strings(value: unknown, cap: number): string[] {
  return Array.isArray(value)
    ? (value as unknown[])
        .filter((e): e is string => typeof e === 'string' && e.trim().length > 0)
        .map(e => e.trim())
        .slice(0, cap)
    : []
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined
}

/**
 * One raw SELF/OTHER item as a draft, or null when it has neither content nor
 * summary. Importance and targeting go through the candidate's own
 * normalisers, so the parser holds no default of its own.
 */
export function coerceMemoryDraft(item: Record<string, unknown>): MemoryDraft | null {
  const rawKind = typeof item.kind === 'string' ? item.kind.trim().toLowerCase() : ''
  const entities = Array.isArray(item.entities) ? strings(item.entities, DRAFT_ENTITY_CAP) : undefined
  const draft: MemoryDraft = {
    content: typeof item.content === 'string'
      ? item.content
      : (item.content ? JSON.stringify(item.content) : undefined),
    summary: typeof item.summary === 'string'
      ? item.summary
      : (item.summary ? JSON.stringify(item.summary) : undefined),
    keywords: Array.isArray(item.keywords)
      ? (item.keywords as unknown[]).filter((k): k is string => typeof k === 'string')
      : [],
    importance: coerceImportance(item.importance),
    targeting: normaliseTargeting(item),
    kind: rawKind === 'episodic' ? 'episodic' : 'semantic',
    when: optionalString(item.when),
    entities,
  }
  if (!draft.content && !draft.summary) return null
  return draft
}

/** The SELF parser: a flat array, capped with the event slot. */
export function parseSelfDrafts(raw: string, cap: number): MemoryDraft[] {
  const items = parseJsonItems(raw)
  if (!items) return []
  const drafts = items
    .map(item => (item && typeof item === 'object' ? coerceMemoryDraft(item as Record<string, unknown>) : null))
    .filter((d): d is MemoryDraft => d !== null)
  return capWithEventSlot(drafts, cap)
}

/**
 * The multi-subject OTHER parser: routes each item to its subject by 1-based
 * `subjectIndex` (`subjectIds[i - 1]`); items with a missing or invalid index
 * are dropped. Each subject's bucket is capped with the event slot. Every
 * subject appears in the map, empty when it yielded nothing.
 */
export function parseOtherDraftsBySubject(
  raw: string,
  subjectIds: ReadonlyArray<string>,
  cap: number,
): Map<string, MemoryDraft[]> {
  const result = new Map<string, MemoryDraft[]>()
  for (const id of subjectIds) result.set(id, [])
  if (subjectIds.length === 0) return result
  const items = parseJsonItems(raw)
  if (!items) return result

  const collectCap = cap + EVENT_EXTRA_SLOT
  for (const rawItem of items) {
    if (!rawItem || typeof rawItem !== 'object') continue
    const item = rawItem as Record<string, unknown>
    const idx = typeof item.subjectIndex === 'number' ? item.subjectIndex : NaN
    if (!Number.isInteger(idx) || idx < 1 || idx > subjectIds.length) continue
    const bucket = result.get(subjectIds[idx - 1])
    if (!bucket || bucket.length >= collectCap) continue
    const draft = coerceMemoryDraft(item)
    if (draft) bucket.push(draft)
  }
  for (const id of subjectIds) result.set(id, capWithEventSlot(result.get(id) ?? [], cap))
  return result
}

/** The targeting every episode carries: a past, narrow piece of history. */
export const EPISODE_TARGETING: TargetingTags = Object.freeze({ temporal: 'past', scope: 'narrow', context: 'history' })

/** Importance bounds and default of an episode record. */
const EPISODE_IMPORTANCE = { min: 0.2, max: 1, default: 0.6 } as const

/**
 * The episode parser: `{ narrative, summary, when, narrativeTime, entities,
 * importance }` items as episodic drafts. The narrative is the content; the
 * summary defaults to its first 60 characters; importance is clamped to
 * [0.2, 1] (0.6 when absent); the entities double as the free keywords. No
 * event slot — the episode prompt promises none.
 */
export function parseEpisodeDrafts(raw: string, cap: number): MemoryDraft[] {
  const items = parseJsonItems(raw)
  if (!items) return []
  const drafts: MemoryDraft[] = []
  for (const rawItem of items) {
    if (drafts.length >= cap) break
    if (!rawItem || typeof rawItem !== 'object') continue
    const item = rawItem as Record<string, unknown>
    const narrative = typeof item.narrative === 'string' ? item.narrative.trim() : ''
    if (!narrative) continue
    const entities = strings(item.entities, DRAFT_ENTITY_CAP)
    drafts.push({
      content: narrative,
      summary: optionalString(item.summary) ?? narrative.slice(0, 60),
      keywords: entities.map(e => e.toLowerCase()),
      importance: typeof item.importance === 'number' && Number.isFinite(item.importance)
        ? Math.min(EPISODE_IMPORTANCE.max, Math.max(EPISODE_IMPORTANCE.min, item.importance))
        : EPISODE_IMPORTANCE.default,
      targeting: EPISODE_TARGETING,
      kind: 'episodic',
      when: optionalString(item.when),
      narrativeTime: optionalString(item.narrativeTime),
      entities,
    })
  }
  return drafts
}
