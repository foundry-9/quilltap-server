/**
 * Memory-focused cheap LLM tasks.
 */

import type { LLMMessage } from '@/lib/llm/base'
import type { CheapLLMSelection } from '@/lib/llm/cheap-llm'
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
 * Memory extraction prompt for user memories.
 * Returns a prompt instructing the LLM to extract an array of discrete facts.
 */
function getUserMemoryExtractionPrompt(maxMemories: number): string {
  return `You are extracting memories about the USER (the human participant) from a conversation.

TASK: Identify ALL significant discrete facts about the USER that should be remembered. Break the exchange down into individual facts — each one gets its own memory object.

WHAT TO LOOK FOR (about the USER only):
- Personal information the USER shares (preferences, history, relationships, traits)
- Emotional moments or important decisions the USER makes
- Facts about the USER that should persist across conversations

CRITICAL ATTRIBUTION RULES - READ CAREFULLY:
1. Each message is labeled with WHO said it (e.g., "The user says:" or "Friday says:")
2. ONLY extract information from messages labeled as coming from the USER
3. If a CHARACTER describes files, inventory, or information - that is the CHARACTER speaking, NOT the user
4. The USER only reveals things about themselves through THEIR OWN words
5. What a CHARACTER knows or describes is NOT what the USER said

EXAMPLE OF CORRECT ATTRIBUTION:
- "The user says: I'm working on a novel about dragons" → USER fact: working on a dragon novel ✓
- "Friday (the character) says: I see you have 39 files" → This is the CHARACTER's observation, NOT a user fact ✗
- "The user says: That's interesting" → USER showed interest, but no significant personal fact

Respond with a JSON array of memory objects. Each distinct fact should be its own object.
Return at most ${maxMemories} memories. If nothing is significant, return an empty array [].

[
  {
    "significant": true,
    "content": "What we learned about the user FROM THEIR OWN WORDS",
    "summary": "Brief 1-sentence summary",
    "keywords": ["keyword1", "keyword2"],
    "importance": 0.0-1.0
  }
]

If nothing significant about the USER (from their own words), respond with: []

JSON array only - no other text.`
}

/**
 * Memory extraction prompt for character memories.
 * Returns a prompt instructing the LLM to extract an array of discrete facts.
 */
function getCharacterMemoryExtractionPrompt(maxMemories: number): string {
  return `You are extracting memories about a specific CHARACTER from a conversation.

TASK: Identify ALL significant discrete facts that the specified CHARACTER reveals about themselves. Break the exchange down into individual facts — each one gets its own memory object.

WHAT TO LOOK FOR (about the CHARACTER only):
- Personal information the CHARACTER shares (preferences, history, relationships, traits, background)
- Emotional moments or important decisions the CHARACTER experiences
- Facts about the CHARACTER that should persist across conversations
- How the CHARACTER behaves, speaks, or presents themselves

CRITICAL ATTRIBUTION RULES - READ CAREFULLY:
1. Each message is labeled with WHO said it (e.g., "The user says:" or "Friday says:")
2. ONLY extract information from messages labeled as coming from the TARGET CHARACTER
3. If the USER describes something - that is the USER speaking, NOT the character
4. The CHARACTER only reveals things about themselves through THEIR OWN words and actions
5. What the USER says or knows is NOT a character memory

EXAMPLE OF CORRECT ATTRIBUTION:
- "Friday (the character) says: I've been keeping track of your files" → CHARACTER fact: Friday tracks files ✓
- "The user says: You're very organized" → This is the USER's opinion, NOT a character self-revelation ✗
- "Friday (the character) says: *adjusts glasses thoughtfully*" → CHARACTER behavior: uses glasses, thoughtful mannerisms ✓

Respond with a JSON array of memory objects. Each distinct fact should be its own object.
Return at most ${maxMemories} memories. If nothing is significant, return an empty array [].

[
  {
    "significant": true,
    "content": "What we learned about the character FROM THEIR OWN WORDS/ACTIONS",
    "summary": "Brief 1-sentence summary",
    "keywords": ["keyword1", "keyword2"],
    "importance": 0.0-1.0
  }
]

If nothing significant about the CHARACTER (from their own words/actions), respond with: []

JSON array only - no other text.`
}

/**
 * Memory extraction prompt for inter-character memories.
 * Returns a prompt instructing the LLM to extract an array of discrete facts.
 */
function getInterCharacterMemoryExtractionPrompt(maxMemories: number): string {
  return `You are extracting memories that one CHARACTER has learned about ANOTHER CHARACTER from their conversation.
Analyze the conversation exchange below and identify ALL significant discrete facts that CHARACTER A learns about CHARACTER B that should be remembered for future conversations. Break the exchange down into individual facts — each one gets its own memory object.

Criteria for significance:
- Personal information CHARACTER B shares or reveals (preferences, history, relationships, traits, background)
- Emotional moments or important decisions that reveal CHARACTER B's nature
- Facts about CHARACTER B that should persist across conversations
- Relationship dynamics established between the two characters
- Observations CHARACTER A would naturally make about CHARACTER B

IMPORTANT: Extract what CHARACTER A would remember about CHARACTER B based on this exchange.
Each memory should capture a single discrete fact CHARACTER A learns about CHARACTER B from this interaction.

Respond with a JSON array of memory objects. Each distinct fact should be its own object.
Return at most ${maxMemories} memories. If nothing is significant, return an empty array [].

[
  {
    "significant": true,
    "content": "Full memory content describing what Character A learns about Character B",
    "summary": "Brief 1-sentence summary",
    "keywords": ["keyword1", "keyword2"],
    "importance": 0.0-1.0
  }
]

If nothing significant, respond with: []

JSON array only - no other text.`
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
 * Shared parser for memory extraction responses.
 * Handles both array and single-object responses from LLMs for backward compatibility.
 * Filters to only significant candidates.
 */
function parseMemoryCandidateArray(content: string): MemoryCandidate[] {
  try {
    // Clean the response - remove markdown code blocks if present
    let cleanContent = content.trim()
    if (cleanContent.startsWith('```json')) {
      cleanContent = cleanContent.replace(/^```json\s*/, '').replace(/\s*```$/, '')
    } else if (cleanContent.startsWith('```')) {
      cleanContent = cleanContent.replace(/^```\s*/, '').replace(/\s*```$/, '')
    }

    const parsed = JSON.parse(cleanContent)

    // Backward compatibility: if LLM returns a single object, wrap in array
    const items = Array.isArray(parsed) ? parsed : [parsed]

    return items
      .map(item => ({
        significant: item.significant === true,
        // Ensure content is always a string (some LLMs return objects)
        content: typeof item.content === 'string'
          ? item.content
          : (item.content ? JSON.stringify(item.content) : undefined),
        summary: typeof item.summary === 'string'
          ? item.summary
          : (item.summary ? JSON.stringify(item.summary) : undefined),
        keywords: item.keywords || [],
        importance: typeof item.importance === 'number' ? item.importance : 0.5,
      }))
      .filter(m => m.significant)
  } catch {
    // If JSON parsing fails, return empty array
    return []
  }
}

/**
 * Extracts potential memories about the USER from a message exchange.
 * Returns an array of significant memory candidates (may be empty).
 *
 * @param userMessage - The user's message
 * @param assistantMessage - The assistant's response
 * @param context - Additional context (participant list, etc.)
 * @param characterName - The name of the character responding
 * @param userCharacterName - The user character's name (optional)
 * @param selection - The cheap LLM provider selection
 * @param userId - The user ID for API key retrieval
 * @param resolvedMaxTokens - Resolved max output tokens for the cheap LLM profile
 * @returns An array of significant memory candidates
 */
export async function extractMemoryFromMessage(
  userMessage: string,
  assistantMessage: string,
  context: string,
  characterName: string,
  userCharacterName: string | undefined,
  selection: CheapLLMSelection,
  userId: string,
  uncensoredFallback?: UncensoredFallbackOptions,
  chatId?: string,
  characterPronouns?: Pronouns | null,
  resolvedMaxTokens?: number
): Promise<CheapLLMTaskResult<MemoryCandidate[]>> {
  const maxMemories = Math.ceil((resolvedMaxTokens ?? 8000) / 8000)
  // Use clear "X says:" format to help the model distinguish speakers
  const userLabel = userCharacterName ? `${userCharacterName} (the user)` : 'The user'
  const characterLabel = `${formatNameWithPronouns(characterName, characterPronouns)} (the character)`

  const messages: LLMMessage[] = [
    {
      role: 'system',
      content: getUserMemoryExtractionPrompt(maxMemories),
    },
    {
      role: 'user',
      content: `${context}

CONVERSATION TRANSCRIPT:

${userLabel} says:
"${userMessage}"

${characterLabel} says:
"${assistantMessage}"`,
    },
  ]

  return executeCheapLLMTask(
    selection,
    messages,
    userId,
    parseMemoryCandidateArray,
    'memory-extraction-user',
    chatId,
    undefined,
    uncensoredFallback,
    resolvedMaxTokens
  )
}

/**
 * Extracts potential memories about the CHARACTER from a message exchange.
 * Returns an array of significant memory candidates (may be empty).
 *
 * @param userMessage - The user's message
 * @param assistantMessage - The character's response
 * @param context - Additional context (participant list, etc.)
 * @param characterName - The character's name for context
 * @param userCharacterName - The user character's name (optional)
 * @param selection - The cheap LLM provider selection
 * @param userId - The user ID for API key retrieval
 * @param resolvedMaxTokens - Resolved max output tokens for the cheap LLM profile
 * @returns An array of significant memory candidates
 */
export async function extractCharacterMemoryFromMessage(
  userMessage: string,
  assistantMessage: string,
  context: string,
  characterName: string,
  userCharacterName: string | undefined,
  selection: CheapLLMSelection,
  userId: string,
  uncensoredFallback?: UncensoredFallbackOptions,
  chatId?: string,
  characterPronouns?: Pronouns | null,
  resolvedMaxTokens?: number
): Promise<CheapLLMTaskResult<MemoryCandidate[]>> {
  const maxMemories = Math.ceil((resolvedMaxTokens ?? 8000) / 8000)
  // Use clear "X says:" format to help the model distinguish speakers
  const userLabel = userCharacterName ? `${userCharacterName} (the user)` : 'The user'
  const characterLabel = `${formatNameWithPronouns(characterName, characterPronouns)} (the character)`

  const messages: LLMMessage[] = [
    {
      role: 'system',
      content: getCharacterMemoryExtractionPrompt(maxMemories),
    },
    {
      role: 'user',
      content: `${context}

TARGET CHARACTER: ${formatNameWithPronouns(characterName, characterPronouns)}

CONVERSATION TRANSCRIPT:

${userLabel} says:
"${userMessage}"

${characterLabel} says:
"${assistantMessage}"`,
    },
  ]

  return executeCheapLLMTask(
    selection,
    messages,
    userId,
    parseMemoryCandidateArray,
    'memory-extraction-character',
    chatId,
    undefined,
    uncensoredFallback,
    resolvedMaxTokens
  )
}

/**
 * Extracts potential memories that one character has about another character.
 * Returns an array of significant memory candidates (may be empty).
 *
 * @param characterAName - The character who will remember (the observer)
 * @param characterAMessage - What character A said
 * @param characterBName - The character being remembered (the subject)
 * @param characterBMessage - What character B said
 * @param selection - The cheap LLM provider selection
 * @param userId - The user ID for API key retrieval
 * @param resolvedMaxTokens - Resolved max output tokens for the cheap LLM profile
 * @returns An array of significant memory candidates
 */
export async function extractInterCharacterMemoryFromMessage(
  characterAName: string,
  characterAMessage: string,
  characterBName: string,
  characterBMessage: string,
  selection: CheapLLMSelection,
  userId: string,
  uncensoredFallback?: UncensoredFallbackOptions,
  chatId?: string,
  characterAPronouns?: Pronouns | null,
  characterBPronouns?: Pronouns | null,
  resolvedMaxTokens?: number
): Promise<CheapLLMTaskResult<MemoryCandidate[]>> {
  const maxMemories = Math.ceil((resolvedMaxTokens ?? 8000) / 8000)
  const characterALabel = formatNameWithPronouns(characterAName, characterAPronouns)
  const characterBLabel = formatNameWithPronouns(characterBName, characterBPronouns)

  const messages: LLMMessage[] = [
    {
      role: 'system',
      content: getInterCharacterMemoryExtractionPrompt(maxMemories),
    },
    {
      role: 'user',
      content: `Character A (the observer): ${characterALabel}
Character B (the subject): ${characterBLabel}

CONVERSATION:
${characterALabel}: ${characterAMessage}

${characterBLabel}: ${characterBMessage}`,
    },
  ]

  return executeCheapLLMTask(
    selection,
    messages,
    userId,
    parseMemoryCandidateArray,
    'memory-extraction-inter-character',
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

  const batchPrompt = `Analyze these conversation exchanges. For each exchange, determine if there is something significant worth remembering about the user/character.

Criteria for significance:
- Personal information shared (preferences, history, relationships, traits)
- Emotional moments or important decisions
- Facts that should persist across conversations
- Changes in character development or relationships

Respond with a JSON array of results, one for each exchange:
[
  { "significant": true/false, "content": "...", "summary": "...", "keywords": [...], "importance": 0.X },
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
          // Ensure content is always a string (some LLMs return objects)
          const content = typeof item.content === 'string'
            ? item.content
            : (item.content ? JSON.stringify(item.content) : undefined)
          const summary = typeof item.summary === 'string'
            ? item.summary
            : (item.summary ? JSON.stringify(item.summary) : undefined)
          return {
            significant: item.significant === true,
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
