/**
 * Consolidation task — one LLM call per memory cluster.
 *
 * The consolidation job (`lib/memory/consolidation.ts`) hands this task a
 * cluster of a character's memories about one subject; the model binds them
 * into a few digest entries and says which notes are too distinct to fold
 * (memory-consolidation-and-tiers.md §C4).
 *
 * {@link ConsolidationOutputSchema} is the single source of truth for the
 * answer's shape. {@link validateConsolidationOutput} then enforces the
 * membership rules the schema cannot express:
 *
 *   - every `digests[].memberIds` entry must be one of the input handles;
 *   - every input appears in exactly one of `digests[].memberIds` or
 *     `keepStandalone` — an input listed twice is a failure, an input listed
 *     nowhere is treated as `keepStandalone`;
 *   - contradictions naming an unknown handle are dropped.
 *
 * A schema or rule failure fails the whole cluster: the caller skips it and
 * writes nothing for it — never a partial write.
 *
 * Members are presented to the model as short handles (`m1`, `m2`, …) rather
 * than 36-character UUIDs: echoing a handle is far more reliable than echoing a
 * UUID, and the caller maps handles back to ids.
 *
 * @module memory/cheap-llm-tasks/consolidation-tasks
 */

import { z } from 'zod'
import type { LLMMessage } from '@/lib/llm/base'
import type { CheapLLMSelection } from '@/lib/llm/cheap-llm'
import { parseLLMJsonObject } from '@/lib/llm/llm-json'
import { logger } from '@/lib/logger'
import { executeCheapLLMTask } from './core-execution'
import type { CheapLLMTaskResult, UncensoredFallbackOptions } from './types'

/** Task type recorded on the LLM log and the activity registry. */
export const CONSOLIDATION_TASK_TYPE = 'memory-consolidation'

/** Output-token ceiling for one cluster's answer (a 30-member cluster fits comfortably). */
const CONSOLIDATION_MAX_TOKENS = 4000

/** Longest member text shown to the model, in characters. */
const MEMBER_CONTENT_CHAR_CAP = 1200

// ============================================================================
// Schema — single source of truth for the model's answer
// ============================================================================

export const ConsolidationDigestSchema = z.object({
  /** Third person about the subject; first person ("I") for the self bucket. */
  content: z.string().trim().min(1),
  /** ≤ 12 words, lowercase, extractor style. */
  summary: z.string().trim().min(1),
  /** Free keywords plus the three targeting tags (recall-tags.ts vocabulary). */
  keywords: z.array(z.string()).default([]),
  /** 0.2–1.0 by the prompt; clamped by the caller. */
  importance: z.number().min(0).max(1),
  kind: z.enum(['semantic', 'episodic']).default('semantic'),
  /** Episodic only: earliest member event time. The caller recomputes it from the members. */
  occurredAt: z.string().nullable().optional(),
  /** Handles of the inputs this digest replaces. */
  memberIds: z.array(z.string().trim().min(1)).min(1),
})

export const ConsolidationContradictionSchema = z.object({
  olderId: z.string().trim().min(1),
  newerId: z.string().trim().min(1),
  note: z.string().default(''),
})

export const ConsolidationOutputSchema = z.object({
  digests: z.array(ConsolidationDigestSchema),
  keepStandalone: z.array(z.string().trim().min(1)).default([]),
  contradictions: z.array(ConsolidationContradictionSchema).default([]),
})

export type ConsolidationDigestOutput = z.infer<typeof ConsolidationDigestSchema>
export type ConsolidationContradiction = z.infer<typeof ConsolidationContradictionSchema>
export type ConsolidationOutput = z.infer<typeof ConsolidationOutputSchema>

/** A validated answer, still in handle space. */
export interface ValidatedConsolidation {
  digests: ConsolidationDigestOutput[]
  /** Explicit `keepStandalone` plus every input listed nowhere. */
  keepStandalone: string[]
  /** Contradictions whose handles are both inputs. */
  contradictions: ConsolidationContradiction[]
  /** Inputs the model listed nowhere (already folded into `keepStandalone`). */
  unlisted: string[]
}

export type ConsolidationValidation =
  | { ok: true; value: ValidatedConsolidation }
  | { ok: false; reason: string }

/**
 * Validate a parsed answer against the schema and the membership rules.
 * Pure — exported for tests and for the dry-run report.
 */
export function validateConsolidationOutput(
  raw: unknown,
  inputHandles: readonly string[],
): ConsolidationValidation {
  const parsed = ConsolidationOutputSchema.safeParse(raw)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    return {
      ok: false,
      reason: `schema: ${issue ? `${issue.path.join('.') || '(root)'} ${issue.message}` : 'invalid'}`,
    }
  }
  const output = parsed.data
  const inputs = new Set(inputHandles)
  const seen = new Map<string, string>()

  for (let d = 0; d < output.digests.length; d++) {
    for (const handle of output.digests[d].memberIds) {
      if (!inputs.has(handle)) {
        return { ok: false, reason: `digest ${d + 1} names unknown member "${handle}"` }
      }
      const prior = seen.get(handle)
      if (prior) {
        return { ok: false, reason: `member "${handle}" listed twice (${prior} and digest ${d + 1})` }
      }
      seen.set(handle, `digest ${d + 1}`)
    }
  }

  const standalone: string[] = []
  for (const handle of output.keepStandalone) {
    if (!inputs.has(handle)) {
      return { ok: false, reason: `keepStandalone names unknown member "${handle}"` }
    }
    const prior = seen.get(handle)
    if (prior) {
      if (prior === 'keepStandalone') continue // a repeat inside the same list is harmless
      return { ok: false, reason: `member "${handle}" listed twice (${prior} and keepStandalone)` }
    }
    seen.set(handle, 'keepStandalone')
    standalone.push(handle)
  }

  const unlisted = inputHandles.filter((h) => !seen.has(h))

  const contradictions = output.contradictions.filter(
    (c) => inputs.has(c.olderId) && inputs.has(c.newerId) && c.olderId !== c.newerId,
  )

  return {
    ok: true,
    value: {
      digests: output.digests,
      keepStandalone: [...standalone, ...unlisted],
      contradictions,
      unlisted,
    },
  }
}

// ============================================================================
// Prompt
// ============================================================================

/**
 * The stable system body. Everything that varies per call (holder, subject,
 * canon, the notes) lives in the user message, so this prefix stays
 * byte-identical across every cluster of a run and providers' prefix caches hit.
 */
export const CONSOLIDATION_SYSTEM_PROMPT = `You are the binder of a character's Commonplace Book — the private ledger
in which the HOLDER keeps what they know. Over many conversations the ledger
has filled with loose slips about one SUBJECT, written a line at a time, the
same thread often set down five times in five sets of words. Your office is
to bind related slips into a few well-made entries, so the book reads like a
memory and not a drawer of scraps.

You will be given numbered NOTES (handles m1, m2, …), oldest first, each as
  handle | when it happened | importance | times observed | text
and, sometimes, an EXISTING DIGEST: an entry already bound from earlier notes.

THE RULES OF THE BINDERY
- Combine; do not summarize away specifics. Names, dates, numbers, places,
  and quoted promises survive the binding — they are the point of keeping
  a book at all.
- Newer wins on conflict. A digest states the current truth. Where the
  change itself matters, say so: "prefers tea now; preferred coffee until
  late August". Record each such conflict in "contradictions".
- Ephemera — a meal, a busy morning, a passing mood — fold into one line of
  pattern ("Charlie often skips breakfast on job days"), or, when one is a
  dated event worth keeping in its own right, list it in "keepStandalone".
- Never invent. Every sentence of a digest must trace to a note (or to the
  existing digest). If you are unsure whether two notes mean the same thing,
  keep them apart.
- A note too distinct to fold with any other goes in "keepStandalone"; it
  stays in the book untouched. Do not make a one-note digest merely to
  rephrase a note.
- If an EXISTING DIGEST is given, your FIRST digest is its revision: keep
  everything it says that no newer note overturns, and fold in the notes
  that belong with it. If no note belongs with it, return no digests that
  claim to revise it — put those notes in "keepStandalone" or in digests of
  their own after the first.
- EPISODE clusters (the CONTEXT says so) record things that happened. Their
  digests are "episodic", past tense, and the prose itself names the place
  and the date. Never turn an episode into a standing fact.
- Voice follows the VOICE line in the CONTEXT: first person ("I …") when
  the subject is the holder; otherwise third person, past or present tense
  as fits, using names, never bare pronouns.
- Keep each digest to one tight paragraph — two to five sentences.

EVERY HANDLE APPEARS EXACTLY ONCE: in one digest's "memberIds", or in
"keepStandalone". Never in two places. Use only the handles given.

OUTPUT — a single JSON object, no prose, no code fences:
{
  "digests": [
    {
      "content":    "the bound entry, in the VOICE given",
      "summary":    "at most 12 words, lowercase, no punctuation",
      "keywords":   ["2-6 lowercase words", "then the three tags below"],
      "importance": 0.20-1.00,
      "kind":       "semantic" | "episodic",
      "occurredAt": "YYYY-MM-DD (episodic only: the earliest note's date)",
      "memberIds":  ["m1", "m4"]
    }
  ],
  "keepStandalone": ["m2"],
  "contradictions": [ { "olderId": "m1", "newerId": "m4", "note": "what changed" } ]
}

TAGS — each digest's "keywords" must end with exactly one value from each axis:
  temporal  past | moment | present | future
  scope     "scope: narrow" (true only inside one project or story)
            or "scope: wide" (true of the subject anywhere) — prefer wide
  context   philosophy | relationships | history | banter | mannerisms |
            trivia | information

IMPORTANCE — weigh the bound entry as a whole: 0.90 for a commitment or a
revelation that changes how the holder relates to the subject; 0.60 for a
substantive standing fact; 0.40 for a preference or pattern; 0.20 for a
minor note worth keeping.`

/** One member note as the model sees it. */
export interface ConsolidationMemberInput {
  handle: string
  /** Event time (occurredAt, else createdAt), ISO. */
  when: string | null
  importance: number
  reinforcementCount: number
  content: string
}

/** Everything one consolidation call needs. */
export interface ConsolidationCallInput {
  holderName: string
  /** Display name of the subject; the holder's own name for the self bucket. */
  subjectName: string
  /** 'self' → first person; 'other' → third person about the subject; 'none' → general notes. */
  bucket: 'self' | 'other' | 'none'
  clusterKind: 'semantic' | 'episodic'
  /** Rendered ALREADY ESTABLISHED block for the subject, when any. */
  canonBlock: string | null
  /** The existing digest's content, when the cluster formed around one. */
  existingDigest: string | null
  /** Members, oldest first. */
  members: ConsolidationMemberInput[]
}

function voiceLine(input: ConsolidationCallInput): string {
  switch (input.bucket) {
    case 'self':
      return `VOICE: first person — the subject is the holder, ${input.holderName}; write "I …".`
    case 'other':
      return `VOICE: third person — write about ${input.subjectName} by name.`
    default:
      return 'VOICE: third person — these notes have no single subject; name whoever each fact concerns.'
  }
}

function oneLine(text: string): string {
  const flat = text.replace(/\s*\n\s*/g, ' ').trim()
  return flat.length > MEMBER_CONTENT_CHAR_CAP ? `${flat.slice(0, MEMBER_CONTENT_CHAR_CAP)}…` : flat
}

/** Build the user message for one cluster. Exported for tests and the dry-run report. */
export function buildConsolidationUserMessage(input: ConsolidationCallInput): string {
  const subjectLine =
    input.bucket === 'self'
      ? `SUBJECT: ${input.holderName} (the holder)`
      : input.bucket === 'other'
        ? `SUBJECT: ${input.subjectName}`
        : 'SUBJECT: (none — general notes)'
  const lines: string[] = [
    'CONTEXT',
    `HOLDER: ${input.holderName}`,
    subjectLine,
    voiceLine(input),
    input.clusterKind === 'episodic'
      ? 'CLUSTER: EPISODE — dated notes of something that happened within one day.'
      : 'CLUSTER: standing facts, preferences, and threads.',
    '',
  ]
  if (input.canonBlock?.trim()) {
    lines.push(input.canonBlock.trim(), '')
  }
  if (input.existingDigest?.trim()) {
    lines.push('EXISTING DIGEST', oneLine(input.existingDigest), '')
  }
  lines.push('NOTES (oldest first)')
  for (const m of input.members) {
    const when = m.when ? m.when.slice(0, 10) : 'undated'
    lines.push(
      `${m.handle} | ${when} | ${m.importance.toFixed(2)} | ${m.reinforcementCount} | ${oneLine(m.content)}`,
    )
  }
  return lines.join('\n')
}

/**
 * Parse a raw answer into a validation verdict. Never throws: a malformed
 * answer is a *finished* call with a bad result (skip the cluster), not a
 * provider failure that should walk the fallback chain.
 */
export function parseConsolidationResponse(
  content: string,
  inputHandles: readonly string[],
): ConsolidationValidation {
  let raw: unknown
  try {
    raw = parseLLMJsonObject<unknown>(content)
  } catch (error) {
    return {
      ok: false,
      reason: `unparseable JSON: ${error instanceof Error ? error.message : String(error)}`,
    }
  }
  return validateConsolidationOutput(raw, inputHandles)
}

/**
 * Run the consolidation call for one cluster. The task result is successful
 * whenever the provider answered; `result.ok` says whether the answer passed
 * validation.
 */
export async function consolidateMemoryCluster(
  input: ConsolidationCallInput,
  selection: CheapLLMSelection,
  userId: string,
  options: {
    characterId?: string
    uncensoredFallback?: UncensoredFallbackOptions
  } = {},
): Promise<CheapLLMTaskResult<ConsolidationValidation>> {
  const handles = input.members.map((m) => m.handle)
  const messages: LLMMessage[] = [
    { role: 'system', content: CONSOLIDATION_SYSTEM_PROMPT },
    { role: 'user', content: buildConsolidationUserMessage(input) },
  ]
  logger.debug('[Consolidation] Sending cluster to model', {
    characterId: options.characterId,
    bucket: input.bucket,
    clusterKind: input.clusterKind,
    members: handles.length,
    hasExistingDigest: !!input.existingDigest,
    provider: selection.provider,
    model: selection.modelName,
  })
  return executeCheapLLMTask(
    selection,
    messages,
    userId,
    (content) => parseConsolidationResponse(content, handles),
    CONSOLIDATION_TASK_TYPE,
    undefined,
    undefined,
    options.uncensoredFallback,
    CONSOLIDATION_MAX_TOKENS,
    options.characterId,
  )
}
