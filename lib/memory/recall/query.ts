/**
 * The recall query distiller: search keywords, a paraphrase, the turn's
 * temporal/context guess and its episodic signals, from the recent messages.
 * Moved unchanged from the retired `cheap-llm-tasks/memory-tasks.ts` (memory
 * refactor Phase D).
 *
 * Also the first recall stage, {@link buildRecallQuery}: the turn's query text,
 * its signals and its ONE embedding (plus the retrospective probes'), which
 * every later stage and every pool of the turn reuses.
 *
 * @module memory/recall/query
 */

import type { LLMMessage } from '@/lib/llm/base'
import type { CheapLLMSelection } from '@/lib/llm/cheap-llm'
import {
  TEMPORAL_VALUES,
  CONTEXT_VALUES,
  buildRetrospectiveProbes,
  type TemporalTag,
  type ContextTag,
} from './tags'
import { normaliseTimeRange, resolveReferenceWindow, type DayReferenceResolution } from '@/lib/memory/time/clock'
import { zonedDateStamp, zonedParts } from '@/lib/memory/time/calendar'
import { refreshMemoryTimeZone } from '@/lib/memory/time/calendar-refresh'
import { executeCheapLLMTask, type CheapLLMLatencyClass } from '../cheap-llm-tasks/core-execution'
import type { ChatMessage, CheapLLMTaskResult } from '../cheap-llm-tasks/types'
import type { ExtractionClock } from '../extraction/prompts/shared'
import { logger } from '@/lib/logger'
import { stripCodeFences } from '@/lib/llm/llm-json'
import { generateEmbeddingForUser, type EmbeddingResult } from '@/lib/embedding/embedding-service'
import { traceStage, type RecallTrace } from './types'

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/**
 * Prompt for extracting memory search keywords from recent conversation, plus a
 * one-word guess at the current turn's dominant temporal frame and subject.
 *
 * The turn-level `temporal`/`context` guess feeds the recall-side targeting-tag
 * adjustments (see lib/memory/recall/tags.ts): `context` steers recall toward
 * memories whose own `context` tag matches the turn. Both are best-effort — the
 * parser validates them against the closed vocabularies and drops anything
 * unrecognized, so an omitted or garbled guess simply disables that adjustment.
 */
const MEMORY_KEYWORD_EXTRACTION_PROMPT = `You are analyzing recent conversation messages to extract search keywords for a character's memory system, plus a one-word guess at what the current moment is about.

Your task: Given recent messages from a conversation, produce (a) a list of keywords and short phrases that capture what is being discussed — used to search a character's stored memories for relevant context — and (b) a single best-guess temporal frame and context subject for the conversation right now.

Focus the keywords on:
- People, places, and events mentioned
- Topics and themes being discussed
- Emotions and relationship dynamics
- Decisions, preferences, or plans
- Anything the character might have memories about

Do NOT include as keywords:
- Generic conversational filler ("hello", "okay", "thanks")
- The character's own name (they already know who they are)
- Overly broad terms that would match everything

temporal — one of: past | moment | present | future
  past    — about something no longer true
  moment  — about a single fleeting instant
  present — about how things are right now
  future  — about an intention or plan not yet acted on

context — the single dominant subject, one of:
  philosophy | relationships | history | banter | mannerisms | trivia | information

paraphrase — ONE natural-language sentence describing what the characters are currently focused on, written as prose (not a keyword list). This is used to search memories by meaning, so make it specific and self-contained. Example: "They are arguing about whether to trust the stranger who arrived at the inn last night."

retrospective — true when the conversation is currently referencing past shared events or asking to recall them, including events from earlier the same day ("remember when we…", "last week you said…", "that place we visited", "the mission today", "how did it go this morning?", "what happened at the pool?"). Talking about how things are right now or planning the future is NOT retrospective.

timeRange — when the turn references a specific past period, resolve it against the TODAY line in the input into absolute ISO dates: {"from": "YYYY-MM-DD", "to": "YYYY-MM-DD"}. "last week" on a Tuesday resolves to the previous calendar week; "in March" to that month; "today" / "this morning" to the TODAY date itself; "yesterday" to the day before it. Use null when no time period is referenced or you cannot resolve one. (On a fictional timeline, use null unless real dates are actually stated.)

entities — 0-5 proper nouns the turn names or clearly implies: places, people, named things ("Lighthouse Point", "Amy"). Empty array when none.

Respond with a JSON object (3-10 keywords):
{"keywords": ["keyword1", "keyword phrase 2", "keyword3"], "temporal": "present", "context": "relationships", "paraphrase": "A single sentence describing the current focus.", "retrospective": false, "timeRange": null, "entities": []}
{"keywords": ["mission report", "soil samples"], "temporal": "past", "context": "information", "paraphrase": "Charlie is asking how today's mission went.", "retrospective": true, "timeRange": {"from": "2026-07-28", "to": "2026-07-28"}, "entities": ["Constantinople"]}

JSON only - no other text.`

/**
 * Result of the unified keyword distillation: the search keywords plus a
 * best-guess `temporal`/`context` label for the current turn. The two guesses
 * are validated against the closed vocabularies and left undefined when the
 * model omits or garbles them, so the recall-side adjustments that consume them
 * simply disable themselves rather than acting on noise.
 */
export interface MemorySearchExtraction {
  keywords: string[]
  temporal?: TemporalTag
  context?: ContextTag
  /**
   * A single natural-language sentence describing what the characters are
   * currently focused on. This — not the keyword bag — is what the recall path
   * embeds: sentence-embedding models are trained on prose, so a sentence lands
   * in a far more discriminating region of embedding space than `keywords.join`.
   * Undefined when the model omits it (caller falls back to the prose query).
   */
  paraphrase?: string
  // ── Episodic recall (all default to inert values on parse failure) ─────────
  /** True when the turn references past shared events. Absent → false. */
  retrospective?: boolean
  /**
   * Absolute ISO time window the turn references, resolved by the model
   * against the TODAY line ("last week" → {from, to}). Null/absent → none.
   */
  timeRange?: { from: string; to: string } | null
  /** Places/people/things named or implied by the turn. Absent → []. */
  entities?: string[]
}

/**
 * How many of the most recent messages the deterministic day-reference scanner
 * reads. Deliberately far tighter than the 20 the prompt sees: an override that
 * fires on a stale "yesterday" from three topics ago is worse than no override.
 */
const DAY_REFERENCE_SCAN_MESSAGES = 4


/**
 * Merge a deterministically-resolved day reference into the LLM's parsed
 * signals (Fix 1 of the day-references + fresh-boost spec).
 *
 * - Past-pointing reference → the resolved window OVERRIDES any LLM range and
 *   forces `retrospective: true`. The override is the point: the model's own
 *   ranges are UTC-day-biased, and that bias is what made a same-day "the
 *   mission today" resolve to a window containing none of the mission.
 * - Future-only reference ("tomorrow") → nothing applied; whatever the model
 *   said stands, since the lexicon covers less than the model does.
 * - No reference → the parsed result passes through unchanged.
 *
 * Accepted cost: a purely forward-looking "let's go to the pool today" marks
 * the turn retrospective. The consequences (a temporal flip toward today's
 * memories, one turn without the anti-repetition penalty) are benign, and
 * intent heuristics to dodge it would reintroduce exactly the brittleness this
 * resolver exists to remove.
 */
function mergeDayReference(
  parsed: MemorySearchExtraction,
  dayReference: DayReferenceResolution | null,
  chatId: string | undefined,
  characterId: string | undefined,
): MemorySearchExtraction {
  if (!dayReference) return parsed

  if (!dayReference.pastPointing) {
    logger.debug('[MemorySearchKeywords] Day reference is future-pointing; leaving LLM signals alone', {
      chatId,
      characterId,
      matched: dayReference.matched,
    })
    return parsed
  }

  logger.debug('[MemorySearchKeywords] Deterministic day reference resolved', {
    chatId,
    characterId,
    matched: dayReference.matched,
    from: dayReference.timeRange.from,
    to: dayReference.timeRange.to,
    overrodeLlmTimeRange: !!parsed.timeRange,
    llmRetrospective: parsed.retrospective === true,
  })

  return { ...parsed, retrospective: true, timeRange: dayReference.timeRange }
}

/**
 * Extracts memory search keywords from recent conversation messages, plus a
 * turn-level temporal/context guess.
 *
 * Used for proactive memory recall: analyzes messages since the character last
 * spoke to find keywords for searching the character's memory store. The turn
 * guess feeds the recall-side targeting-tag adjustments (lib/memory/recall/tags.ts).
 *
 * @param recentMessages - Messages since the character last spoke
 * @param characterName - The name of the character whose memories will be searched
 * @param selection - The cheap LLM provider selection
 * @param userId - The user ID for API key retrieval
 * @param chatId - Optional chat ID for logging
 * @param latency - Who is waiting. The proactive pre-compute pass runs after
 *   delivery and takes the `background` default; the dynamic-head fallback in
 *   `context-manager` is awaited inline while the composer is empty and must
 *   pass `interactive` (bug 115).
 * @returns Keywords for memory search plus an optional turn-level temporal/context guess
 */
export async function extractMemorySearchKeywords(
  recentMessages: ChatMessage[],
  characterName: string,
  selection: CheapLLMSelection,
  userId: string,
  chatId?: string,
  characterId?: string,
  clock?: ExtractionClock,
  latency: CheapLLMLatencyClass = 'background'
): Promise<CheapLLMTaskResult<MemorySearchExtraction>> {
  // Truncate messages to keep cheap LLM call fast
  const cappedMessages = recentMessages.slice(-20)
  const conversationText = cappedMessages
    .map(m => {
      const speaker = m.role === 'user' ? 'User' : m.role === 'assistant' ? 'Character' : 'System'
      const content = m.content.length > 500 ? m.content.substring(0, 500) + '...' : m.content
      return `${speaker}: ${content}`
    })
    .join('\n\n')

  // TODAY line (variable — user content, never the cached system prompt) so
  // the model can resolve "last week" into an absolute timeRange.
  //
  // Rendered from the SERVER-LOCAL calendar, not UTC: Quilltap is self-hosted,
  // so the server's timezone is the user's. A UTC TODAY line tells a user
  // talking at 21:44 CDT that it is already tomorrow, and every "today" the
  // model resolves then lands on a day containing none of the memories it
  // means (see lib/memory/time, whose rule table the deterministic scan reads).
  //
  // Bug 212: "local" is the instance's memory calendar (instance timezone →
  // QUILLTAP_TIMEZONE → system), the same one the write side stamps with.
  const memoryTimeZone = clock?.timeZone ?? await refreshMemoryTimeZone()
  const nowIso = clock?.nowIso ?? new Date().toISOString()
  const nowMs = Date.parse(nowIso)
  const timelineMode = clock?.timelineMode ?? 'realtime'
  const todayLine = Number.isFinite(nowMs)
    ? `TODAY: ${zonedDateStamp(nowMs, memoryTimeZone)} (${WEEKDAYS[zonedParts(nowMs, memoryTimeZone).weekday]}); timeline mode: ${timelineMode}`
    : `TODAY: ${nowIso}; timeline mode: ${timelineMode}`

  // Deterministic day-reference resolution (Fix 1). Scanned over the most
  // recent messages only — the prompt sees 20, but older context routinely
  // carries a stale "yesterday" from a previous topic, and a deterministic
  // override must stay tight to the live turn. Realtime timelines only,
  // matching the prompt's own rule for fictional clocks.
  const dayReference =
    timelineMode === 'realtime' && Number.isFinite(nowMs)
      ? resolveReferenceWindow(
          cappedMessages
            .slice(-DAY_REFERENCE_SCAN_MESSAGES)
            .map(m => m.content)
            .join('\n'),
          { timeZone: memoryTimeZone, nowMs },
        )
      : null

  const messages: LLMMessage[] = [
    {
      role: 'system',
      content: MEMORY_KEYWORD_EXTRACTION_PROMPT,
    },
    {
      role: 'user',
      content: `Character: ${characterName}\n${todayLine}\n\nRecent conversation:\n${conversationText}\n\nExtract keywords for searching ${characterName}'s memories:`,
    },
  ]

  return executeCheapLLMTask(
    selection,
    messages,
    userId,
    (content: string): MemorySearchExtraction => {
      try {
        const cleanContent = stripCodeFences(content)
        const parsed = JSON.parse(cleanContent)

        // Accept either the new object shape { keywords, temporal, context } or a
        // bare keyword array (legacy / model drift). A bare array carries no turn
        // guess, which simply leaves context steering disabled for the turn.
        const rawKeywords: unknown = Array.isArray(parsed) ? parsed : parsed?.keywords
        const keywords = Array.isArray(rawKeywords)
          ? rawKeywords
              .filter((item: unknown): item is string => typeof item === 'string' && item.trim().length > 0)
              .slice(0, 10)
          : []

        const rawTemporal =
          !Array.isArray(parsed) && typeof parsed?.temporal === 'string'
            ? parsed.temporal.trim().toLowerCase()
            : ''
        const rawContext =
          !Array.isArray(parsed) && typeof parsed?.context === 'string'
            ? parsed.context.trim().toLowerCase()
            : ''
        const temporal = TEMPORAL_VALUES.has(rawTemporal) ? (rawTemporal as TemporalTag) : undefined
        const context = CONTEXT_VALUES.has(rawContext) ? (rawContext as ContextTag) : undefined

        const rawParaphrase =
          !Array.isArray(parsed) && typeof parsed?.paraphrase === 'string'
            ? parsed.paraphrase.trim()
            : ''
        const paraphrase = rawParaphrase.length > 0 ? rawParaphrase : undefined

        // Episodic signals — every one defaults to inert on garbling so
        // recall degrades to exactly today's behavior, never blocks.
        const retrospective =
          !Array.isArray(parsed) && parsed?.retrospective === true
        let timeRange: { from: string; to: string } | null = null
        if (!Array.isArray(parsed) && parsed?.timeRange && typeof parsed.timeRange === 'object') {
          const tr = parsed.timeRange as Record<string, unknown>
          // Date-only bounds widen to full LOCAL days on the memory calendar
          // (bug 212), never UTC days — the same clock the scan reads.
          timeRange = normaliseTimeRange(
            {
              from: typeof tr.from === 'string' ? tr.from : null,
              to: typeof tr.to === 'string' ? tr.to : null,
            },
            { timeZone: memoryTimeZone },
          )
        }
        const entities =
          !Array.isArray(parsed) && Array.isArray(parsed?.entities)
            ? (parsed.entities as unknown[])
                .filter((e): e is string => typeof e === 'string' && e.trim().length > 0)
                .map(e => e.trim())
                .slice(0, 5)
            : []

        return mergeDayReference(
          { keywords, temporal, context, paraphrase, retrospective, timeRange, entities },
          dayReference,
          chatId,
          characterId,
        )
      } catch {
        // Unparsable response — callers bail on empty keywords, so there is
        // nothing for the deterministic window to ride along with.
        return { keywords: [] }
      }
    },
    'memory-keyword-extraction',
    chatId,
    undefined,
    undefined,
    undefined,
    characterId,
    { latency }
  )
}

// ============================================================================
// Stage 1 — the turn's recall query, embedded once
// ============================================================================

/** A text and the vector embedded for it (null when embedding failed). */
export interface EmbeddedText {
  text: string
  embedding: EmbeddingResult | null
}

/**
 * Everything the later stages need to know about the question being asked:
 * the text, its one embedding, the distilled signals and what they imply.
 */
export interface RecallQuery {
  /** The text searched and embedded. Empty → there is nothing to search. */
  text: string
  /** The main query's embedding, or null (no profile, a failed call) — the text fallback then runs. */
  embedding: EmbeddingResult | null
  /** Retrospective probes (≤ 2), each embedded once here. */
  probes: EmbeddedText[]
  /** The turn's distilled signals, when a distillation ran. */
  signals: MemorySearchExtraction | null
  /** Entity anchors (the signals' entities). */
  anchors: string[]
  /** The resolved event-time window, ungated from the retrospective flag. */
  window: { from: string; to: string } | null
  retrospective: boolean
  /** Why `embedding` is null, when it is. */
  embeddingError?: string
}

/** Inputs to {@link buildRecallQuery}. */
export interface BuildRecallQueryInput {
  userId: string
  embeddingProfileId?: string
  /** The fallback text: the recent-window prose, the tool's query, the draft. */
  text: string
  /** Signals already distilled (the proactive pass, a pinned replay). */
  signals?: MemorySearchExtraction | null
  /**
   * Distil the signals here when none were handed in. Absent → no
   * distillation; the query is `text` as given.
   */
  distill?: {
    messages: ChatMessage[]
    characterName: string
    selection: CheapLLMSelection
    chatId?: string
    characterId?: string
    clock?: ExtractionClock
    latency?: CheapLLMLatencyClass
  }
  /**
   * Reuse embeddings by text across calls. The provider's vectors for one text
   * drift slightly from call to call; the replay harness passes one memo so the
   * runs it compares embed the same vectors. Live recall leaves it off.
   */
  embeddingMemo?: Map<string, EmbeddingResult>
  /** Leave the query unembedded (the text fallback is all that will run). */
  skipEmbedding?: boolean
  /** Probes to embed beside the query, instead of the ones the signals imply. */
  probes?: readonly string[]
}

/** The text the query searches: the paraphrase, else the keywords, else the given text. */
export function recallQueryText(signals: MemorySearchExtraction | null | undefined, fallback: string): string {
  if (signals?.paraphrase) return signals.paraphrase
  if (signals && signals.keywords.length > 0) return signals.keywords.join(' ')
  return fallback
}

/**
 * Build the turn's recall query: distil (when asked and not already done),
 * choose the text, and embed it — once. The retrospective probes are embedded
 * here too, so nothing downstream ever embeds again. Never throws: a failed
 * distillation falls back to the given text, a failed embedding leaves
 * `embedding` null and the text fallback runs.
 */
export async function buildRecallQuery(
  input: BuildRecallQueryInput,
  trace: RecallTrace = [],
): Promise<RecallQuery> {
  let signals = input.signals ?? null
  let distilled: 'given' | 'ran' | 'failed' | 'none' = signals ? 'given' : 'none'
  if (!signals && input.distill && input.text.trim()) {
    const d = input.distill
    try {
      const result = await extractMemorySearchKeywords(
        d.messages,
        d.characterName,
        d.selection,
        input.userId,
        d.chatId,
        d.characterId,
        d.clock,
        d.latency,
      )
      if (result.success && result.result) {
        signals = result.result
        distilled = 'ran'
      } else {
        distilled = 'failed'
      }
    } catch (error) {
      distilled = 'failed'
      logger.debug('[Recall] Query distillation failed; using the recent-window text', {
        characterId: d.characterId,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  const text = recallQueryText(signals, input.text).trim()
  const retrospective = signals?.retrospective === true
  const probeTexts = (input.probes ?? buildRetrospectiveProbes(signals, retrospective) ?? [])
    .map(p => p.trim())
    .filter(p => p.length > 0)
    .slice(0, 2)

  const embed = async (value: string): Promise<EmbeddingResult> => {
    const key = `${input.embeddingProfileId ?? 'default'}|${value}`
    const cached = input.embeddingMemo?.get(key)
    if (cached) return cached
    const result = await generateEmbeddingForUser(value, input.userId, input.embeddingProfileId)
    input.embeddingMemo?.set(key, result)
    return result
  }

  let embedding: EmbeddingResult | null = null
  let embeddingError: string | undefined
  const probes: EmbeddedText[] = []
  if (text && !input.skipEmbedding) {
    try {
      embedding = await embed(text)
    } catch (error) {
      embeddingError = error instanceof Error ? error.message : String(error)
      logger.warn('[Recall] Query embedding failed; recall falls back to text search', {
        userId: input.userId,
        query: text.substring(0, 100),
        error: embeddingError,
      })
    }
    if (embedding) {
      for (const probe of probeTexts) {
        try {
          probes.push({ text: probe, embedding: await embed(probe) })
        } catch (probeError) {
          probes.push({ text: probe, embedding: null })
          logger.debug('[Recall] Probe embedding failed; skipping probe', {
            probe: probe.substring(0, 80),
            error: probeError instanceof Error ? probeError.message : String(probeError),
          })
        }
      }
    }
  }
  if (!embedding) {
    // The text fallback still reads the probes' words.
    for (const probe of probeTexts) {
      if (!probes.some(p => p.text === probe)) probes.push({ text: probe, embedding: null })
    }
  }

  const query: RecallQuery = {
    text,
    embedding,
    probes,
    signals,
    anchors: (signals?.entities ?? []).map(e => e.trim()).filter(e => e.length > 0),
    window: signals?.timeRange ?? null,
    retrospective,
    ...(embeddingError ? { embeddingError } : {}),
  }
  traceStage(trace, 'query', {
    distilled,
    textLength: text.length,
    embedded: !!embedding,
    embeddingCalls: embedding ? 1 + probes.filter(p => p.embedding).length : 0,
    probes: probes.length,
    anchors: query.anchors.length,
    window: query.window,
    retrospective,
  })
  return query
}
