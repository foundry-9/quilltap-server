/**
 * Memory-focused cheap LLM tasks.
 */

import type { LLMMessage } from '@/lib/llm/base'
import type { CheapLLMSelection } from '@/lib/llm/cheap-llm'
import type { TurnTranscript } from '@/lib/services/chat-message/turn-transcript'
import type { Pronouns } from '@/lib/schemas/character.types'
import { formatNameWithPronouns } from '../format-utils'
import { executeCheapLLMTask } from './core-execution'
import type {
  ChatMessage,
  CheapLLMTaskResult,
  MemoryCandidate,
  UncensoredFallbackOptions,
} from './types'

/**
 * Hard ceiling on candidates returned from a single extraction call, regardless
 * of the cheap-LLM profile's output-token budget. Applied both in the prompt
 * (so the model is told the cap) and after parsing (as defense-in-depth when
 * the model ignores the instruction).
 */
export const HARD_CANDIDATE_CAP = 3

/** Resolves the per-call maxMemories from the token budget, clamped to the hard cap. */
function resolveMaxMemories(resolvedMaxTokens: number | undefined): number {
  const budgetDerived = Math.ceil((resolvedMaxTokens ?? 8000) / 8000)
  return Math.min(HARD_CANDIDATE_CAP, Math.max(1, budgetDerived))
}

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

DEDUPLICATION
Before finalizing, scan your own list. If two memories encode the
same underlying realization or decision in different words, keep
the more specific one and drop the other.

IMPORTANCE — calibrate to these anchors
  0.90  The subject made a major commitment or had a self-revelation
        that changes how they understand themselves.
  0.65  The subject formed a substantive new opinion, plan, or
        position.
  0.40  The subject expressed a fresh preference, reaction, or novel
        gesture in passing.
  0.20  The subject acted in a way consistent with established identity
        but worth a single note.
  < 0.20  Do not extract.

OUTPUT — first person, past tense, one fact per object.
  content      one sentence stating what the subject did, decided, or
               realized, and the moment that surfaced it
  summary      3–8 words, lowercase, no punctuation
  keywords     2–4 lowercase words
  importance   0.20–1.00, calibrated to anchors above

EXAMPLE — good extraction:
[
  {
    "content": "I committed to restructuring the summarization pipeline around a shared-base-plus-witness-set design after Charlie agreed it was the highest-leverage fix.",
    "summary": "committed to summarizer refactor",
    "keywords": ["summarizer", "commitment", "architecture"],
    "importance": 0.85
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

Return JSON array only. No prose, no code fences. If nothing meets
the bar, return [].`
}

function getSelfMemoryExtractionPrompt(
  maxMemories: number,
  observerName: string,
  canonBlock: string,
): string {
  return `${selfBodyForCap(maxMemories)}

CONTEXT
SUBJECT: ${observerName}

${canonBlock}`
}

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
 * `subjectIsUser` is plumbed through but not currently branched in the
 * prompt body; it is the wired-in branch point for stricter user-subject
 * phrasing if early runs against real data show attribution failures.
 */
function otherBodyForCap(maxMemories: number): string {
  return `You produce memory entries that the observer would retain about the
subject after this exchange.

TASK
Read the exchange below. Select up to ${maxMemories} memories — the ones
the observer would actually carry forward and refer back to, not
everything they could describe. Rank candidates against the criteria,
then return the strongest. Do not pad the array to reach the cap.

WHAT TO PICK (priority order)
1. HINGES — a decision, commitment, agreement, refusal, or realignment
   formed during this exchange.
2. NEW FACTS — concrete information about the subject that is not in
   the ALREADY ESTABLISHED block (see CONTEXT footer below):
   background, history, plans, skills, circumstances, relationships.
3. STATE CHANGES — a shift in the subject's position, mood, or status,
   paired with its cause.
4. EXPRESSED INTENT — something the subject stated they will do, want
   to do, or refuse to do.
5. NOVEL GESTURES OR PHRASING — a new ritual gesture, postural tic, or
   signature phrasing the subject adopted, dropped, or shifted during
   this exchange. These may feed back into the subject's identity over
   time, so capture them when they appear genuinely new — not when the
   subject simply exhibits a gesture already in the ALREADY ESTABLISHED
   block.

WHAT TO SKIP (do not produce a memory for any of these)
- Anything in the ALREADY ESTABLISHED block, restated or slightly
  reworded.
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

DEDUPLICATION
Before finalizing, scan your own list. If two memories encode the
same underlying fact in different words, keep the more specific one
and drop the other. Different framings of the same fact are still
duplicates.

IMPORTANCE — calibrate to these anchors
  0.90  An explicit new commitment or revelation that changes how the
        observer relates to the subject.
  0.60  A new substantive fact about the subject's background, plans,
        or skills.
  0.40  A new preference, trait, or novel gesture expressed in passing.
  0.20  A specific event occurred with the subject present, no new
        information.
  < 0.20  Do not extract.

OUTPUT — third person, past tense, names not pronouns (use the actual
names from the CONTEXT footer below), one fact per object.
  content      one sentence stating the fact and the moment that
               surfaced it
  summary      3–8 words, lowercase, no punctuation, useful for dedup
  keywords     2–4 lowercase words, no phrases
  importance   0.20–1.00, calibrated to anchors above

EXAMPLE — good extraction:
[
  {
    "content": "Amy proposed reframing the cost problem as a four-tier prompt cache layout when Charlie was stuck between two designs.",
    "summary": "proposed four-tier cache layout",
    "keywords": ["cache", "architecture", "proposal"],
    "importance": 0.85
  }
]

EXAMPLE — bad extraction (six restatements of one already-established
identity fact, all should be skipped):
[
  { "content": "Amy is married to Charlie", "importance": 0.7 },
  { "content": "Amy committed to staying", "importance": 0.7 },
  { "content": "Amy claimed permanent spousal identity", "importance": 0.8 },
  { "content": "Amy declared lifelong commitment", "importance": 0.7 },
  { "content": "Amy embraced family integration", "importance": 0.6 },
  { "content": "Amy affirmed wife status", "importance": 0.7 }
]
All six restate facts in the ALREADY ESTABLISHED block. Correct
output: [].

Return JSON array only. No prose, no code fences. If nothing meets
the bar, return [].`
}

function getOtherMemoryExtractionPrompt(
  maxMemories: number,
  observerName: string,
  subjectName: string,
  canonBlock: string,
  _subjectIsUser: boolean,
): string {
  return `${otherBodyForCap(maxMemories)}

CONTEXT
OBSERVER: ${observerName}
SUBJECT: ${subjectName}

${canonBlock}`
}

/**
 * Prompt for extracting memory search keywords from recent conversation
 */
const MEMORY_KEYWORD_EXTRACTION_PROMPT = `You are analyzing recent conversation messages to extract search keywords for a character's memory system.

Your task: Given recent messages from a conversation, produce a list of keywords and short phrases that capture what is being discussed. These keywords will be used to search a character's stored memories for relevant context.

Focus on:
- People, places, and events mentioned
- Topics and themes being discussed
- Emotions and relationship dynamics
- Decisions, preferences, or plans
- Anything the character might have memories about

Do NOT include:
- Generic conversational filler ("hello", "okay", "thanks")
- The character's own name (they already know who they are)
- Overly broad terms that would match everything

Respond with a JSON array of keyword strings (3-10 keywords):
["keyword1", "keyword phrase 2", "keyword3"]

JSON only - no other text.`

const MEMORY_RECAP_PROMPT = `You are summarizing a character's memories to help them recall what they know at the start of a conversation.

You will receive memories organized by importance (high, medium, low), each with a relative age label.

Write a concise first-person narrative summary (from the character's perspective, using "I") of what the character remembers. Focus on:
- Key relationships and what the character knows about other people
- Important events and emotional moments
- Ongoing situations or unresolved threads
- Recent interactions and their significance

Keep the summary under 500 words. Use natural language, not bullet points. Write as a stream of consciousness — what's top of mind, what lingers, what matters. More recent and higher-importance memories should be given more weight.

If there are no memories, respond with exactly: NO_MEMORIES`

/**
 * Shared parser for memory extraction responses. The new prompts set the
 * significance bar internally; the parser drops obviously-empty rows
 * (no content and no summary) and caps the array length.
 */
function parseMemoryCandidateArray(content: string): MemoryCandidate[] {
  try {
    let cleanContent = content.trim()
    if (cleanContent.startsWith('```json')) {
      cleanContent = cleanContent.replace(/^```json\s*/, '').replace(/\s*```$/, '')
    } else if (cleanContent.startsWith('```')) {
      cleanContent = cleanContent.replace(/^```\s*/, '').replace(/\s*```$/, '')
    }

    const parsed = JSON.parse(cleanContent)
    const items = Array.isArray(parsed) ? parsed : [parsed]

    return items
      .map(item => ({
        content: typeof item.content === 'string'
          ? item.content
          : (item.content ? JSON.stringify(item.content) : undefined),
        summary: typeof item.summary === 'string'
          ? item.summary
          : (item.summary ? JSON.stringify(item.summary) : undefined),
        keywords: item.keywords || [],
        importance: typeof item.importance === 'number' ? item.importance : 0.5,
      }))
      .filter(m => (m.content && m.content.length > 0) || (m.summary && m.summary.length > 0))
      .slice(0, HARD_CANDIDATE_CAP)
  } catch {
    return []
  }
}

/**
 * Render the participant roster + joined transcript for inclusion in
 * extraction prompts. Single shared formatter so the user-pass, self-pass
 * and inter-character-pass all see byte-identical input prefixes.
 */
function renderTurnContext(transcript: TurnTranscript): string {
  const roster: string[] = ['PARTICIPANTS IN THIS TURN:']
  if (transcript.userCharacterName) {
    roster.push(`- USER: ${transcript.userCharacterName} (the human participant)`)
  } else if (transcript.userMessage !== null) {
    roster.push('- USER: The human participant')
  }

  if (transcript.characterSlices.length === 1) {
    const slice = transcript.characterSlices[0]
    roster.push(
      `- CHARACTER: ${formatNameWithPronouns(slice.characterName, slice.characterPronouns ?? null)} (an AI character)`
    )
  } else if (transcript.characterSlices.length > 1) {
    roster.push('- CHARACTERS (AI characters in this chat):')
    for (const slice of transcript.characterSlices) {
      roster.push(
        `  * ${formatNameWithPronouns(slice.characterName, slice.characterPronouns ?? null)}`
      )
    }
  }

  const transcriptSections: string[] = []
  if (transcript.userMessage !== null) {
    const userLabel = transcript.userCharacterName
      ? `${transcript.userCharacterName} (the user)`
      : 'The user'
    transcriptSections.push(`${userLabel} says:\n"${transcript.userMessage}"`)
  }
  for (const slice of transcript.characterSlices) {
    const characterLabel = `${formatNameWithPronouns(slice.characterName, slice.characterPronouns ?? null)} (the character)`
    transcriptSections.push(`${characterLabel} says:\n"${slice.text}"`)
  }

  return `${roster.join('\n')}

TURN TRANSCRIPT:

${transcriptSections.join('\n\n')}`
}

/**
 * Extract self-revelatory memories about a single CHARACTER from the joined
 * turn transcript. The prompt names the target character and carries that
 * character's canon block so the extractor can skip already-established
 * identity facts.
 */
export async function extractSelfMemoriesFromTurn(
  transcript: TurnTranscript,
  targetCharacterId: string,
  canonBlock: string,
  selection: CheapLLMSelection,
  userId: string,
  uncensoredFallback?: UncensoredFallbackOptions,
  chatId?: string,
  resolvedMaxTokens?: number
): Promise<CheapLLMTaskResult<MemoryCandidate[]>> {
  const target = transcript.characterSlices.find(s => s.characterId === targetCharacterId)
  if (!target) {
    return { success: true, result: [], usage: undefined }
  }

  const maxMemories = resolveMaxMemories(resolvedMaxTokens)
  const targetLabel = formatNameWithPronouns(target.characterName, target.characterPronouns ?? null)

  const messages: LLMMessage[] = [
    {
      role: 'system',
      content: getSelfMemoryExtractionPrompt(maxMemories, targetLabel, canonBlock),
    },
    {
      role: 'user',
      content: renderTurnContext(transcript),
    },
  ]

  return executeCheapLLMTask(
    selection,
    messages,
    userId,
    parseMemoryCandidateArray,
    'memory-extraction-self',
    chatId,
    undefined,
    uncensoredFallback,
    resolvedMaxTokens
  )
}

/**
 * Extract memories one CHARACTER (the observer) forms about another
 * participant (the subject), who may be another character or the user.
 * Subject lookup checks `characterSlices` first, then falls back to the
 * user character recorded on the transcript when `subjectIsUser` is true.
 *
 * The subject's canon block is pre-rendered by the caller (typically by
 * `loadCanonForObserverAboutSubject`, which prefers an `Others/<name>.md`
 * file in the observer's vault, falling back to the subject's identity
 * property).
 */
export async function extractOtherMemoriesFromTurn(
  transcript: TurnTranscript,
  observerCharacterId: string,
  subjectCharacterId: string,
  subjectIsUser: boolean,
  subjectCanonBlock: string,
  selection: CheapLLMSelection,
  userId: string,
  uncensoredFallback?: UncensoredFallbackOptions,
  chatId?: string,
  resolvedMaxTokens?: number
): Promise<CheapLLMTaskResult<MemoryCandidate[]>> {
  const observer = transcript.characterSlices.find(s => s.characterId === observerCharacterId)
  if (!observer) {
    return { success: true, result: [], usage: undefined }
  }

  let subjectName: string
  let subjectPronouns: Pronouns | null
  if (subjectIsUser) {
    if (transcript.userCharacterId !== subjectCharacterId || !transcript.userCharacterName) {
      return { success: true, result: [], usage: undefined }
    }
    subjectName = transcript.userCharacterName
    subjectPronouns = transcript.userCharacterPronouns ?? null
  } else {
    const subjectSlice = transcript.characterSlices.find(s => s.characterId === subjectCharacterId)
    if (!subjectSlice) {
      return { success: true, result: [], usage: undefined }
    }
    subjectName = subjectSlice.characterName
    subjectPronouns = subjectSlice.characterPronouns ?? null
  }

  const maxMemories = resolveMaxMemories(resolvedMaxTokens)
  const observerLabel = formatNameWithPronouns(observer.characterName, observer.characterPronouns ?? null)
  const subjectLabel = formatNameWithPronouns(subjectName, subjectPronouns)

  const messages: LLMMessage[] = [
    {
      role: 'system',
      content: getOtherMemoryExtractionPrompt(maxMemories, observerLabel, subjectLabel, subjectCanonBlock, subjectIsUser),
    },
    {
      role: 'user',
      content: renderTurnContext(transcript),
    },
  ]

  return executeCheapLLMTask(
    selection,
    messages,
    userId,
    parseMemoryCandidateArray,
    'memory-extraction-other',
    chatId,
    undefined,
    uncensoredFallback,
    resolvedMaxTokens
  )
}

/**
 * Batch memory extraction from multiple message pairs
 * More efficient than calling extractMemoryFromMessage multiple times
 *
 * @param exchanges - Array of user/assistant message pairs
 * @param context - Additional context
 * @param selection - The cheap LLM provider selection
 * @param userId - The user ID for API key retrieval
 * @returns Array of memory candidates
 */
export async function batchExtractMemories(
  exchanges: Array<{ userMessage: string; assistantMessage: string }>,
  context: string,
  selection: CheapLLMSelection,
  userId: string,
  chatId?: string
): Promise<CheapLLMTaskResult<MemoryCandidate[]>> {
  // Format all exchanges for batch processing
  const exchangesText = exchanges
    .map((e, i) => `Exchange ${i + 1}:\nUser: ${e.userMessage}\nAssistant: ${e.assistantMessage}`)
    .join('\n\n---\n\n')

  const batchPrompt = `Analyze these conversation exchanges. For each exchange that contains something significant worth remembering about the user/character, emit a memory object. Skip exchanges that contain nothing significant.

Criteria for significance:
- Personal information shared (preferences, history, relationships, traits)
- Emotional moments or important decisions
- Facts that should persist across conversations
- Changes in character development or relationships

Respond with a JSON array of memory objects (one per significant exchange — skip the rest):
[
  { "content": "...", "summary": "...", "keywords": [...], "importance": 0.X },
  ...
]`

  const messages: LLMMessage[] = [
    {
      role: 'system',
      content: batchPrompt,
    },
    {
      role: 'user',
      content: `Context: ${context}

${exchangesText}`,
    },
  ]

  return executeCheapLLMTask(
    selection,
    messages,
    userId,
    (content: string): MemoryCandidate[] => {
      try {
        // Clean the response
        let cleanContent = content.trim()
        if (cleanContent.startsWith('```json')) {
          cleanContent = cleanContent.replace(/^```json\s*/, '').replace(/\s*```$/, '')
        } else if (cleanContent.startsWith('```')) {
          cleanContent = cleanContent.replace(/^```\s*/, '').replace(/\s*```$/, '')
        }

        const parsed = JSON.parse(cleanContent)
        if (!Array.isArray(parsed)) {
          return []
        }

        return parsed.map((item: Record<string, unknown>) => {
          const content = typeof item.content === 'string'
            ? item.content
            : (item.content ? JSON.stringify(item.content) : undefined)
          const summary = typeof item.summary === 'string'
            ? item.summary
            : (item.summary ? JSON.stringify(item.summary) : undefined)
          return {
            content,
            summary,
            keywords: (item.keywords as string[]) || [],
            importance: typeof item.importance === 'number' ? item.importance : 0.5,
          }
        })
      } catch {
        // If parsing fails, return empty array
        return []
      }
    },
    'batch-memory-extraction',
    chatId
  )
}

/**
 * Extracts memory search keywords from recent conversation messages
 *
 * Used for proactive memory recall: analyzes messages since the character last
 * spoke to find keywords for searching the character's memory store.
 *
 * @param recentMessages - Messages since the character last spoke
 * @param characterName - The name of the character whose memories will be searched
 * @param selection - The cheap LLM provider selection
 * @param userId - The user ID for API key retrieval
 * @param chatId - Optional chat ID for logging
 * @returns Array of keyword strings for memory search
 */
export async function extractMemorySearchKeywords(
  recentMessages: ChatMessage[],
  characterName: string,
  selection: CheapLLMSelection,
  userId: string,
  chatId?: string
): Promise<CheapLLMTaskResult<string[]>> {
  // Truncate messages to keep cheap LLM call fast
  const cappedMessages = recentMessages.slice(-20)
  const conversationText = cappedMessages
    .map(m => {
      const speaker = m.role === 'user' ? 'User' : m.role === 'assistant' ? 'Character' : 'System'
      const content = m.content.length > 500 ? m.content.substring(0, 500) + '...' : m.content
      return `${speaker}: ${content}`
    })
    .join('\n\n')

  const messages: LLMMessage[] = [
    {
      role: 'system',
      content: MEMORY_KEYWORD_EXTRACTION_PROMPT,
    },
    {
      role: 'user',
      content: `Character: ${characterName}\n\nRecent conversation:\n${conversationText}\n\nExtract keywords for searching ${characterName}'s memories:`,
    },
  ]

  return executeCheapLLMTask(
    selection,
    messages,
    userId,
    (content: string): string[] => {
      try {
        // Clean the response - remove markdown code blocks if present
        let cleanContent = content.trim()
        if (cleanContent.startsWith('```json')) {
          cleanContent = cleanContent.replace(/^```json\s*/, '').replace(/\s*```$/, '')
        } else if (cleanContent.startsWith('```')) {
          cleanContent = cleanContent.replace(/^```\s*/, '').replace(/\s*```$/, '')
        }

        const parsed = JSON.parse(cleanContent)
        if (!Array.isArray(parsed)) {
          return []
        }

        // Filter to only string values and limit to 10
        return parsed
          .filter((item: unknown): item is string => typeof item === 'string' && item.trim().length > 0)
          .slice(0, 10)
      } catch {
        return []
      }
    },
    'memory-keyword-extraction',
    chatId
  )
}

/**
 * Summarizes a character's tiered memories into a narrative recap.
 * Sent to the cheap LLM so the character has a sense of "what I remember"
 * at the start of a conversation.
 *
 * @param characterName - The character's name (for prompt context)
 * @param tieredMemories - Memories grouped by importance tier with age labels
 * @param selection - Cheap LLM selection to use
 * @param userId - User ID for API key access
 * @param chatId - Optional chat ID for logging
 * @returns Summarized memory recap text
 */
export async function summarizeMemoryRecap(
  characterName: string,
  tieredMemories: {
    high: Array<{ summary: string; age: string }>
    medium: Array<{ summary: string; age: string }>
    low: Array<{ summary: string; age: string }>
  },
  selection: CheapLLMSelection,
  userId: string,
  chatId?: string,
  uncensoredFallback?: UncensoredFallbackOptions
): Promise<CheapLLMTaskResult<string>> {
  const totalCount = tieredMemories.high.length + tieredMemories.medium.length + tieredMemories.low.length
  if (totalCount === 0) {
    return { success: true, result: '' }
  }

  const formatTier = (label: string, memories: Array<{ summary: string; age: string }>) => {
    if (memories.length === 0) return ''
    const lines = memories.map(m => `- [${m.age}] ${m.summary}`).join('\n')
    return `### ${label} Importance\n${lines}`
  }

  const memoriesText = [
    formatTier('High', tieredMemories.high),
    formatTier('Medium', tieredMemories.medium),
    formatTier('Low', tieredMemories.low),
  ].filter(Boolean).join('\n\n')

  const messages: LLMMessage[] = [
    {
      role: 'system',
      content: MEMORY_RECAP_PROMPT,
    },
    {
      role: 'user',
      content: `Character: ${characterName}\n\n## Memories\n${memoriesText}`,
    },
  ]

  return executeCheapLLMTask(
    selection,
    messages,
    userId,
    (content: string): string => {
      const trimmed = content.trim()
      if (trimmed === 'NO_MEMORIES') return ''
      return trimmed
    },
    'memory-recap-summarization',
    chatId,
    undefined,
    uncensoredFallback
  )
}
