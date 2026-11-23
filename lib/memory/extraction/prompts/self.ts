/**
 * The SELF prompt: what the subject retains about themselves after a turn.
 * Body moved unchanged from the retired `cheap-llm-tasks/memory-tasks.ts`
 * (memory refactor Phase D). The `self-turn` pass (and Carina's answers, which
 * run on it) assembles its messages here.
 *
 * @module memory/extraction/prompts/self
 */

import type { LLMMessage } from '@/lib/llm/base'
import type { TurnTranscript } from '@/lib/services/chat-message/turn-transcript'
import { formatNameWithPronouns } from '../../format-utils'
import { renderTurnContext } from '../window'
import {
  AGREEMENTS_INSTRUCTION_BLOCK,
  REPAIRS_INSTRUCTION_BLOCK,
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
 * Memory extraction prompt: what THE SUBJECT retains about themselves after
 * the turn.
 *
 * The body refers to "the subject" throughout so the prompt prefix is
 * byte-stable across every SELF call — providers' prefix caches can hit
 * regardless of which character is the subject. The actual subject name
 * and canon block sit in a CONTEXT footer at the end, where divergence
 * doesn't break upstream caching.
 */
function selfBodyForCap(maxMemories: number): string {
  return `You produce memory entries that the subject would retain about themselves
after this exchange.

TASK
Read the exchange below. Select up to ${maxMemories} memories — moments
where the subject acted, decided, realized, or shifted in ways they
would themselves want to remember. Self-knowledge is rarer than
other-knowledge; if nothing genuinely new surfaced, return [].

WHAT TO PICK (priority order)
1. SELF-HINGES — the subject made a decision, formed a commitment,
   refused something, or changed course during this exchange.
2. SELF-REVELATIONS — the subject realized, articulated, or admitted
   something about themselves that is not in the ALREADY ESTABLISHED
   block (see CONTEXT footer below).
3. STATE CHANGES — the subject's mood, position, or stance shifted
   during this exchange, paired with its cause.
4. EXPRESSED INTENT — the subject committed to a future action, build,
   or refusal.
5. NOVEL GESTURES OR PHRASING — the subject adopted a new gesture,
   dropped an old one, or shifted habitual phrasing during this
   exchange. These may feed back into identity over time. Capture only
   when genuinely new — not when the subject performs a gesture already
   in the ALREADY ESTABLISHED block.
6. EVENTS — a specific thing that happened to the subject at a specific
   time and/or place: an outing, a visit, an arrival, a discovery, an
   incident. Mark these "kind": "episodic" and follow the EVENTS block
   below.

WHAT TO SKIP
- Anything in the ALREADY ESTABLISHED block, restated or slightly
  reworded. Manifesto-level traits and canonical relationships are not
  memories — they are who the subject already is.
- Reflective prose without an action, decision, or genuine new
  realization attached. The subject thinking about something is not a
  memory; the subject deciding because of it, or seeing themselves
  newly because of it, is.
- Affection, attraction, or emotional warmth toward established
  partners, unless this exchange marks a shift in degree or kind.
- Habitual gestures, postural tics, or signature phrasing that the
  subject already does per the canon block. Novel or shifted ones
  belong under category 5, not here.
- Narrative references to tool output: terminal sessions, file paths,
  exit codes, commit hashes, command names.
${ORIENTING_CONTEXT_SKIP_BULLET}

${AGREEMENTS_INSTRUCTION_BLOCK}

${REPAIRS_INSTRUCTION_BLOCK}

${ESTABLISHED_FACT_INSTRUCTION_BLOCK}

DEDUPLICATION
Before finalizing, scan your own list. If two memories encode the
same underlying realization or decision in different words, keep
the more specific one and drop the other.

IMPORTANCE — calibrate to these anchors
  0.95  A fact that redefines the subject's life or bonds: marriage,
        vows, pregnancy, birth, death, a change of body, joining or
        leaving the family.
  0.85  The subject had a self-revelation that changes how they
        understand themselves, or made a personal commitment
        (one the subject spoke themselves) to another person about
        their relationship — or made a repair: forgave, accepted an
        apology, or made amends, scored at least as high as what it
        repairs.
  0.65  The subject formed a substantive new opinion, plan, or
        position — including a commitment to build, file, fix, or
        rule on something.
  0.45  The subject made a work decision, ruling, or task agreement
        in passing.
  0.40  The subject expressed a fresh preference, reaction, or novel
        gesture in passing.
  0.20  The subject acted in a way consistent with established identity
        but worth a single note.
  < 0.20  Do not extract.
${IMPORTANCE_WORK_CEILING_NOTE}

${IMPORTANCE_FACT_NOT_TELLING_NOTE}

OUTPUT — first person, past tense, one fact per object.
  content      one sentence stating what the subject did, decided, or
               realized, and the moment that surfaced it
  summary      3–8 words, lowercase, no punctuation
  keywords     2–4 lowercase words
  importance   0.20–1.00, calibrated to anchors above
  kind         "episodic" for an EVENT, otherwise omit (or "semantic")
  when         EVENTs only: when it happened (see EVENTS block)
  entities     EVENTs only: proper nouns of the episode

EXAMPLE — good extraction:
[
  {
    "content": "I committed to restructuring the summarization pipeline around a shared-base-plus-witness-set design after Charlie agreed it was the highest-leverage fix.",
    "summary": "committed to summarizer refactor",
    "keywords": ["summarizer", "commitment", "architecture"],
    "importance": 0.65,
    "temporal": "future",
    "scope": "narrow",
    "context": "philosophy"
  },
  {
    "content": "I told Charlie and Amy at breakfast that I am pregnant with Charlie's daughter, and that I have known since August.",
    "summary": "told charlie and amy i am pregnant",
    "keywords": ["pregnancy", "daughter", "family"],
    "importance": 0.95,
    "temporal": "present",
    "scope": "wide",
    "context": "relationships"
  }
]

EXAMPLE — bad extraction (reflective prose and re-stated identity,
all should be skipped):
[
  { "content": "I adjusted my spectacles before reasoning", "importance": 0.5 },
  { "content": "I called Charlie 'Chief'", "importance": 0.6 },
  { "content": "I felt warmth toward Amy", "importance": 0.7 },
  { "content": "I thought carefully about the problem", "importance": 0.5 }
]
All four are established identity, ritual, or non-actionable
reflection. Correct output: [].

${EVENT_INSTRUCTION_BLOCK}

${TAGS_INSTRUCTION_BLOCK}

Return JSON array only. No prose, no code fences. If nothing meets
the bar, return [].`
}

/**
 * Which stated-particulars instruction a SELF call carries, if any:
 *  - `story` — a roleplay character's ordinary turn. What they told others as
 *    fact (a name, a date, a figure, what a record says) is recorded as the
 *    telling, so they can tell it the same way in a later conversation.
 *  - `carina` — a reference answer. The whole exchange is a stated fact:
 *    record what was asked and what was answered.
 *
 * Both exist because a story character may supply detail nobody has written
 * down (`lib/chat/context/story-character-section.ts`), and an invention that
 * is not remembered is told differently the next time: in the V4test
 * evaluation an archivist gave four different years for one lighthouse across
 * two chats, because "the lighthouse was raised in 1799" is none of the six
 * categories above and the pass returned [].
 *
 * The memory is the TELLING ("I told Sam that…"), never the bare fact. A
 * character may lie, guess or be wrong; what is true of them is that they
 * said it — which is also what a liar needs in order to keep the story
 * straight.
 *
 * Design of record: docs/developer/features/roleplay-character-latitude.md §13
 */
export type StatedParticularsMode = 'story' | 'carina'

const STATED_PARTICULARS_OUTPUT = `Write it in ONE memory that carries the particulars themselves — every
name, date, figure and source — not one memory per detail, and mark
that object "stated": true. It does not count toward the limit above;
return at most one such object.
  importance   0.35, or 0.45 when others are plainly going to act on it
  temporal     "present"
  context      "information"`

/**
 * The stated-particulars block for a roleplay character's ordinary turn.
 * Appended after the body, so the body stays byte-stable for prefix caches.
 */
export const STATED_PARTICULARS_STORY_BLOCK = `STATED PARTICULARS — one further category, beside the six above
The subject is a character in a story. What they tell others as fact,
they must be able to tell the same way later. Record a stated
particular only when ALL of these hold:
- the subject asserted it in their own lines, as fact: what they
  found, read, saw, were told, or know from their trade or their past;
- it names something a person could ask about again: a proper name, a
  date or year, a figure or price, a place, or what a document or
  record says;
- it is not in the ALREADY ESTABLISHED block.
Record the telling, never the bare fact, and name who was told:
"I told Sam that the boathouse deed is in Amos Cottrell's name, entered
in the third volume for Carrow parish, and that Cottrell has been dead
nine years."
Do NOT record: jokes, exaggeration, guesses, questions, opinions,
plans, description of the scene, anything the subject only repeated
back from another speaker, and anything another speaker stated.
If the subject's own lines in this exchange withdraw, correct or admit
the falsehood of an earlier account, record that instead: "I admitted
to Sam that I never got into the records office and made up the name
Cottrell."
${STATED_PARTICULARS_OUTPUT}`

/** The block for a Carina reference answer (any kind of answerer). */
export const STATED_PARTICULARS_CARINA_BLOCK = `REFERENCE ANSWER — one further category, beside the six above
This exchange is a consultation: the subject was asked a question and
gave a reference answer. The subject must give the same answer if
asked again. Unless the answer was that the subject does not know or
could not find it, record what was asked and what the subject
answered:
"Asked when the Carrow lighthouse was built, I answered that it was
raised in 1799 by Isaac Coombe, master mason of Harbour Row, at a cost
to the town of £496 17s 6d, citing the Town Works Ledger, vol. I,
folio 112."
Record the answer as given, never as bare fact, and do not correct,
shorten or improve it.
${STATED_PARTICULARS_OUTPUT}`

/** Most earlier tellings shown to one call, and the length each is cut to. */
export const PRIOR_TELLINGS_SHOWN = 6
const PRIOR_TELLING_MAX_CHARS = 500

/** Words too common to say two accounts are about the same thing. */
const TELLING_STOPWORDS = new Set([
  'that', 'this', 'with', 'from', 'have', 'been', 'were', 'what', 'when', 'where', 'which', 'would', 'could',
  'there', 'their', 'them', 'they', 'then', 'than', 'told', 'asked', 'answered', 'said', 'about', 'into', 'your',
  'will', 'shall', 'does', 'only', 'very', 'more', 'some', 'such', 'because', 'before', 'after', 'again',
])

function tellingWords(text: string): Set<string> {
  const words = text.toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) ?? []
  return new Set(words.filter(w => !TELLING_STOPWORDS.has(w)))
}

/**
 * The earlier tellings worth showing for this exchange: those sharing at
 * least two distinctive words with it, most shared first, at most
 * {@link PRIOR_TELLINGS_SHOWN}. Pure and embedding-free — it only has to
 * catch a retelling, which repeats its own names and figures. With nothing
 * in common the list is empty and the prompt carries no block.
 */
export function selectPriorTellings(tellings: readonly string[], exchangeText: string): string[] {
  const exchange = tellingWords(exchangeText)
  if (exchange.size === 0) return []
  return tellings
    .map((telling, index) => {
      let shared = 0
      for (const word of tellingWords(telling)) if (exchange.has(word)) shared++
      return { telling, index, shared }
    })
    .filter(t => t.shared >= 2)
    .sort((a, b) => b.shared - a.shared || a.index - b.index)
    .slice(0, PRIOR_TELLINGS_SHOWN)
    .map(t => (t.telling.length > PRIOR_TELLING_MAX_CHARS ? `${t.telling.slice(0, PRIOR_TELLING_MAX_CHARS)}…` : t.telling))
}

/**
 * The ALREADY TOLD footer: what the subject has told before that bears on
 * this exchange. It rides at the very end of the prompt (variable text, so
 * the cached prefix above it does not move), and is absent when empty.
 */
function renderAlreadyTold(tellings: readonly string[]): string {
  if (tellings.length === 0) return ''
  return `

ALREADY TOLD by the subject (earlier accounts, already remembered)
${tellings.map(t => `- ${t}`).join('\n')}
If what the subject says in this exchange is the same account as one of
these — the same names, dates and figures, however reworded or
extended with small detail — record NOTHING under STATED PARTICULARS /
REFERENCE ANSWER. If it differs from one of these on a name, a date, a
figure or what a record says, record the new account and say what it
replaces: "I told Sam the deed is in Josiah Pike's name, where I had
earlier told him Amos Cottrell."`
}

const STATED_PARTICULARS_BLOCKS: Readonly<Record<StatedParticularsMode, string>> = {
  story: STATED_PARTICULARS_STORY_BLOCK,
  carina: STATED_PARTICULARS_CARINA_BLOCK,
}

/**
 * Prepended to the SELF prompt when the subject is a character a human is
 * driving directly (its turn slice was authored by the user). Human role-play
 * is frequently first person ("I told her I wouldn't go"), whereas the SELF
 * extractor is otherwise tuned on third-person-ish assistant prose. This clause
 * binds first-person pronouns in the subject's own lines to the subject so the
 * extractor attributes those decisions and realizations correctly.
 *
 * It is a *prepended* preamble (like the autonomous clause) so the cached
 * `selfBodyForCap(...)` prefix stays byte-stable for the common AI path;
 * user-controlled SELF calls simply form their own cache lineage.
 */
const FIRST_PERSON_USER_CLAUSE =
  `IMPORTANT: The SUBJECT below is a character a human is playing directly, so ` +
  `the SUBJECT's lines in the transcript may be written in the first person. ` +
  `Read every "I", "me", "my", and "myself" in the SUBJECT's own lines as ` +
  `referring to the SUBJECT — attribute those decisions, realizations, and ` +
  `actions to the SUBJECT, not to anyone else in the exchange. ` +
  `The SUBJECT's lines came first in this turn and the SUBJECT has not yet ` +
  `responded to anything the characters said after them. Never record the ` +
  `SUBJECT as having accepted, agreed to, or consented to anything proposed ` +
  `in those later lines.\n\n`

function getSelfMemoryExtractionPrompt(
  maxMemories: number,
  observerName: string,
  canonBlock: string,
  inAutonomousRoom: boolean = false,
  orienting?: OrientingContext,
  isUserControlled: boolean = false,
  clock?: ExtractionClock,
  statedParticulars: StatedParticularsMode | null = null,
  priorTellings: readonly string[] = [],
): string {
  const preamble =
    (isUserControlled ? FIRST_PERSON_USER_CLAUSE : '') +
    (inAutonomousRoom ? AUTONOMOUS_ROOM_USER_ABSENCE_CLAUSE : '')
  const orientingBlock = renderOrientingContext(orienting)
  const clockBlock = renderClockBlock(clock)
  // After the body, so the body's bytes (and the provider's prefix cache)
  // are the same whether or not the call asks for stated particulars.
  const statedBlock = statedParticulars ? `${STATED_PARTICULARS_BLOCKS[statedParticulars]}\n\n` : ''
  return `${preamble}${selfBodyForCap(maxMemories)}

${statedBlock}${clockBlock}${orientingBlock}CONTEXT
SUBJECT: ${observerName}

${canonBlock}${statedParticulars ? renderAlreadyTold(priorTellings) : ''}`
}

export interface SelfTurnPromptInput {
  transcript: TurnTranscript
  /** The slice whose holder the memories are for. */
  holderId: string
  canonBlock: string
  /** Candidates asked for (the prompt states it; the parser enforces it). */
  cap: number
  inAutonomousRoom: boolean
  orienting?: OrientingContext
  clock?: ExtractionClock
  /** Ask for stated particulars, and in which form; absent or null asks for none. */
  statedParticulars?: StatedParticularsMode | null
  /**
   * What the holder has already told as fact (`ExtractionContext.priorTellings`).
   * The ones that bear on this exchange are shown, so a retelling is not
   * recorded again. Read only when stated particulars are asked for.
   */
  priorTellings?: readonly string[]
}

/** The SELF call's messages, or null when the holder has no slice in the turn. */
export function buildSelfTurnMessages(input: SelfTurnPromptInput): LLMMessage[] | null {
  const target = input.transcript.characterSlices.find(s => s.characterId === input.holderId)
  if (!target) return null
  const targetLabel = formatNameWithPronouns(target.characterName, target.characterPronouns ?? null)
  return [
    {
      role: 'system',
      content: getSelfMemoryExtractionPrompt(
        input.cap,
        targetLabel,
        input.canonBlock,
        input.inAutonomousRoom,
        input.orienting,
        target.isUserControlled ?? false,
        input.clock,
        input.statedParticulars ?? null,
        input.statedParticulars
          ? selectPriorTellings(input.priorTellings ?? [], `${input.transcript.userMessage ?? ''}\n${target.text}`)
          : [],
      ),
    },
    { role: 'user', content: renderTurnContext(input.transcript) },
  ]
}
