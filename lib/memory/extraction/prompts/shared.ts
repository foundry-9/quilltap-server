/**
 * Blocks every extraction prompt shares: the ORIENTING CONTEXT and CLOCK
 * footers, the EVENT / AGREEMENTS / TAGS instruction blocks and the
 * autonomous-room clause. Bodies moved unchanged from the retired
 * `cheap-llm-tasks/memory-tasks.ts` (memory refactor Phase D).
 *
 * @module memory/extraction/prompts/shared
 */

import { getMemoryTimeZone, zonedDateStamp, zonedParts } from '@/lib/memory/time/calendar'

/**
 * Non-canonical orienting context fed into the extraction footer. Project
 * description and the rolling chat summary help the model judge a memory's
 * temporal frame, scope, and context tag — they are NEVER a source of
 * memories themselves. Held in the variable footer (never the cached body
 * prefix) so cheap-LLM prefix caching still hits across a long extraction run.
 */
export interface OrientingContext {
  projectDescription?: string | null
  chatContextSummary?: string | null
}

/** Char budget per orienting line — character count, not tokens (no tokenizer on the cheap path). */
const ORIENTING_TRUNCATE = 1500

function truncateForOrienting(value: string): string {
  return value.length <= ORIENTING_TRUNCATE
    ? value
    : `${value.slice(0, ORIENTING_TRUNCATE)}…`
}

/**
 * Render the ORIENTING CONTEXT footer block. Each line appears only when its
 * source is non-empty; the whole block is omitted when both are empty (so the
 * prompt stays byte-identical to the no-context form). Placed after the stable
 * body and before the CONTEXT block by the prompt builders.
 */
export function renderOrientingContext(orienting: OrientingContext | undefined): string {
  if (!orienting) return ''
  const lines: string[] = []
  const project = orienting.projectDescription?.trim()
  if (project) lines.push(`PROJECT: ${truncateForOrienting(project)}`)
  const summary = orienting.chatContextSummary?.trim()
  if (summary) lines.push(`STORY SO FAR: ${truncateForOrienting(summary)}`)
  if (lines.length === 0) return ''
  return `ORIENTING CONTEXT — background only, never a source of memories\n${lines.join('\n')}\n\n`
}

/**
 * The extractor's clock (episodic spine). Rendered into the variable CONTEXT
 * footer — never the cached body prefix — so the model can resolve
 * "yesterday" / "last spring" while extracting, and so `when` phrases come
 * back already anchorable. Without a clock the prompt sees only the turn
 * transcript and cannot date anything.
 */
export interface ExtractionClock {
  /** ISO wall-clock timestamp of the source turn (the turn's message time). */
  nowIso: string
  /** Which clock the chat's story runs on. */
  timelineMode: 'realtime' | 'narrative'
  /**
   * The memory-calendar zone this clock is read in (bug 212). The caller
   * resolves it once and hands the same value to the `when` resolver, so the
   * date the model is shown and the date its phrases resolve against cannot
   * disagree. Absent, the extraction entry point resolves it before building
   * the prompt (`buildExtractionContext` reads `refreshMemoryTimeZone` once).
   */
  timeZone?: string
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/** `2026-07-14 (Tuesday), <nowIso>` — the clock's local date on the memory calendar. */
export function renderClockStamp(clock: ExtractionClock): string {
  const ms = Date.parse(clock.nowIso)
  if (!Number.isFinite(ms)) return clock.nowIso
  const timeZone = clock.timeZone ?? getMemoryTimeZone()
  return `${zonedDateStamp(ms, timeZone)} (${WEEKDAYS[zonedParts(ms, timeZone).weekday]}), ${clock.nowIso}`
}

/** Render the CLOCK footer block. Returns `''` when no clock was supplied. */
export function renderClockBlock(clock: ExtractionClock | undefined): string {
  if (!clock) return ''
  const stamp = renderClockStamp(clock)
  const lines = [
    'CLOCK',
    `Current date/time: ${stamp}`,
    `Timeline mode: ${clock.timelineMode}`,
  ]
  lines.push(
    'Resolve relative time phrases against this clock; emit "when" as an absolute date (YYYY-MM-DD) whenever you can.',
  )
  return `${lines.join('\n')}\n\n`
}

/**
 * Skip bullet (verbatim) appended to the WHAT TO SKIP list in both extraction
 * bodies: the ORIENTING CONTEXT block is background for tagging only, not a
 * memory source.
 */
export const ORIENTING_CONTEXT_SKIP_BULLET = `- Never extract a memory whose only source is the ORIENTING CONTEXT block.
  That block is background for judging temporal frame, scope, and context
  only — it is not itself a source of memories.`

/**
 * TAGS instruction block (verbatim) appended to both extraction bodies. Teaches
 * the three targeting axes, their closed vocabularies, and the
 * exactly-one-per-axis requirement.
 */
/**
 * EVENT / episodic instruction block (verbatim) appended to both extraction
 * bodies. Teaches the `kind` / `when` / `entities` output fields and the rule
 * that an EVENT's content sentence should itself name the place and time so
 * the prose — and its embedding — carries the anchors.
 */
export const EVENT_INSTRUCTION_BLOCK = `EVENTS — episodic memories.
An EVENT records a specific occurrence at a specific time and/or place
("On July 14th we visited Lighthouse Point and bought the brass
sextant"), as opposed to a standing fact. For an EVENT:
  - set "kind" to "episodic" (everything else defaults to "semantic")
  - fill "when" with the time it happened — an absolute date (YYYY-MM-DD,
    resolved against the CLOCK below) whenever possible, otherwise the
    relative or in-story phrase as stated ("last week", "the third night
    at sea")
  - fill "entities" with the proper nouns of the episode: places, people,
    named things (2–5 entries)
  - write the content sentence so it ITSELF names the place and time —
    the prose must carry the anchors even on its own
You may return ONE memory beyond the stated cap only when that extra
memory is a dated or placed EVENT — events must not crowd out hinge or
state candidates.`

/**
 * Shared by the SELF and OTHER bodies. Mechanism 6 of the anti-committee
 * spec: a character states a condition, the turn ends on it, and the
 * extractor records "{{user}} agreed" for every observer. Assent must be
 * spoken by the agreeing party; proposals stay proposals; limits stay in.
 * See docs/developer/features/complete/prompt-trust-and-anti-committee.md §8.
 */
export const AGREEMENTS_INSTRUCTION_BLOCK = `AGREEMENTS, PROPOSALS, AND CONDITIONS — read these strictly
- Record an agreement ONLY when the agreeing party's own words of
  assent appear in this transcript, spoken by that party: "yes,"
  "fine," "deal," "I'll do it." Nothing else counts.
- A condition, demand, rule, or proposal is recorded as what it is and
  attributed to whoever said it — "X proposed…", "X asked that…",
  "X set a condition that…" — never as accepted by anyone else.
- Silence is not assent. Neither is the exchange ending, an apology,
  self-criticism, a change of subject, "I'll think about it," or
  "I need to sit with that." When a proposal was the last word, say
  so: "…; <name> had not yet responded."
- The USER's lines came BEFORE every character line in this turn, so
  nothing the USER said can be assent to a proposal made after it.
- Keep stated limits in the text: "until breakfast," "for tonight,"
  "custody, not confiscation — back at breakfast." A memory that
  drops the limit records a different, larger thing than was said.`

export const TAGS_INSTRUCTION_BLOCK = `TAGS — every memory object MUST carry exactly one value from each axis.
These describe the memory's frame; they do not change its content.

  temporal  one of: past | moment | present | future
            past    — was true once, no longer true
            moment  — true only at this instant in the scene
            present — true now and expected to stay true
            future  — a stated intent or commitment not yet acted on
                      (the speaker's own; a proposal awaiting someone
                      else's answer is \`moment\`)

  scope     one of: narrow | wide
            narrow  — true only inside this project / story
            wide    — true of the subject regardless of project
            Use the PROJECT line in ORIENTING CONTEXT to decide. When in
            doubt, prefer wide.

  context   one of: philosophy | relationships | history | banter |
            mannerisms | trivia | information
            The single dominant subject of this memory. Pick one.`

/**
 * Closed vocabularies for the three targeting axes live in
 * `lib/memory/recall/tags.ts` (the single source of truth; the parser normalises against them through
 * `normaliseTargeting` in `lib/memory/candidate.ts`) so
 * the extraction (write) and recall (read) sides can never drift.
 */

/**
 * 4.6 Private Character Rooms — user-absence clause for memory extraction.
 *
 * Prepended to the SELF and OTHER prompts when the source chat is autonomous
 * (chatType = 'autonomous'). Constrains the extractor so the resulting
 * memories don't falsely imply the user was present, agreed to, or was
 * informed of the exchange. Memories about the participants' shared
 * experience remain in scope; user-attributed memories are out of scope.
 */
export const AUTONOMOUS_ROOM_USER_ABSENCE_CLAUSE =
  `IMPORTANT: This exchange occurred in an autonomous character-to-character ` +
  `room with no user present. Do not produce memories that imply the user ` +
  `witnessed, agreed to, or was informed of any part of this exchange. ` +
  `Memories about the participants' shared experience are allowed; memories ` +
  `that name or address the user are not.\n\n`
