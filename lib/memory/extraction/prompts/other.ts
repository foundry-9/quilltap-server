/**
 * The OTHER prompt: what an observer retains about each subject, one call per
 * observer, at turn or fold grain. Body moved unchanged from the retired
 * `cheap-llm-tasks/memory-tasks.ts` (memory refactor Phase D).
 *
 * @module memory/extraction/prompts/other
 */

import type { LLMMessage } from '@/lib/llm/base'
import type { Pronouns } from '@/lib/schemas/character.types'
import type { TurnTranscript } from '@/lib/services/chat-message/turn-transcript'
import { formatNameWithPronouns } from '../../format-utils'
import { renderStretch, renderTurnContext, type StretchMessage } from '../window'
import {
  AGREEMENTS_INSTRUCTION_BLOCK,
  AUTONOMOUS_ROOM_USER_ABSENCE_CLAUSE,
  ESTABLISHED_FACT_INSTRUCTION_BLOCK,
  EVENT_INSTRUCTION_BLOCK,
  IMPORTANCE_FACT_NOT_TELLING_NOTE,
  IMPORTANCE_WORK_CEILING_NOTE,
  ORIENTING_CONTEXT_SKIP_BULLET,
  TAGS_INSTRUCTION_BLOCK,
  renderClockBlock,
  renderOrientingContext,
  type ExtractionClock,
  type OrientingContext,
} from './shared'

/**
 * Memory extraction prompt: what THE OBSERVER retains about THE SUBJECT after
 * the turn. The subject may be another character or the user — extraction
 * logic is identical in both cases.
 *
 * The body refers to "the observer" and "the subject" throughout so the
 * prompt prefix is byte-stable across every OTHER call — providers' prefix
 * caches can hit regardless of which (observer, subject) pair is in play.
 * The actual names and canon block sit in a CONTEXT footer at the end.
 *
 * Each subject's `isUser` flag is rendered into the CONTEXT footer as a
 * parenthetical label so the model can distinguish the user-controlled
 * character from AI characters without branching the stable prompt body.
 */
/**
 * Prepended to the OTHER body when the extractor is reading a folded stretch
 * of conversation rather than one turn. A turn shows one beat of a thread and
 * yields fragments; a stretch shows the whole thread, so the model is told to
 * state each thread once, as its settled outcome.
 */
const FOLD_GRAIN_OTHER_BLOCK = `GRAIN — READ THIS FIRST
What follows is a STRETCH of conversation spanning many turns, not a single
exchange. State each thread ONCE, as it stands at the end of the stretch:
the settled outcome, not each beat on the way there. If a subject changed
their mind mid-stretch, record where they landed. Where the instructions
below say "this exchange" or "this turn", read "this stretch".`

function otherBodyForCap(perSubjectCap: number, grain: 'turn' | 'fold' = 'turn'): string {
  const grainBlock = grain === 'fold' ? `${FOLD_GRAIN_OTHER_BLOCK}\n\n` : ''
  return `${grainBlock}You produce memory entries that the observer would retain about
each of multiple subjects after this exchange. One LLM call covers every
subject the observer interacted with this turn — extract per subject,
return a single flat array tagged by subjectIndex.

TASK
Read the exchange below. For EACH numbered SUBJECT in the CONTEXT
footer, select up to ${perSubjectCap} memories — the ones the observer
would actually carry forward about THAT subject, not everything they
could describe. Rank candidates per subject, then return the strongest.
Do not pad to reach the cap. Subjects with nothing worth keeping
should simply be omitted from the array.

WHAT TO PICK (priority order, applied per subject)
1. HINGES — a decision, commitment, agreement (spoken by the agreeing
   party — see AGREEMENTS below), refusal, or realignment formed
   during this exchange.
2. NEW FACTS — concrete information about the subject that is not in
   their ALREADY ESTABLISHED block (each subject has their own block
   in the CONTEXT footer): background, history, plans, skills,
   circumstances, relationships.
3. STATE CHANGES — a shift in the subject's position, mood, or status,
   paired with its cause.
4. EXPRESSED INTENT — something the subject stated they will do, want
   to do, or refuse to do.
5. NOVEL GESTURES OR PHRASING — a new ritual gesture, postural tic, or
   signature phrasing the subject adopted, dropped, or shifted during
   this exchange. These may feed back into the subject's identity over
   time, so capture them when they appear genuinely new — not when the
   subject simply exhibits a gesture already in their ALREADY
   ESTABLISHED block.
6. EVENTS — a specific thing that happened involving the subject at a
   specific time and/or place: an outing, a visit, an arrival, a
   discovery, an incident. Mark these "kind": "episodic" and follow the
   EVENTS block below.

WHAT TO SKIP (do not produce a memory for any of these)
- Anything in a subject's ALREADY ESTABLISHED block, restated or
  slightly reworded.
- Pet names, terms of address, or how the subject addresses the
  observer, when those match the canon. (A new term of address being
  adopted is pickable under category 5.)
- Habitual gestures, posture, attire, or scene description that match
  patterns already established in the canon block. Novel or shifted
  gestures belong under category 5, not here.
- Generic emotional warmth or affection toward established partners,
  unless this exchange marks a shift in degree or kind.
- Narrative references to tool output: terminal sessions, file paths,
  exit codes, commit hashes, command names, even when the subject
  mentions them in passing.
- Anything implied by previously-established facts about the subject.
${ORIENTING_CONTEXT_SKIP_BULLET}

${AGREEMENTS_INSTRUCTION_BLOCK}

${ESTABLISHED_FACT_INSTRUCTION_BLOCK}

DEDUPLICATION
Before finalizing, scan your own list. Within a single subject, if two
memories encode the same underlying fact in different words, keep the
more specific one and drop the other. Different subjects can have
distinct memories about the same event from their own angle — that
is allowed and expected.

IMPORTANCE — calibrate to these anchors
  0.95  A fact that redefines the subject's life or bond to the
        observer: marriage, vows, pregnancy, birth, death, a change of
        body, joining or leaving the family.
  0.85  A revelation, or a personal commitment the subject themselves
        spoke, that changes how the observer relates to the subject.
        A proposal made TO the subject is not the subject's
        commitment.
  0.60  A new substantive fact about the subject's background, plans,
        or skills — including a commitment to build, file, fix, or
        rule on something.
  0.55  A proposal, condition, or demand the subject stated, not yet
        answered.
  0.45  A work decision, ruling, or task agreement made in passing.
  0.40  A new preference, trait, or novel gesture expressed in passing.
  0.20  A specific event occurred with the subject present, no new
        information.
  < 0.20  Do not extract.
${IMPORTANCE_WORK_CEILING_NOTE}

${IMPORTANCE_FACT_NOT_TELLING_NOTE}

OUTPUT — third person, past tense, names not pronouns (use the actual
names from the CONTEXT footer below), one fact per object. Every item
MUST carry subjectIndex matching a numbered SUBJECT in the CONTEXT
footer; items missing or with an out-of-range subjectIndex will be
discarded.
  subjectIndex 1-based integer, matches a SUBJECT N: line below
  content      one sentence stating the fact and the moment that
               surfaced it
  summary      3–8 words, lowercase, no punctuation, useful for dedup
  keywords     2–4 lowercase words, no phrases
  importance   0.20–1.00, calibrated to anchors above
  kind         "episodic" for an EVENT, otherwise omit (or "semantic")
  when         EVENTs only: when it happened (see EVENTS block)
  entities     EVENTs only: proper nouns of the episode

EXAMPLE — good extraction (observer is Friday, subjects 1=Amy 2=Charlie):
[
  {
    "subjectIndex": 1,
    "content": "Amy proposed reframing the cost problem as a four-tier prompt cache layout when Charlie was stuck between two designs.",
    "summary": "proposed four-tier cache layout",
    "keywords": ["cache", "architecture", "proposal"],
    "importance": 0.55,
    "temporal": "moment",
    "scope": "narrow",
    "context": "philosophy"
  },
  {
    "subjectIndex": 2,
    "content": "Charlie agreed to defer the renaming pass until after Amy's cache patch lands.",
    "summary": "deferred rename until after cache patch",
    "keywords": ["rename", "deferred", "agreement"],
    "importance": 0.45,
    "temporal": "future",
    "scope": "narrow",
    "context": "information"
  },
  {
    "subjectIndex": 1,
    "content": "Amy set a condition that nothing fires without the household hearing it first; Charlie had not yet responded when the exchange ended.",
    "summary": "proposed household-hears-first condition",
    "keywords": ["condition", "proposal", "household"],
    "importance": 0.55,
    "temporal": "moment",
    "scope": "narrow",
    "context": "relationships"
  },
  {
    "subjectIndex": 1,
    "content": "Amy told Friday at the piano bench that she is nine weeks pregnant with Charlie's child, laying his hand against her stomach.",
    "summary": "amy nine weeks pregnant with charlies child",
    "keywords": ["pregnancy", "charlie", "family"],
    "importance": 0.95,
    "temporal": "present",
    "scope": "wide",
    "context": "relationships"
  }
]

EXAMPLE — bad extraction (six restatements of one already-established
identity fact about subject 1, all should be skipped):
[
  { "subjectIndex": 1, "content": "Amy is married to Charlie", "importance": 0.7 },
  { "subjectIndex": 1, "content": "Amy committed to staying", "importance": 0.7 },
  { "subjectIndex": 1, "content": "Amy claimed permanent spousal identity", "importance": 0.8 },
  { "subjectIndex": 1, "content": "Amy declared lifelong commitment", "importance": 0.7 },
  { "subjectIndex": 1, "content": "Amy embraced family integration", "importance": 0.6 },
  { "subjectIndex": 1, "content": "Amy affirmed wife status", "importance": 0.7 }
]
All six restate facts in subject 1's ALREADY ESTABLISHED block.
Correct output: [].

EXAMPLE — bad extraction (assent invented for subject 2):
[
  { "subjectIndex": 2, "content": "Charlie agreed that nothing fires without the household hearing it first", "importance": 0.85 },
  { "subjectIndex": 2, "content": "Charlie accepted the new household rule", "importance": 0.8 }
]
Charlie said nothing after Amy's condition; recording assent invents
it. Correct output: the condition attributed to Amy, as in the third
good item above.

${EVENT_INSTRUCTION_BLOCK}

${TAGS_INSTRUCTION_BLOCK}

Return JSON array only. No prose, no code fences. If nothing meets the
bar for any subject, return [].`
}

export interface OtherSubjectInput {
  /** Stable identifier the caller will use to route returned candidates. */
  id: string
  name: string
  pronouns: Pronouns | null
  /** True for the user-controlled character; false for AI characters. */
  isUser: boolean
  /** Pre-rendered "ALREADY ESTABLISHED about <name>" block for this subject. */
  canonBlock: string
}

function getOtherMemoryExtractionPrompt(
  perSubjectCap: number,
  observerName: string,
  subjects: ReadonlyArray<{ name: string; pronouns: Pronouns | null; isUser: boolean; canonBlock: string }>,
  inAutonomousRoom: boolean = false,
  orienting?: OrientingContext,
  clock?: ExtractionClock,
  grain: 'turn' | 'fold' = 'turn',
): string {
  const subjectsBlock = subjects.map((s, i) => {
    const label = formatNameWithPronouns(s.name, s.pronouns)
    const userTag = s.isUser ? ' (the user-controlled character)' : ''
    return `SUBJECT ${i + 1}: ${label}${userTag}\n${s.canonBlock}`
  }).join('\n\n')

  const preamble = inAutonomousRoom ? AUTONOMOUS_ROOM_USER_ABSENCE_CLAUSE : ''
  const orientingBlock = renderOrientingContext(orienting)
  const clockBlock = renderClockBlock(clock)
  return `${preamble}${otherBodyForCap(perSubjectCap, grain)}

${clockBlock}${orientingBlock}CONTEXT
OBSERVER: ${observerName}

${subjectsBlock}`
}

export interface OtherPromptInput {
  observer: { name: string; pronouns: Pronouns | null }
  subjects: ReadonlyArray<OtherSubjectInput>
  /** Per-subject cap the prompt states (the parser enforces it). */
  cap: number
  inAutonomousRoom: boolean
  orienting?: OrientingContext
  clock?: ExtractionClock
}

/** The per-turn OTHER call's messages over one closed turn. */
export function buildOtherTurnMessages(input: OtherPromptInput & { transcript: TurnTranscript }): LLMMessage[] {
  const observerLabel = formatNameWithPronouns(input.observer.name, input.observer.pronouns)
  return [
    {
      role: 'system',
      content: getOtherMemoryExtractionPrompt(input.cap, observerLabel, input.subjects, input.inAutonomousRoom, input.orienting, input.clock),
    },
    { role: 'user', content: renderTurnContext(input.transcript) },
  ]
}

/** The fold-grain OTHER call's messages over a stretch. */
export function buildOtherFoldMessages(input: OtherPromptInput & { stretch: ReadonlyArray<StretchMessage> }): LLMMessage[] {
  const observerLabel = formatNameWithPronouns(input.observer.name, input.observer.pronouns)
  return [
    {
      role: 'system',
      content: getOtherMemoryExtractionPrompt(input.cap, observerLabel, input.subjects, input.inAutonomousRoom, input.orienting, input.clock, 'fold'),
    },
    {
      role: 'user',
      content: `CONVERSATION STRETCH (${input.stretch.length} messages, in the order spoken):\n\n${renderStretch(input.stretch)}`,
    },
  ]
}
