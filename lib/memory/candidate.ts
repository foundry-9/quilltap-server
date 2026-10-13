/**
 * The memory candidate — the one shape every producer emits and the writer
 * accepts (memory refactor §3.2).
 *
 * An extractor's parser yields a `MemoryDraft` (what the model said: text,
 * keywords, importance, targeting, kind, `when`, entities). The producer that
 * knows who holds the memory, whom it is about and where it came from turns
 * the draft into a {@link MemoryCandidate} with {@link candidateFromDraft}; the
 * episode pass, the manual API and the others build one directly. The writer
 * turns a candidate into the gate's input with {@link toCreateMemoryOptions}.
 *
 *  - **Importance** is defaulted once, by the parser ({@link coerceImportance}):
 *    a number is clamped to [0, 1], anything else is 0.5. Nothing downstream
 *    defaults it again, so a model's 0 stays 0.
 *  - **Targeting tags** ride on the candidate as `targeting`, never inside
 *    `keywords`; {@link normaliseTargeting} is the one place a raw value
 *    becomes a tag. The row keeps storing them in `keywords` as it always has
 *    (the whisper and `parseTargetingTags` read them there) —
 *    {@link toCreateMemoryOptions} writes them in.
 *
 * Pure; safe in the forked job child.
 *
 * @module memory/candidate
 */

import { z } from 'zod'
import { MemoryKindEnum, MemorySourceEnum, WitnessedContextEnum } from '@/lib/schemas/memory.types'
import {
  CONTEXT_VALUES,
  DEFAULT_CONTEXT,
  DEFAULT_SCOPE,
  DEFAULT_TEMPORAL,
  SCOPE_VALUES,
  TEMPORAL_VALUES,
  type ContextTag,
  type ScopeTag,
  type TemporalTag,
} from './recall-tags'
import type { CreateMemoryOptions } from './memory-service'

// ---------------------------------------------------------------------------
// Targeting
// ---------------------------------------------------------------------------

export const TargetingTagsSchema = z.object({
  temporal: z.enum(['past', 'moment', 'present', 'future']),
  scope: z.enum(['narrow', 'wide']),
  context: z.enum(['philosophy', 'relationships', 'history', 'banter', 'mannerisms', 'trivia', 'information']),
})
export type TargetingTags = z.infer<typeof TargetingTagsSchema>

/** What an untagged memory reads as: present / wide / information. */
export const DEFAULT_TARGETING: TargetingTags = Object.freeze({
  temporal: DEFAULT_TEMPORAL,
  scope: DEFAULT_SCOPE,
  context: DEFAULT_CONTEXT,
}) as TargetingTags

function pick<T extends string>(raw: unknown, vocabulary: ReadonlySet<string>): T | undefined {
  const value = typeof raw === 'string' ? raw.trim().toLowerCase() : ''
  return vocabulary.has(value) ? (value as T) : undefined
}

/**
 * Normalise raw targeting values (a model's `temporal` / `scope` / `context`)
 * against the closed vocabularies. An invalid or missing value takes the
 * fallback's, else the default. The one normaliser for every producer.
 */
export function normaliseTargeting(
  raw: { temporal?: unknown; scope?: unknown; context?: unknown } | null | undefined,
  fallback: Partial<TargetingTags> = {},
): TargetingTags {
  return {
    temporal: pick<TemporalTag>(raw?.temporal, TEMPORAL_VALUES) ?? fallback.temporal ?? DEFAULT_TARGETING.temporal,
    scope: pick<ScopeTag>(raw?.scope, SCOPE_VALUES) ?? fallback.scope ?? DEFAULT_TARGETING.scope,
    context: pick<ContextTag>(raw?.context, CONTEXT_VALUES) ?? fallback.context ?? DEFAULT_TARGETING.context,
  }
}

/** The row's keyword form of the tags: bare temporal and context words, `scope: <value>`. */
export function targetingKeywords(targeting: TargetingTags): string[] {
  return [targeting.temporal, `scope: ${targeting.scope}`, targeting.context]
}

/**
 * Split a keyword list into free words and the targeting tags it carries
 * (the last of each axis wins, as `parseTargetingTags` reads them). For
 * producers whose model emits tags inside its keywords (consolidation).
 */
export function splitTargetingKeywords(keywords: readonly string[]): {
  free: string[]
  targeting: Partial<TargetingTags>
} {
  const free: string[] = []
  const targeting: Partial<TargetingTags> = {}
  for (const raw of keywords) {
    if (typeof raw !== 'string') continue
    const k = raw.trim()
    const lower = k.toLowerCase()
    if (lower.startsWith('scope:')) {
      const scope = pick<ScopeTag>(lower.slice('scope:'.length), SCOPE_VALUES)
      if (scope) targeting.scope = scope
      continue
    }
    const temporal = pick<TemporalTag>(lower, TEMPORAL_VALUES)
    if (temporal) {
      targeting.temporal = temporal
      continue
    }
    const context = pick<ContextTag>(lower, CONTEXT_VALUES)
    if (context) {
      targeting.context = context
      continue
    }
    if (k) free.push(k)
  }
  return { free, targeting }
}

// ---------------------------------------------------------------------------
// Importance
// ---------------------------------------------------------------------------

/** The one importance default: a finite number clamped to [0, 1], else 0.5. */
export function coerceImportance(raw: unknown): number {
  return typeof raw === 'number' && Number.isFinite(raw) ? Math.min(1, Math.max(0, raw)) : 0.5
}

// ---------------------------------------------------------------------------
// The candidate
// ---------------------------------------------------------------------------

const Id = z.string().min(1)

export const CandidatePassEnum = z.enum([
  'self-turn',
  'other-turn',
  'other-fold',
  'episode-fold',
  'carina',
  'manual',
  'consolidation',
  'import',
])
export type CandidatePass = z.infer<typeof CandidatePassEnum>

export const MemoryCandidateSchema = z.object({
  content: z.string().min(1),
  summary: z.string().min(1),
  /** Free words; targeting tags are NOT here. */
  keywords: z.array(z.string()).default([]),
  /**
   * The targeting tags. Null for an untagged memory (a hand-written one),
   * which reads as {@link DEFAULT_TARGETING} and stores no tag keywords.
   */
  targeting: TargetingTagsSchema.nullable(),
  /** The parser's default (0.5) is the only default. */
  importance: z.number().min(0).max(1),
  kind: MemoryKindEnum,
  /** The model's time phrase; the memory clock resolves it. */
  when: z.string().nullable(),
  entities: z.array(z.string()).max(12).default([]),
  /** Group-level tags (UUIDs) — the memory editor's, not the targeting ones. */
  tags: z.array(z.string()).default([]),
  subject: z.object({ holderId: Id, aboutId: Id.nullable() }),
  provenance: z.object({
    source: MemorySourceEnum,
    witnessedContext: WitnessedContextEnum.nullable(),
    chatId: Id.nullable(),
    projectId: Id.nullable(),
    sourceMessageId: Id.nullable(),
    /** The message clock (ms) the clock resolves `when` against; see {@link anchorTimeMsFrom}. */
    anchorTimeMs: z.number().finite(),
    pass: CandidatePassEnum,
  }),
})
export type MemoryCandidate = z.infer<typeof MemoryCandidateSchema>
export type MemoryCandidateInput = z.input<typeof MemoryCandidateSchema>

/** What a parser yields: the model's part of a candidate, before subject and provenance. */
export interface MemoryDraftLike {
  content?: string
  summary?: string
  keywords?: string[]
  importance?: number
  targeting?: TargetingTags
  kind?: 'semantic' | 'episodic'
  when?: string
  entities?: string[]
}

/**
 * The first of `isoCandidates` that parses as a time, in ms; else `fallbackMs`
 * (now). A source message with an empty or malformed timestamp still yields
 * a candidate rather than a NaN the schema refuses.
 */
export function anchorTimeMsFrom(
  isoCandidates: ReadonlyArray<string | null | undefined>,
  fallbackMs: number = Date.now(),
): number {
  for (const iso of isoCandidates) {
    if (!iso) continue
    const ms = Date.parse(iso)
    if (Number.isFinite(ms)) return ms
  }
  return fallbackMs
}

/**
 * The candidate for a parsed draft, given who holds it, whom it is about and
 * where it came from. Missing or blank text falls back to the other field.
 * Null when the draft cannot be a candidate (no text in either field, or a
 * value the schema refuses): the caller skips it, as the parser skips a draft
 * with neither field — it never aborts the turn.
 */
export function candidateFromDraft(
  draft: MemoryDraftLike,
  subject: MemoryCandidate['subject'],
  provenance: MemoryCandidate['provenance'],
): MemoryCandidate | null {
  const content = draft.content?.trim() ? draft.content : draft.summary?.trim() ? draft.summary : ''
  const summary = draft.summary?.trim() ? draft.summary : content
  const parsed = MemoryCandidateSchema.safeParse({
    content,
    summary,
    keywords: draft.keywords ?? [],
    // Idempotent on a parsed draft; a hand-built one still gets the defaults.
    targeting: normaliseTargeting(draft.targeting),
    importance: coerceImportance(draft.importance),
    kind: draft.kind === 'episodic' ? 'episodic' : 'semantic',
    when: draft.when ?? null,
    entities: (draft.entities ?? []).slice(0, 12),
    tags: [],
    subject,
    provenance,
  })
  return parsed.success ? parsed.data : null
}

/** The anchors the clock resolved for a candidate. */
export interface ResolvedCandidateTime {
  occurredAt: string | null
  narrativeTime: string | null
  /** The row's `createdAt` override (a source message's own time), when the producer has one. */
  sourceMessageTimestamp?: string
}

/**
 * The gate's input for a candidate (`toMemoryRow`): the targeting tags are
 * written into the row's keywords here, after the free words.
 */
export function toCreateMemoryOptions(
  candidate: MemoryCandidate,
  resolved: ResolvedCandidateTime,
): CreateMemoryOptions {
  return {
    characterId: candidate.subject.holderId,
    aboutCharacterId: candidate.subject.aboutId,
    chatId: candidate.provenance.chatId,
    projectId: candidate.provenance.projectId,
    content: candidate.content,
    summary: candidate.summary,
    keywords: candidate.targeting
      ? [...candidate.keywords, ...targetingKeywords(candidate.targeting)]
      : [...candidate.keywords],
    tags: [...candidate.tags],
    importance: candidate.importance,
    source: candidate.provenance.source,
    sourceMessageId: candidate.provenance.sourceMessageId ?? undefined,
    sourceMessageTimestamp: resolved.sourceMessageTimestamp,
    witnessedContext: candidate.provenance.witnessedContext,
    occurredAt: resolved.occurredAt,
    narrativeTime: resolved.narrativeTime,
    entities: [...candidate.entities],
    kind: candidate.kind,
  }
}
