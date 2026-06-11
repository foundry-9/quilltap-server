/**
 * Recall-side targeting-tag reading.
 *
 * The memory extractor (`lib/memory/cheap-llm-tasks/memory-tasks.ts`) materializes
 * three controlled targeting tags into every memory's `keywords` array:
 *   - temporal : bare word  — past | moment | present | future
 *   - scope    : `scope: narrow` | `scope: wide`
 *   - context  : bare word  — philosophy | relationships | history | banter |
 *                              mannerisms | trivia | information
 *
 * This module reads them back at recall time and turns them into bounded,
 * clamped multipliers on the already-computed blended recall score. It is the
 * single source of truth for the closed vocabularies — the extraction path
 * imports the Sets from here, so the two sides can never drift.
 *
 * Pure + I/O-free — no logging, no DB, no LLM — so it is trivially unit-testable
 * and safe to import from the forked job child.
 */

export type TemporalTag = 'past' | 'moment' | 'present' | 'future'
export type ScopeTag = 'narrow' | 'wide'
export type ContextTag =
  | 'philosophy'
  | 'relationships'
  | 'history'
  | 'banter'
  | 'mannerisms'
  | 'trivia'
  | 'information'

/** Closed vocabularies for the three targeting axes (single source of truth). */
export const TEMPORAL_VALUES: ReadonlySet<string> = new Set<TemporalTag>([
  'past',
  'moment',
  'present',
  'future',
])
export const SCOPE_VALUES: ReadonlySet<string> = new Set<ScopeTag>(['narrow', 'wide'])
export const CONTEXT_VALUES: ReadonlySet<string> = new Set<ContextTag>([
  'philosophy',
  'relationships',
  'history',
  'banter',
  'mannerisms',
  'trivia',
  'information',
])

/**
 * Defaults MUST match the extraction-side defaults in `applyTargetingTags`
 * (memory-tasks.ts). A legacy/untagged memory therefore reads as
 * present / wide / information and is never penalized for missing data.
 */
export const DEFAULT_TEMPORAL: TemporalTag = 'present'
export const DEFAULT_SCOPE: ScopeTag = 'wide'
export const DEFAULT_CONTEXT: ContextTag = 'information'

export interface TargetingTags {
  temporal: TemporalTag
  scope: ScopeTag
  context: ContextTag
}

/** Policy for what to do with a cross-project `scope: narrow` memory at recall. */
export type ScopePolicy = 'down-weight' | 'exclude'

/**
 * Per-turn recall context threaded from the chat/turn into
 * `searchMemoriesSemantic`. Absent → recall behaves byte-identically to its
 * historical (pre-targeting) form.
 *
 * Phase 1 wires `currentProjectId` + `scopePolicy`. The remaining fields are
 * Phase 2 (context steering, participant boost, related-memory expansion) and
 * are added when those items land.
 */
export interface RecallContext {
  /** The current chat's project (`chat.projectId`), or null when project-less. */
  currentProjectId: string | null
  /** What to do with a cross-project `scope: narrow` memory. */
  scopePolicy: ScopePolicy
}

/**
 * Tunable multiplier constants. Starting values — verify against real chats via
 * the per-turn debug output before tightening.
 */
export const RECALL_MULTIPLIERS = {
  /** `scope: narrow` memory whose project matches the current chat. */
  scopeNarrowSameProject: 1.15,
  /** Cross-project `scope: narrow` under the `down-weight` policy. */
  scopeNarrowCrossProjectDownWeight: 0.15,
  /** `temporal: past` — history still matters, but rarely should outrank a live fact. */
  temporalPast: 0.85,
  /** `temporal: moment` — true only at one instant (see note in temporalMultiplier). */
  temporalMoment: 0.7,
} as const

/** Clamp on the *combined* multiplier so no single memory can explode the ranking. */
export const MULTIPLIER_CLAMP = { min: 0, max: 4 } as const

/** Result of a single adjustment: its multiplier plus a short debug label list. */
export interface RecallMultiplier {
  multiplier: number
  /** Short labels (e.g. `narrow✓`, `past↓`) for the per-turn debug log/whisper. */
  fired: string[]
  /** True only for the cross-project narrow + `exclude` policy case. */
  exclude?: boolean
}

/** Combined recall adjustment for one memory, clamped and ready to apply. */
export interface CombinedRecallAdjustment {
  multiplier: number
  fired: string[]
  exclude: boolean
}

/** Minimal structural view of a memory this module needs (keeps it Memory-import-free). */
interface MemoryTagView {
  projectId?: string | null
  keywords?: readonly string[] | null
  aboutCharacterId?: string | null
}

/**
 * Parse the three targeting tags back out of a memory's keywords array.
 *
 * Mirrors the extraction-side materialization: `temporal`/`context` are bare
 * words, `scope` is `scope: <value>`. The extractor appends the real tags at the
 * END of the keywords array, so we iterate with last-match-wins — a free keyword
 * that happens to collide with a vocabulary word (e.g. a literal "history") is
 * overridden by the appended tag. Unknown/missing values fall back to the same
 * defaults the extractor uses.
 */
export function parseTargetingTags(
  keywords: readonly string[] | null | undefined,
): TargetingTags {
  let temporal: TemporalTag = DEFAULT_TEMPORAL
  let scope: ScopeTag = DEFAULT_SCOPE
  let context: ContextTag = DEFAULT_CONTEXT

  if (keywords) {
    for (const raw of keywords) {
      if (typeof raw !== 'string') continue
      const kw = raw.trim().toLowerCase()
      if (kw.startsWith('scope:')) {
        const value = kw.slice('scope:'.length).trim()
        if (SCOPE_VALUES.has(value)) scope = value as ScopeTag
      } else if (TEMPORAL_VALUES.has(kw)) {
        temporal = kw as TemporalTag
      } else if (CONTEXT_VALUES.has(kw)) {
        context = kw as ContextTag
      }
    }
  }

  return { temporal, scope, context }
}

/**
 * Item 1 — scope + project gating.
 *
 * - `scope: wide` → pass through (true regardless of project).
 * - `scope: narrow`, memory has no projectId → pass through (nothing to compare;
 *   never penalize on missing data).
 * - `scope: narrow`, memory's project === current chat's project → boost
 *   (this is exactly the story the memory belongs to).
 * - `scope: narrow`, memory's project differs from (or exists where the chat has
 *   none) → cross-project: exclude or strong down-weight per policy. A
 *   narrow-to-X memory should not surface in a different (or project-less) chat.
 */
export function scopeProjectMultiplier(
  tags: TargetingTags,
  memoryProjectId: string | null | undefined,
  currentProjectId: string | null | undefined,
  policy: ScopePolicy,
): RecallMultiplier {
  if (tags.scope !== 'narrow' || !memoryProjectId) {
    return { multiplier: 1, fired: [] }
  }
  if (currentProjectId && memoryProjectId === currentProjectId) {
    return { multiplier: RECALL_MULTIPLIERS.scopeNarrowSameProject, fired: ['narrow✓'] }
  }
  if (policy === 'exclude') {
    return { multiplier: 0, fired: ['narrow✗-exclude'], exclude: true }
  }
  return {
    multiplier: RECALL_MULTIPLIERS.scopeNarrowCrossProjectDownWeight,
    fired: ['narrow✗'],
  }
}

/**
 * Item 2 — temporal down-weighting.
 *
 * `past` facts rarely should outrank live ones; `moment` facts are true only at a
 * single instant. Recall always runs BEFORE the current turn's extraction, so any
 * recalled `moment` memory was produced on a prior turn — the spec's "only when
 * not the producing turn" condition is therefore always satisfied on this path,
 * and the penalty applies unconditionally. `present`/`future` pass through.
 */
export function temporalMultiplier(tags: TargetingTags): RecallMultiplier {
  if (tags.temporal === 'past') {
    return { multiplier: RECALL_MULTIPLIERS.temporalPast, fired: ['past↓'] }
  }
  if (tags.temporal === 'moment') {
    return { multiplier: RECALL_MULTIPLIERS.temporalMoment, fired: ['moment↓'] }
  }
  return { multiplier: 1, fired: [] }
}

/**
 * Combine every applicable recall multiplier for one memory into a single
 * clamped adjustment. Phase 1 wires scope+project (item 1) and temporal (item 2).
 * The product is clamped to {@link MULTIPLIER_CLAMP} so no single memory can
 * dominate the ranking. A cross-project narrow memory under the `exclude` policy
 * short-circuits to `{ exclude: true }`.
 */
export function combineRecallMultipliers(
  memory: MemoryTagView,
  ctx: RecallContext,
): CombinedRecallAdjustment {
  const tags = parseTargetingTags(memory.keywords)

  const scope = scopeProjectMultiplier(
    tags,
    memory.projectId,
    ctx.currentProjectId,
    ctx.scopePolicy,
  )
  if (scope.exclude) {
    return { multiplier: 0, fired: scope.fired, exclude: true }
  }

  const temporal = temporalMultiplier(tags)

  const product = scope.multiplier * temporal.multiplier
  const clamped = Math.max(
    MULTIPLIER_CLAMP.min,
    Math.min(MULTIPLIER_CLAMP.max, product),
  )

  return {
    multiplier: clamped,
    fired: [...scope.fired, ...temporal.fired],
    exclude: false,
  }
}
