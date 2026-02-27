/**
 * Cheap LLM Tasks Service
 * Sprint 2: Memory System - Background LLM Tasks
 *
 * This module provides functions that use a cheap/fast LLM for background tasks
 * like memory extraction, chat summarization, and title generation.
 * These tasks don't require expensive models and should be cost-efficient.
 */

import { createLLMProvider } from '@/lib/llm'
import { LLMMessage, LLMResponse } from '@/lib/llm/base'
import { CheapLLMSelection } from '@/lib/llm/cheap-llm'
import { getRepositories } from '@/lib/repositories/factory'
import { decryptApiKey } from '@/lib/encryption'
import { getErrorMessage } from '@/lib/errors'
import { logger } from '@/lib/logger'
import { logLLMCall } from '@/lib/services/llm-logging.service'
import type { LLMLogType } from '@/lib/schemas/llm-log.types'
import type { DangerousContentSettings } from '@/lib/schemas/settings.types'
import type { ConnectionProfile } from '@/lib/schemas/types'

/**
 * Candidate memory extracted from a conversation
 */
export interface MemoryCandidate {
  /** Whether the message contains something significant worth remembering */
  significant: boolean
  /** Full memory content (if significant) */
  content?: string
  /** Brief 1-sentence summary (if significant) */
  summary?: string
  /** Keywords for text-based search */
  keywords?: string[]
  /** Importance score from 0.0 to 1.0 */
  importance?: number
}

/**
 * Chat message format for summarization tasks
 */
export interface ChatMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
}

/**
 * Attachment metadata for description task
 */
export interface Attachment {
  id: string
  filename: string
  mimeType: string
  /** Base64 encoded data */
  data?: string
}

/**
 * Result of a cheap LLM task
 */
export interface CheapLLMTaskResult<T> {
  success: boolean
  result?: T
  error?: string
  /** Token usage for cost tracking */
  usage?: {
    promptTokens: number
    completionTokens: number
    totalTokens: number
  }
}

/**
 * Options for uncensored provider fallback when empty responses are detected
 * Only used when the Concierge is in AUTO_ROUTE mode with an uncensored text profile configured
 */
export interface UncensoredFallbackOptions {
  dangerSettings: DangerousContentSettings
  availableProfiles: ConnectionProfile[]
}

/**
 * Internal type for provider response
 */
interface ProviderResponse {
  content: string
  usage?: {
    promptTokens: number
    completionTokens: number
    totalTokens: number
  }
}

/**
 * Session-level cache for profiles that don't support custom temperature
 */
const profilesWithoutCustomTemp = new Set<string>()

/**
 * Maps a cheap LLM task type to an LLM log type for logging
 */
function mapTaskTypeToLogType(taskType?: string): LLMLogType {
  const mapping: Record<string, LLMLogType> = {
    'memory-extraction-user': 'MEMORY_EXTRACTION',
    'memory-extraction-character': 'MEMORY_EXTRACTION',
    'memory-extraction-inter-character': 'MEMORY_EXTRACTION',
    'title-chat': 'TITLE_GENERATION',
    'title-from-summary': 'TITLE_GENERATION',
    'consider-title-update': 'TITLE_GENERATION',
    'compress-conversation-history': 'CONTEXT_COMPRESSION',
    'compress-system-prompt': 'CONTEXT_COMPRESSION',
    'summarize-chat': 'SUMMARIZATION',
    'update-context-summary': 'SUMMARIZATION',
    'craft-image-prompt': 'IMAGE_PROMPT_CRAFTING',
    'describe-attachment': 'IMAGE_DESCRIPTION',
    'batch-memory-extraction': 'MEMORY_EXTRACTION',
    'craft-story-background-prompt': 'IMAGE_PROMPT_CRAFTING',
    'derive-scene-context': 'SUMMARIZATION',
    'memory-keyword-extraction': 'MEMORY_EXTRACTION',
    'resolve-character-appearances': 'APPEARANCE_RESOLUTION',
    'sanitize-appearance': 'APPEARANCE_RESOLUTION',
  }
  return mapping[taskType || ''] || 'SUMMARIZATION'
}

/**
 * Gets the decrypted API key for a cheap LLM selection
 */
async function getApiKeyForSelection(
  selection: CheapLLMSelection,
  userId: string
): Promise<string | null> {
  if (selection.isLocal) {
    // Local models don't need an API key
    return ''
  }

  if (!selection.connectionProfileId) {
    return null
  }

  const repos = getRepositories()
  const profile = await repos.connections.findById(selection.connectionProfileId)
  if (!profile?.apiKeyId) {
    return null
  }

  const apiKey = await repos.connections.findApiKeyByIdAndUserId(profile.apiKeyId, userId)
  if (!apiKey) {
    return null
  }

  return decryptApiKey(apiKey.ciphertext, apiKey.iv, apiKey.authTag, userId)
}

/**
 * Sends messages to a cheap LLM provider with temperature handling and logging
 * Extracted from executeCheapLLMTask to avoid tripling the code for each temperature path
 */
async function sendToProvider(
  selection: CheapLLMSelection,
  messages: LLMMessage[],
  userId: string,
  taskType?: string,
  chatId?: string,
  messageId?: string
): Promise<ProviderResponse> {
  const apiKey = await getApiKeyForSelection(selection, userId)
  if (apiKey === null) {
    throw new Error('No API key available for cheap LLM provider')
  }

  const provider = await createLLMProvider(
    selection.provider,
    selection.baseUrl
  )

  const profileKey = `${selection.provider}:${selection.modelName}`

  const logCall = (response: LLMResponse, temperature?: number) => {
    logLLMCall({
      userId,
      type: mapTaskTypeToLogType(taskType),
      chatId,
      messageId,
      provider: selection.provider,
      modelName: selection.modelName,
      request: {
        messages: messages.map(m => ({ role: m.role, content: m.content })),
        ...(temperature !== undefined ? { temperature } : {}),
        maxTokens: 1000,
      },
      response: {
        content: response.content,
      },
      usage: response.usage,
    }).catch(err => {
      logger.warn('Failed to log cheap LLM call', {
        error: err instanceof Error ? err.message : String(err)
      })
    })
  }

  // Check if we already know this profile doesn't support custom temperature
  if (profilesWithoutCustomTemp.has(profileKey)) {
    const response: LLMResponse = await provider.sendMessage(
      { messages, model: selection.modelName, maxTokens: 1000 },
      apiKey
    )
    logCall(response)
    return { content: response.content, usage: response.usage }
  }

  // Try with lower temperature for more consistent outputs
  try {
    const response: LLMResponse = await provider.sendMessage(
      { messages, model: selection.modelName, temperature: 0.3, maxTokens: 1000 },
      apiKey
    )
    logCall(response, 0.3)
    return { content: response.content, usage: response.usage }
  } catch (error) {
    // If temperature is not supported, cache it and retry with default temperature
    const errorMessage = getErrorMessage(error, '')
    if (errorMessage.includes('temperature') || errorMessage.includes('does not support')) {
      profilesWithoutCustomTemp.add(profileKey)

      const response: LLMResponse = await provider.sendMessage(
        { messages, model: selection.modelName, maxTokens: 1000 },
        apiKey
      )
      logCall(response)
      return { content: response.content, usage: response.usage }
    }
    throw error
  }
}

/**
 * Checks if an uncensored fallback should be attempted for an empty response
 * Returns a CheapLLMSelection for the uncensored provider, or null if fallback should not be attempted
 */
function shouldAttemptUncensoredFallback(
  responseContent: string,
  currentSelection: CheapLLMSelection,
  uncensoredFallback?: UncensoredFallbackOptions
): CheapLLMSelection | null {
  // No fallback if response is not empty
  if (responseContent.trim() !== '') return null

  // No fallback options provided
  if (!uncensoredFallback) return null

  const { dangerSettings, availableProfiles } = uncensoredFallback

  // Only attempt in AUTO_ROUTE mode
  if (dangerSettings.mode !== 'AUTO_ROUTE') return null

  // Need an uncensored text profile configured
  if (!dangerSettings.uncensoredTextProfileId) return null

  // Check if current profile is already dangerous-compatible (no need to fallback)
  const currentProfile = availableProfiles.find(p => p.id === currentSelection.connectionProfileId)
  if (currentProfile?.isDangerousCompatible) return null

  // Find the uncensored profile
  const uncensoredProfile = availableProfiles.find(p => p.id === dangerSettings.uncensoredTextProfileId)
  if (!uncensoredProfile) return null

  // Build a CheapLLMSelection for the uncensored profile
  return {
    provider: uncensoredProfile.provider,
    modelName: uncensoredProfile.modelName,
    baseUrl: uncensoredProfile.baseUrl || undefined,
    connectionProfileId: uncensoredProfile.id,
    isLocal: false,
  }
}

/**
 * Executes a cheap LLM task with the given messages
 */
async function executeCheapLLMTask<T>(
  selection: CheapLLMSelection,
  messages: LLMMessage[],
  userId: string,
  parseResponse: (content: string) => T,
  taskType?: string,
  chatId?: string,
  messageId?: string,
  uncensoredFallback?: UncensoredFallbackOptions
): Promise<CheapLLMTaskResult<T>> {
  try {
    let response = await sendToProvider(selection, messages, userId, taskType, chatId, messageId)

    // Check if we should retry with an uncensored provider
    const uncensoredSelection = shouldAttemptUncensoredFallback(response.content, selection, uncensoredFallback)
    if (uncensoredSelection) {
      logger.warn('[CheapLLM] Empty response detected, retrying with uncensored provider', {
        taskType,
        chatId,
        originalProvider: selection.provider,
        originalModel: selection.modelName,
        uncensoredProvider: uncensoredSelection.provider,
        uncensoredModel: uncensoredSelection.modelName,
      })

      const retryResponse = await sendToProvider(uncensoredSelection, messages, userId, taskType, chatId, messageId)

      if (retryResponse.content.trim() === '') {
        throw new Error(`Empty response from both safe provider (${selection.provider}/${selection.modelName}) and uncensored provider (${uncensoredSelection.provider}/${uncensoredSelection.modelName})`)
      }

      logger.info('[CheapLLM] Uncensored fallback succeeded', {
        taskType,
        chatId,
        uncensoredProvider: uncensoredSelection.provider,
        uncensoredModel: uncensoredSelection.modelName,
        responseLength: retryResponse.content.length,
      })

      response = retryResponse
    }

    const result = parseResponse(response.content)

    return {
      success: true,
      result,
      usage: response.usage,
    }
  } catch (error) {

    return {
      success: false,
      error: getErrorMessage(error),
    }
  }
}

/**
 * Memory extraction prompt template for user memories
 */
const USER_MEMORY_EXTRACTION_PROMPT = `You are extracting memories about the USER (the human participant) from a conversation.

TASK: Identify if there is something significant about the USER that should be remembered.

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

If the USER reveals something significant about themselves, respond with JSON only:
{
  "significant": true,
  "content": "What we learned about the user FROM THEIR OWN WORDS",
  "summary": "Brief 1-sentence summary",
  "keywords": ["keyword1", "keyword2"],
  "importance": 0.0-1.0
}

If nothing significant about the USER (from their own words), respond:
{ "significant": false }

JSON only - no other text.`

/**
 * Memory extraction prompt template for character memories
 */
const CHARACTER_MEMORY_EXTRACTION_PROMPT = `You are extracting memories about a specific CHARACTER from a conversation.

TASK: Identify if the specified CHARACTER reveals something significant about themselves.

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

If the CHARACTER reveals something significant about themselves, respond with JSON only:
{
  "significant": true,
  "content": "What we learned about the character FROM THEIR OWN WORDS/ACTIONS",
  "summary": "Brief 1-sentence summary",
  "keywords": ["keyword1", "keyword2"],
  "importance": 0.0-1.0
}

If nothing significant about the CHARACTER (from their own words/actions), respond:
{ "significant": false }

JSON only - no other text.`

/**
 * Extracts a potential memory from a message exchange
 *
 * @param userMessage - The user's message
 * @param assistantMessage - The assistant's response
 * @param context - Additional context (participant list, etc.)
 * @param characterName - The name of the character responding
 * @param personaName - The user's persona name (optional)
 * @param selection - The cheap LLM provider selection
 * @param userId - The user ID for API key retrieval
 * @returns A memory candidate or null if nothing significant
 */
export async function extractMemoryFromMessage(
  userMessage: string,
  assistantMessage: string,
  context: string,
  characterName: string,
  personaName: string | undefined,
  selection: CheapLLMSelection,
  userId: string,
  uncensoredFallback?: UncensoredFallbackOptions
): Promise<CheapLLMTaskResult<MemoryCandidate>> {
  // Use clear "X says:" format to help the model distinguish speakers
  const userLabel = personaName ? `${personaName} (the user)` : 'The user'
  const characterLabel = `${characterName} (the character)`

  const messages: LLMMessage[] = [
    {
      role: 'system',
      content: USER_MEMORY_EXTRACTION_PROMPT,
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
    (content: string): MemoryCandidate => {
      try {
        // Clean the response - remove markdown code blocks if present
        let cleanContent = content.trim()
        if (cleanContent.startsWith('```json')) {
          cleanContent = cleanContent.replace(/^```json\s*/, '').replace(/\s*```$/, '')
        } else if (cleanContent.startsWith('```')) {
          cleanContent = cleanContent.replace(/^```\s*/, '').replace(/\s*```$/, '')
        }

        const parsed = JSON.parse(cleanContent)
        // Ensure content is always a string (some LLMs return objects)
        const memoryContent = typeof parsed.content === 'string'
          ? parsed.content
          : (parsed.content ? JSON.stringify(parsed.content) : undefined)
        const memorySummary = typeof parsed.summary === 'string'
          ? parsed.summary
          : (parsed.summary ? JSON.stringify(parsed.summary) : undefined)
        return {
          significant: parsed.significant === true,
          content: memoryContent,
          summary: memorySummary,
          keywords: parsed.keywords || [],
          importance: typeof parsed.importance === 'number' ? parsed.importance : 0.5,
        }
      } catch {
        // If JSON parsing fails, assume not significant
        return { significant: false }
      }
    },
    'memory-extraction-user',
    undefined,
    undefined,
    uncensoredFallback
  )
}

/**
 * Extracts a potential memory about the CHARACTER from a message exchange
 *
 * @param userMessage - The user's message
 * @param assistantMessage - The character's response
 * @param context - Additional context (participant list, etc.)
 * @param characterName - The character's name for context
 * @param personaName - The user's persona name (optional)
 * @param selection - The cheap LLM provider selection
 * @param userId - The user ID for API key retrieval
 * @returns A memory candidate or null if nothing significant
 */
export async function extractCharacterMemoryFromMessage(
  userMessage: string,
  assistantMessage: string,
  context: string,
  characterName: string,
  personaName: string | undefined,
  selection: CheapLLMSelection,
  userId: string,
  uncensoredFallback?: UncensoredFallbackOptions
): Promise<CheapLLMTaskResult<MemoryCandidate>> {
  // Use clear "X says:" format to help the model distinguish speakers
  const userLabel = personaName ? `${personaName} (the user)` : 'The user'
  const characterLabel = `${characterName} (the character)`

  const messages: LLMMessage[] = [
    {
      role: 'system',
      content: CHARACTER_MEMORY_EXTRACTION_PROMPT,
    },
    {
      role: 'user',
      content: `${context}

TARGET CHARACTER: ${characterName}

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
    (content: string): MemoryCandidate => {
      try {
        // Clean the response - remove markdown code blocks if present
        let cleanContent = content.trim()
        if (cleanContent.startsWith('```json')) {
          cleanContent = cleanContent.replace(/^```json\s*/, '').replace(/\s*```$/, '')
        } else if (cleanContent.startsWith('```')) {
          cleanContent = cleanContent.replace(/^```\s*/, '').replace(/\s*```$/, '')
        }

        const parsed = JSON.parse(cleanContent)
        // Ensure content is always a string (some LLMs return objects)
        const memoryContent = typeof parsed.content === 'string'
          ? parsed.content
          : (parsed.content ? JSON.stringify(parsed.content) : undefined)
        const memorySummary = typeof parsed.summary === 'string'
          ? parsed.summary
          : (parsed.summary ? JSON.stringify(parsed.summary) : undefined)
        return {
          significant: parsed.significant === true,
          content: memoryContent,
          summary: memorySummary,
          keywords: parsed.keywords || [],
          importance: typeof parsed.importance === 'number' ? parsed.importance : 0.5,
        }
      } catch {
        // If JSON parsing fails, assume not significant
        return { significant: false }
      }
    },
    'memory-extraction-character',
    undefined,
    undefined,
    uncensoredFallback
  )
}

/**
 * Memory extraction prompt template for inter-character memories
 */
const INTER_CHARACTER_MEMORY_EXTRACTION_PROMPT = `You are extracting memories that one CHARACTER has learned about ANOTHER CHARACTER from their conversation.
Analyze the conversation exchange below and identify if there is something significant that CHARACTER A learns about CHARACTER B that should be remembered for future conversations.

Criteria for significance:
- Personal information CHARACTER B shares or reveals (preferences, history, relationships, traits, background)
- Emotional moments or important decisions that reveal CHARACTER B's nature
- Facts about CHARACTER B that should persist across conversations
- Relationship dynamics established between the two characters
- Observations CHARACTER A would naturally make about CHARACTER B

IMPORTANT: Extract what CHARACTER A would remember about CHARACTER B based on this exchange.
The memory should capture something CHARACTER A learns about CHARACTER B from this interaction.

If significant, respond with JSON only (no markdown, no code blocks):
{
  "significant": true,
  "content": "Full memory content describing what Character A learns about Character B",
  "summary": "Brief 1-sentence summary",
  "keywords": ["keyword1", "keyword2"],
  "importance": 0.0-1.0
}

If not significant, respond with JSON only:
{ "significant": false }

Do not include any text outside the JSON object.`

/**
 * Extracts a potential memory that one character has about another character
 *
 * @param characterAName - The character who will remember (the observer)
 * @param characterAMessage - What character A said
 * @param characterBName - The character being remembered (the subject)
 * @param characterBMessage - What character B said
 * @param selection - The cheap LLM provider selection
 * @param userId - The user ID for API key retrieval
 * @returns A memory candidate or null if nothing significant
 */
export async function extractInterCharacterMemoryFromMessage(
  characterAName: string,
  characterAMessage: string,
  characterBName: string,
  characterBMessage: string,
  selection: CheapLLMSelection,
  userId: string,
  uncensoredFallback?: UncensoredFallbackOptions
): Promise<CheapLLMTaskResult<MemoryCandidate>> {
  const messages: LLMMessage[] = [
    {
      role: 'system',
      content: INTER_CHARACTER_MEMORY_EXTRACTION_PROMPT,
    },
    {
      role: 'user',
      content: `Character A (the observer): ${characterAName}
Character B (the subject): ${characterBName}

CONVERSATION:
${characterAName}: ${characterAMessage}

${characterBName}: ${characterBMessage}`,
    },
  ]

  return executeCheapLLMTask(
    selection,
    messages,
    userId,
    (content: string): MemoryCandidate => {
      try {
        // Clean the response - remove markdown code blocks if present
        let cleanContent = content.trim()
        if (cleanContent.startsWith('```json')) {
          cleanContent = cleanContent.replace(/^```json\s*/, '').replace(/\s*```$/, '')
        } else if (cleanContent.startsWith('```')) {
          cleanContent = cleanContent.replace(/^```\s*/, '').replace(/\s*```$/, '')
        }

        const parsed = JSON.parse(cleanContent)
        // Ensure content is always a string (some LLMs return objects)
        const memoryContent = typeof parsed.content === 'string'
          ? parsed.content
          : (parsed.content ? JSON.stringify(parsed.content) : undefined)
        const memorySummary = typeof parsed.summary === 'string'
          ? parsed.summary
          : (parsed.summary ? JSON.stringify(parsed.summary) : undefined)
        return {
          significant: parsed.significant === true,
          content: memoryContent,
          summary: memorySummary,
          keywords: parsed.keywords || [],
          importance: typeof parsed.importance === 'number' ? parsed.importance : 0.5,
        }
      } catch {
        // If JSON parsing fails, assume not significant
        return { significant: false }
      }
    },
    'memory-extraction-inter-character',
    undefined,
    undefined,
    uncensoredFallback
  )
}

/**
 * Chat summarization prompt template
 */
const CHAT_SUMMARY_PROMPT = `You are a summarizer. Create a concise summary of the following conversation.
Focus on key events, decisions, emotional moments, and important information shared.
Keep the summary under 200 words. Write in third person, past tense.
Respond with only the summary text, no additional formatting.`

/**
 * Summarizes a chat conversation
 *
 * @param messages - The chat messages to summarize
 * @param selection - The cheap LLM provider selection
 * @param userId - The user ID for API key retrieval
 * @returns A summary of the conversation
 */
export async function summarizeChat(
  messages: ChatMessage[],
  selection: CheapLLMSelection,
  userId: string
): Promise<CheapLLMTaskResult<string>> {
  // Format messages for the prompt
  const conversationText = messages
    .map(m => `${m.role.toUpperCase()}: ${m.content}`)
    .join('\n\n')

  const llmMessages: LLMMessage[] = [
    {
      role: 'system',
      content: CHAT_SUMMARY_PROMPT,
    },
    {
      role: 'user',
      content: conversationText,
    },
  ]

  return executeCheapLLMTask(
    selection,
    llmMessages,
    userId,
    (content: string): string => content.trim(),
    'summarize-chat'
  )
}

/**
 * Strips tool call artifacts from assistant message content so that title
 * generation focuses on the actual conversation, not tool machinery.
 *
 * Handles patterns like:
 * - `[Tool call made]` markers
 * - `[Tool Result: toolName ...]` blocks with embedded JSON
 * - Leading/trailing raw JSON fragments from tool responses
 *
 * @returns Cleaned content, or null if no meaningful conversational text remains
 */
export function stripToolArtifacts(content: string): string | null {
  // Quick exit: if no tool markers or leading JSON, return as-is
  if (
    !content.includes('[Tool') &&
    !content.includes('"toolName"') &&
    !/^\s*[{[\],}]/.test(content)
  ) {
    return content
  }

  const originalLength = content.length
  let cleaned = content

  // Remove [Tool call made] markers
  cleaned = cleaned.replace(/\[Tool call made\]/g, '')

  // Remove [Tool Result: ...] blocks (tool name + JSON content within brackets)
  cleaned = cleaned.replace(/\[Tool Result:[^\]]*\]/g, '')

  // Filter out lines that look like JSON rather than conversation
  const lines = cleaned.split('\n')
  const conversationalLines = lines.filter(line => {
    const t = line.trim()
    if (!t) return false
    // Skip lines that start with JSON structural characters
    if (/^[{}\[\],:]/.test(t)) return false
    // Skip lines that look like JSON key-value pairs
    if (/^"[^"]*"\s*:/.test(t)) return false
    return true
  })

  cleaned = conversationalLines.join('\n').trim()

  // If very little conversational text remains, skip this message entirely
  if (cleaned.length < 20) {
    return null
  }

  return cleaned
}

/**
 * Extracts only the visible conversational messages (what appears in chat bubbles)
 * from a message-like array. This is the standard filter for any cheap LLM task
 * that judges content (titles, summaries, backgrounds, compression, etc.).
 *
 * Filters:
 * - If `type` field present, skips non-'message' entries (system events, context-summaries)
 * - Skips any role that isn't USER or ASSISTANT (filters TOOL and SYSTEM messages)
 * - Applies `stripToolArtifacts()` to assistant messages; skips if null returned
 * - Case-insensitive role matching (handles both 'USER' and 'user')
 *
 * @param messages - Any message-like array (ChatEvents, MessageEvents, etc.)
 * @returns Clean ChatMessage[] with only user/assistant conversational text
 */
export function extractVisibleConversation(
  messages: Array<{ type?: string; role?: string; content?: string }>
): ChatMessage[] {
  const result: ChatMessage[] = []

  for (const m of messages) {
    // Skip non-message entries (system events, context-summary events, etc.)
    if (m.type !== undefined && m.type !== 'message') continue

    // Skip entries without content (e.g., context-summary events)
    if (!m.content) continue

    // Only include USER and ASSISTANT roles
    const role = (m.role || '').toUpperCase()
    if (role !== 'USER' && role !== 'ASSISTANT') continue

    const lowerRole = role.toLowerCase() as 'user' | 'assistant'

    if (lowerRole === 'assistant') {
      const cleaned = stripToolArtifacts(m.content)
      if (!cleaned) continue
      result.push({ role: lowerRole, content: cleaned })
    } else {
      result.push({ role: lowerRole, content: m.content })
    }
  }

  return result
}

/**
 * Chat title prompt template
 */
const CHAT_TITLE_PROMPT = `Generate a literary title for this conversation, like titling a short story.
The title should:
- Be 3-8 words maximum
- Reflect where the conversation ultimately went, not just how it started — weight the later messages more heavily
- Focus on the unique narrative flair, quirky elements, or evocative mood
- Be poetic and distinctive — unless the conversation is really about technical details, in which case mention the kind of technical work being discussed
- Avoid moralistic, ethical, or sterile phrasing — no mentions of consent, boundaries, or lessons
- Unless the conversation is really about one specific character, avoid titling it by character name

The conversation is shown with early messages truncated and recent messages in full. Title based on the overall arc, especially the recent discussion.

Respond with only the title, no quotes or additional text.`

/**
 * Chat title from summary prompt template
 */
const CHAT_TITLE_FROM_SUMMARY_PROMPT = `Generate a literary title for this conversation based on the summary provided, like titling a short story.
The title should:
- Be 3-8 words maximum and under 60 characters
- Focus on the unique narrative flair, quirky elements, or evocative mood
- Be poetic and distinctive — unless the conversation is really about technical details, in which case mention the kind of technical work being discussed
- Avoid moralistic, ethical, or sterile phrasing — no mentions of consent, boundaries, or lessons
- Unless the conversation is really about one specific character, avoid titling it by character name

Respond with only the title, no quotes or additional text.`

/**
 * Generates or updates a chat title
 *
 * @param messages - Recent chat messages
 * @param existingTitle - Current title (if any)
 * @param selection - The cheap LLM provider selection
 * @param userId - The user ID for API key retrieval
 * @returns A new title for the chat
 */
export async function titleChat(
  messages: ChatMessage[],
  existingTitle: string | undefined,
  selection: CheapLLMSelection,
  userId: string
): Promise<CheapLLMTaskResult<string>> {
  // Use up to 100 messages, weighted toward the end of the conversation.
  // Older messages are truncated aggressively; recent messages get full text.
  const capped = messages.slice(-100)
  const recentThreshold = Math.max(0, capped.length - 10)
  const conversationText = capped
    .map((m, i) => {
      const label = m.role.toUpperCase()
      // Last 10 messages: full text (up to 500 chars)
      // Older messages: truncated to 150 chars
      const limit = i >= recentThreshold ? 500 : 150
      const text = m.content.length > limit
        ? m.content.substring(0, limit) + '...'
        : m.content
      return `${label}: ${text}`
    })
    .join('\n\n')

  let prompt = CHAT_TITLE_PROMPT
  if (existingTitle) {
    prompt += `\n\nCurrent title: "${existingTitle}"\nUpdate only if the conversation has evolved significantly.`
  }

  const llmMessages: LLMMessage[] = [
    {
      role: 'system',
      content: prompt,
    },
    {
      role: 'user',
      content: conversationText,
    },
  ]

  return executeCheapLLMTask(
    selection,
    llmMessages,
    userId,
    (content: string): string => {
      // Clean up the title
      let title = content.trim()
      // Remove quotes if present
      title = title.replace(/^["']|["']$/g, '')
      // Truncate if too long
      if (title.length > 50) {
        title = title.substring(0, 47) + '...'
      }
      return title
    },
    'title-chat'
  )
}

/**
 * Generates a chat title from a summary
 *
 * @param summary - The conversation summary
 * @param selection - The cheap LLM provider selection
 * @param userId - The user ID for API key retrieval
 * @returns A new title for the chat
 */
export async function generateTitleFromSummary(
  summary: string,
  selection: CheapLLMSelection,
  userId: string
): Promise<CheapLLMTaskResult<string>> {
  const llmMessages: LLMMessage[] = [
    {
      role: 'system',
      content: CHAT_TITLE_FROM_SUMMARY_PROMPT,
    },
    {
      role: 'user',
      content: `Summary:\n${summary}`,
    },
  ]

  return executeCheapLLMTask(
    selection,
    llmMessages,
    userId,
    (content: string): string => {
      // Clean up the title
      let title = content.trim()
      // Remove quotes if present
      title = title.replace(/^["']|["']$/g, '')
      // Truncate if too long (60 characters max)
      if (title.length > 60) {
        title = title.substring(0, 57) + '...'
      }
      return title
    },
    'title-from-summary'
  )
}

/**
 * Prompt for considering whether a chat title should be updated
 */
const CHAT_TITLE_CONSIDERATION_PROMPT = `You are a chat title evaluator. You will be given:
1. The current chat title
2. A previous summary or title (if available)
3. Recent messages from the chat

Determine if the chat needs a new title. Consider:
- If the current title is generic (like "Chat with [Name]" or "New Chat"), it SHOULD be replaced with a literary title based on what the conversation is actually about
- If the title is already descriptive, only suggest a change if the main topic has shifted significantly
- A good title is like titling a short story: it captures the unique narrative flair, quirky elements, or evocative mood in a few words
- Titles should be poetic and distinctive, not moralistic or sterile — avoid mentions of consent, boundaries, or lessons. Exception: if the conversation is really about technical details, the title should mention the kind of technical work being discussed
- Unless the conversation is really about one specific character, avoid titling it by character name

Respond with a JSON object:
{
  "needsNewTitle": true/false,
  "reason": "brief explanation",
  "suggestedTitle": "new title if needsNewTitle is true, otherwise null"
}

Keep suggested titles 3-8 words, under 60 characters, poetic and distinctive (or technically descriptive if the conversation is about technical work).`

/**
 * Evaluates whether a chat needs a new title based on recent messages
 * This is a lighter-weight check than full summarization
 *
 * @param currentTitle - The current chat title
 * @param recentMessages - Recent messages (just the new ones since last check)
 * @param existingSummaryOrTitle - Previous summary or title for context
 * @param selection - The cheap LLM provider selection
 * @param userId - The user ID for API key retrieval
 * @returns Whether title needs updating and suggested new title
 */
export async function considerTitleUpdate(
  currentTitle: string,
  recentMessages: ChatMessage[],
  existingSummaryOrTitle: string | null,
  selection: CheapLLMSelection,
  userId: string
): Promise<CheapLLMTaskResult<{ needsNewTitle: boolean; reason: string; suggestedTitle: string | null }>> {
  // Format recent messages
  const conversationText = recentMessages
    .map(m => `${m.role.toUpperCase()}: ${m.content.substring(0, 500)}`) // Truncate long messages
    .join('\n\n')

  const contextInfo = existingSummaryOrTitle 
    ? `Previous context: ${existingSummaryOrTitle}`
    : 'No previous context'

  const llmMessages: LLMMessage[] = [
    {
      role: 'system',
      content: CHAT_TITLE_CONSIDERATION_PROMPT,
    },
    {
      role: 'user',
      content: `Current Title: "${currentTitle}"\n\n${contextInfo}\n\nRecent Messages:\n${conversationText}`,
    },
  ]

  return executeCheapLLMTask(
    selection,
    llmMessages,
    userId,
    (content: string): { needsNewTitle: boolean; reason: string; suggestedTitle: string | null } => {
      try {
        // Clean the response - remove markdown code blocks if present
        let cleanContent = content.trim()
        if (cleanContent.startsWith('```json')) {
          cleanContent = cleanContent.replace(/^```json\s*/, '').replace(/\s*```$/, '')
        } else if (cleanContent.startsWith('```')) {
          cleanContent = cleanContent.replace(/^```\s*/, '').replace(/\s*```$/, '')
        }

        const parsed = JSON.parse(cleanContent)
        
        let suggestedTitle = parsed.suggestedTitle
        if (suggestedTitle && typeof suggestedTitle === 'string') {
          // Clean up the title
          suggestedTitle = suggestedTitle.trim().replace(/^["']/, '').replace(/["']$/, '')
          // Truncate if too long
          if (suggestedTitle.length > 60) {
            suggestedTitle = suggestedTitle.substring(0, 57) + '...'
          }
        }

        return {
          needsNewTitle: parsed.needsNewTitle === true,
          reason: parsed.reason || 'No reason provided',
          suggestedTitle: suggestedTitle || null,
        }
      } catch {
        // If JSON parsing fails, assume no update needed
        return {
          needsNewTitle: false,
          reason: 'Failed to parse response',
          suggestedTitle: null,
        }
      }
    },
    'consider-title-update'
  )
}

/**
 * Context summary update prompt template
 */
const CONTEXT_SUMMARY_PROMPT = `You are updating a running summary of a conversation.
Integrate the new messages into the existing summary, keeping it concise and under 300 words.
Focus on maintaining continuity and capturing any new important information.
Respond with only the updated summary text.`

/**
 * Updates a running context summary with new messages
 *
 * @param currentSummary - The existing context summary
 * @param newMessages - New messages to integrate
 * @param selection - The cheap LLM provider selection
 * @param userId - The user ID for API key retrieval
 * @returns Updated context summary
 */
export async function updateContextSummary(
  currentSummary: string,
  newMessages: ChatMessage[],
  selection: CheapLLMSelection,
  userId: string
): Promise<CheapLLMTaskResult<string>> {
  const newMessagesText = newMessages
    .map(m => `${m.role.toUpperCase()}: ${m.content}`)
    .join('\n\n')

  const llmMessages: LLMMessage[] = [
    {
      role: 'system',
      content: CONTEXT_SUMMARY_PROMPT,
    },
    {
      role: 'user',
      content: `Current summary:
${currentSummary}

New messages to integrate:
${newMessagesText}`,
    },
  ]

  return executeCheapLLMTask(
    selection,
    llmMessages,
    userId,
    (content: string): string => content.trim(),
    'update-context-summary'
  )
}

/**
 * Attachment description prompt template
 */
const ATTACHMENT_DESCRIPTION_PROMPT = `Describe this file attachment briefly for memory/search purposes.
Focus on what the content shows or contains.
Keep the description under 100 words.
Respond with only the description text.`

/**
 * Generates a description for a file attachment
 * Note: Only works with providers that support vision/multimodal
 *
 * @param attachment - The attachment to describe
 * @param selection - The cheap LLM provider selection
 * @param userId - The user ID for API key retrieval
 * @returns A description of the attachment
 */
export async function describeAttachment(
  attachment: Attachment,
  selection: CheapLLMSelection,
  userId: string
): Promise<CheapLLMTaskResult<string>> {
  // Check if we have image data
  if (!attachment.data) {
    return {
      success: false,
      error: 'No attachment data provided',
    }
  }

  // Check if the provider supports vision
  const isImage = attachment.mimeType.startsWith('image/')
  if (isImage) {
    // For images, we need a vision-capable model
    // This is a simplified check - in production you'd verify model capabilities
    const llmMessages: LLMMessage[] = [
      {
        role: 'system',
        content: ATTACHMENT_DESCRIPTION_PROMPT,
      },
      {
        role: 'user',
        content: `Please describe this image: ${attachment.filename}`,
        attachments: [
          {
            id: attachment.id,
            filepath: '',
            filename: attachment.filename,
            mimeType: attachment.mimeType,
            size: attachment.data.length,
            data: attachment.data,
          },
        ],
      },
    ]

    return executeCheapLLMTask(
      selection,
      llmMessages,
      userId,
      (content: string): string => content.trim(),
      'describe-attachment'
    )
  }

  // For non-image files, return a basic description
  return {
    success: true,
    result: `File: ${attachment.filename} (${attachment.mimeType})`,
    usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
  }
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
  userId: string
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
    'batch-memory-extraction'
  )
}

/**
 * Image prompt crafting prompt template
 */
const IMAGE_PROMPT_CRAFTING_PROMPT = `You are an expert image prompt writer. Your job is to craft coherent, well-structured image generation prompts by integrating physical descriptions of people into a scene description.

You will receive:
- An original prompt describing a scene with {{placeholders}} for people
- Physical descriptions for each person (in multiple detail levels: short, medium, long, complete)
- Optional usage context for each person indicating when that appearance is most appropriate
- A character limit for the final prompt
- Optionally, a style trigger phrase that MUST be incorporated into the prompt

Your task is to write a SINGLE COHERENT PARAGRAPH that:
1. Describes the scene and what is happening
2. Introduces each person naturally with their physical details woven into the narrative
3. Maintains proper sentence structure and flow
4. If a style trigger phrase is provided, incorporates it naturally (typically at the beginning of the prompt)

CRITICAL WRITING GUIDELINES:
- Write in a cinematic, descriptive style suitable for image generation
- Introduce people with phrases like "A young woman with...", "Beside her, a middle-aged man with..."
- NEVER just concatenate descriptions - write flowing prose that a human would write
- Use transitional phrases to connect people: "sitting on the lap of", "next to", "holding hands with", etc.
- Keep the scene context (location, mood, lighting) as a frame around the people descriptions
- Each person must be clearly distinct and identifiable in the description

STYLE TRIGGER PHRASE:
- If provided, the style trigger phrase is REQUIRED for the image to render correctly with the selected style
- Place it naturally, typically at the beginning (e.g., "DB4RZ Daubrez style painting of a young woman...")
- Do NOT omit or modify the trigger phrase - use it exactly as provided

STRUCTURE EXAMPLE:
BAD (concatenated): "Woman with red hair, hazel eyes, fair skin. sitting on Man with gray hair, glasses, plaid shirt.'s lap on a bench"
GOOD (coherent): "On a sunlit park bench, a young woman with flowing red-orange hair and warm hazel eyes sits comfortably on the lap of a middle-aged man wearing rectangular glasses and a cozy sweater vest. Dappled light filters through the leaves above them."
GOOD (with trigger): "DB4RZ Daubrez style painting of a sunlit park bench scene, where a young woman with flowing red-orange hair..."

For the descriptions:
- Use the most detailed tier that fits within the limit
- You may condense or paraphrase descriptions to fit naturally
- Prioritize the most visually distinctive features (hair color, eye color, notable clothing, distinguishing features)
- Don't include every detail if it makes the text awkward - focus on what matters visually
- If a usage context is provided, use it to inform which appearance details are most relevant to the scene

The final prompt MUST be under the character limit.

Respond with ONLY the final image prompt - no explanations, no markdown, no quotes around it.`

/**
 * Expansion context for image prompt crafting
 */
export interface ImagePromptExpansionContext {
  /** Original prompt with placeholders */
  originalPrompt: string
  /** Placeholder data with all available description tiers */
  placeholders: Array<{
    placeholder: string
    name: string
    usageContext?: string
    tiers: {
      short?: string
      medium?: string
      long?: string
      complete?: string
    }
    clothing?: Array<{
      name: string
      usageContext?: string | null
      description?: string | null
    }>
  }>
  /** Target maximum length */
  targetLength: number
  /** Target provider (for context) */
  provider: string
  /**
   * Style trigger phrase to incorporate into the prompt.
   * When a style/LoRA is selected that has a trigger phrase,
   * the LLM should naturally incorporate this phrase into the prompt.
   */
  styleTriggerPhrase?: string
  /**
   * Name of the selected style (for context in the prompt crafting)
   */
  styleName?: string
}

/**
 * Crafts an image generation prompt by expanding placeholders with descriptions
 *
 * @param expansionContext - Context with original prompt and all description tiers
 * @param selection - The cheap LLM provider selection
 * @param userId - The user ID for API key retrieval
 * @returns The crafted image prompt
 */
export async function craftImagePrompt(
  expansionContext: ImagePromptExpansionContext,
  selection: CheapLLMSelection,
  userId: string
): Promise<CheapLLMTaskResult<string>> {
  // Format placeholder data for the LLM
  const placeholderDetails = expansionContext.placeholders
    .map(p => {
      const parts: string[] = [`${p.placeholder} (${p.name}):`];

      if (p.usageContext) {
        parts.push(`  Usage context: ${p.usageContext}`);
      }

      if (p.tiers.complete) {
        parts.push(`  Complete: "${p.tiers.complete}"`);
      }
      if (p.tiers.long) {
        parts.push(`  Long: "${p.tiers.long}"`);
      }
      if (p.tiers.medium) {
        parts.push(`  Medium: "${p.tiers.medium}"`);
      }
      if (p.tiers.short) {
        parts.push(`  Short: "${p.tiers.short}"`);
      }

      // Include clothing/outfit details if available
      if (p.clothing && p.clothing.length > 0) {
        parts.push(`  Clothing/Outfits:`);
        for (const outfit of p.clothing) {
          const contextHint = outfit.usageContext ? ` (when: ${outfit.usageContext})` : '';
          const desc = outfit.description ? `: ${outfit.description}` : '';
          parts.push(`    - "${outfit.name}"${contextHint}${desc}`);
        }
      }

      if (parts.length === 1) {
        // No descriptions available
        parts.push(`  (No descriptions available - use name only)`);
      }

      return parts.join('\n');
    })
    .join('\n\n');

  // Build the style trigger section if provided
  let styleTriggerSection = ''
  if (expansionContext.styleTriggerPhrase) {
    styleTriggerSection = `
Style trigger phrase (MUST include exactly as shown): "${expansionContext.styleTriggerPhrase}"${expansionContext.styleName ? ` (for "${expansionContext.styleName}" style)` : ''}
`
  }

  const llmMessages: LLMMessage[] = [
    {
      role: 'system',
      content: IMAGE_PROMPT_CRAFTING_PROMPT,
    },
    {
      role: 'user',
      content: `Original prompt: ${expansionContext.originalPrompt}

Available descriptions:
${placeholderDetails}
${styleTriggerSection}
Target length: ${expansionContext.targetLength} characters (for ${expansionContext.provider})

Create the final image prompt (maximize detail while staying under the limit):`,
    },
  ]

  return executeCheapLLMTask(
    selection,
    llmMessages,
    userId,
    (content: string): string => {
      let prompt = content.trim()

      // Remove quotes if the LLM wrapped the response
      prompt = prompt.replace(/^["']|["']$/g, '')

      // Truncate if it exceeds the target length
      if (prompt.length > expansionContext.targetLength) {
        prompt = prompt.substring(0, expansionContext.targetLength - 3) + '...'
      }

      return prompt
    },
    'craft-image-prompt'
  )
}

// ============================================================================
// SCENE CONTEXT DERIVATION
// ============================================================================

/**
 * Scene context derivation system prompt
 * Analyzes chat history to derive a rich scene description for image generation
 */
const SCENE_CONTEXT_DERIVATION_PROMPT = `You are a creative writer skilled at interpreting conversations and imagining vivid scenes.

Your task is to analyze a conversation and derive a scene context that captures what the characters might be experiencing or witnessing together.

GUIDELINES:
- Consider what the characters are currently discussing or doing
- Interpret the emotional tone and implied setting
- Be imaginative: if they're discussing a book, story, or historical event, imagine them as observers or participants in that world
- If the conversation is casual or abstract, capture the mood and implied environment
- Focus on visual, atmospheric details that would translate well to an image
- Keep your description concise (1-3 sentences)

EXAMPLES:

Conversation about the book of Exodus:
"Two figures huddle together examining ancient scrolls by lamplight, the distant silhouette of pyramids visible through a tent opening, desert stars glittering overhead."

Casual friendly conversation:
"Friends share comfortable conversation in a cozy space, warm lighting casting gentle shadows as they lean toward each other with easy familiarity."

Discussion about space exploration:
"Two companions gaze up at a star-filled sky, the Milky Way stretching above them, their faces illuminated by the soft glow of a campfire."

Respond with ONLY the scene description - no explanations, no quotes, no formatting.`

/**
 * Input for scene context derivation
 */
export interface DeriveSceneContextInput {
  /** Chat title for basic context */
  chatTitle: string
  /** Existing context summary if available */
  contextSummary?: string | null
  /** Recent messages from the chat */
  recentMessages: ChatMessage[]
  /** Names of characters in the chat */
  characterNames: string[]
}

/**
 * Derives a rich scene context from chat history for story background generation
 *
 * This function analyzes the conversation to understand what characters are doing
 * or discussing, and creates an imaginative scene description that captures the
 * mood and setting implied by the conversation.
 *
 * @param input - Context including chat title, messages, and character names
 * @param selection - The cheap LLM provider selection
 * @param userId - The user ID for API key retrieval
 * @returns A scene description suitable for image prompt generation
 */
export async function deriveSceneContext(
  input: DeriveSceneContextInput,
  selection: CheapLLMSelection,
  userId: string
): Promise<CheapLLMTaskResult<string>> {
  // Format recent messages for the prompt
  const messageText = input.recentMessages
    .map(m => {
      const speaker = m.role === 'user' ? 'User' : m.role === 'assistant' ? 'Character' : 'System'
      // Truncate long messages to keep context manageable
      const content = m.content.length > 500 ? m.content.substring(0, 500) + '...' : m.content
      return `${speaker}: ${content}`
    })
    .join('\n\n')

  // Build the context section
  let contextInfo = `Chat Title: "${input.chatTitle}"`
  if (input.contextSummary) {
    contextInfo += `\n\nExisting Summary:\n${input.contextSummary}`
  }
  if (input.characterNames.length > 0) {
    contextInfo += `\n\nCharacters present: ${input.characterNames.join(', ')}`
  }

  const llmMessages: LLMMessage[] = [
    {
      role: 'system',
      content: SCENE_CONTEXT_DERIVATION_PROMPT,
    },
    {
      role: 'user',
      content: `${contextInfo}

Recent Conversation:
${messageText}

Based on this conversation, describe the scene these characters might be in:`,
    },
  ]

  return executeCheapLLMTask(
    selection,
    llmMessages,
    userId,
    (content: string): string => {
      let result = content.trim()

      // Remove quotes if the LLM wrapped the response
      result = result.replace(/^["']|["']$/g, '')

      // Remove any markdown formatting
      result = result.replace(/^```[a-z]*\s*/g, '').replace(/\s*```$/g, '')

      return result
    },
    'derive-scene-context'
  )
}

// ============================================================================
// MEMORY KEYWORD EXTRACTION
// ============================================================================

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

// ============================================================================
// STORY BACKGROUND PROMPT CRAFTING
// ============================================================================

/**
 * Story background prompt crafting system prompt
 * Creates atmospheric landscape scene prompts suitable for chat backgrounds
 */
const STORY_BACKGROUND_PROMPT = `You are a skilled visual artist and prompt engineer specializing in atmospheric landscape scenes for story backgrounds.

You will receive:
- A scene context (typically a chat title or summary describing the story)
- A list of characters with their brief physical descriptions
- The target image generation provider

Your task is to create a SINGLE image generation prompt that:
1. Depicts a scene suitable as a background
2. Captures the mood and setting implied by the scene context
3. Places characters as figures in the scene
4. Uses cinematic composition with the characters positioned naturally in the scene, usually conversing

CRITICAL GUIDELINES:
- This is for a BACKGROUND image, not a portrait - the scene/environment is primary
- Characters should be toward the left and right of the frame, not centered
- Characters should be described briefly, focusing on visual traits (hair color, clothing style, notable features)
- Focus on atmospheric qualities: lighting, weather, time of day, mood
- Include environmental details: location type, architectural elements, nature
- Avoid cluttered compositions - keep it visually calm for use as a background
- Write in a flowing, descriptive style suitable for image generation

GOOD EXAMPLE OUTPUT:
"Close-up of two people talking to the left and right of the frame. The woman has green eyes and is smiling."

BAD EXAMPLE OUTPUT:
"A misty forest clearing at twilight, soft golden light filtering through ancient oak trees. Two small figures stand near a weathered stone bridge - a woman with flowing dark hair in a simple dress and a man in traveler's clothes. Fog rolls gently across the mossy ground, fireflies beginning to glow. Atmospheric, peaceful, fantasy ambience."

Respond with ONLY the final prompt - no explanations, no markdown formatting, no quotes.`

/**
 * Context for story background prompt crafting
 */
export interface StoryBackgroundPromptContext {
  /** Scene context from chat title or summary */
  sceneContext: string
  /** Characters to include in the scene */
  characters: Array<{
    name: string
    description: string
  }>
  /** Target image provider for length constraints */
  provider: string
}

/**
 * Crafts a story background image prompt using the cheap LLM
 *
 * @param context - Context with scene and character information
 * @param selection - The cheap LLM provider selection
 * @param userId - The user ID for API key retrieval
 * @returns The crafted background prompt
 */
export async function craftStoryBackgroundPrompt(
  context: StoryBackgroundPromptContext,
  selection: CheapLLMSelection,
  userId: string
): Promise<CheapLLMTaskResult<string>> {
  // Build character descriptions section
  const characterSection = context.characters.length > 0
    ? `\nCharacters to include as figures in the scene:\n${context.characters.map(c => `- ${c.name}: ${c.description}`).join('\n')}`
    : '\nNo specific characters to include - create an atmospheric scene matching the context.'

  // Provider-specific length guidance
  let lengthGuidance = 'Keep the prompt under 700 characters.'
  if (context.provider === 'OPENAI') {
    lengthGuidance = 'Keep the prompt under 1000 characters for optimal DALL-E 3 results.'
  } else if (context.provider === 'GROK') {
    lengthGuidance = 'Keep the prompt under 600 characters for Grok image generation.'
  }

  const llmMessages: LLMMessage[] = [
    {
      role: 'system',
      content: STORY_BACKGROUND_PROMPT,
    },
    {
      role: 'user',
      content: `Scene context: ${context.sceneContext}
${characterSection}

Provider: ${context.provider}
${lengthGuidance}

Create the atmospheric background prompt:`,
    },
  ]

  return executeCheapLLMTask(
    selection,
    llmMessages,
    userId,
    (content: string): string => {
      let prompt = content.trim()

      // Remove quotes if the LLM wrapped the response
      prompt = prompt.replace(/^["']|["']$/g, '')

      // Remove any markdown formatting
      prompt = prompt.replace(/^```[a-z]*\s*/g, '').replace(/\s*```$/g, '')

      return prompt
    },
    'craft-story-background-prompt'
  )
}

// ============================================================================
// CONTEXT COMPRESSION
// ============================================================================

/**
 * Result of compressing conversation context or system prompt
 */
export interface CompressionResult {
  /** The compressed text */
  compressedText: string
  /** Approximate token count of original */
  originalTokens: number
  /** Approximate token count of compressed output */
  compressedTokens: number
}

/**
 * Context compression prompt template for conversation history
 * Uses dynamic {{userName}} and {{characterName}} placeholders
 */
const MESSAGE_COMPRESSION_PROMPT = `You are a context compression assistant. Your job is to read a conversation between {{userName}} and {{characterName}}, and compress the older messages into a concise summary that preserves critical information while drastically reducing token count.

**What to PRESERVE:**
- Decisions made and conclusions reached
- Active projects, tasks, and goals
- Technical details that affect ongoing work (file paths, configurations, error messages, code solutions)
- Emotional or personal context that affects how {{characterName}} should engage
- Unresolved questions or threads
- Key facts about preferences, workflow, or situation

**What to DROP:**
- Exact wording of back-and-forth exchanges
- Redundant tool calls and their full results (keep only the outcome)
- Superseded information (if a bug was fixed, you don't need the original broken behavior)
- Conversational pleasantries and filler
- Verbose code snippets (summarize what was changed/fixed)
- Tangential side topics that have concluded

**Output Format:**
Provide a structured summary in plain text using these sections:

### Current Context
[One paragraph: What is being worked on? What is the immediate goal or task?]

### Recent Decisions & Outcomes
[Bullet list: What was decided, fixed, or accomplished in the older messages?]

### Active Threads
[Bullet list: What topics, questions, or tasks are still in progress or unresolved?]

### User State & Preferences
[One paragraph: Any important context about the user's situation, emotional state, preferences, or constraints.]

### Technical Details
[Bullet list or short paragraphs: File paths, commands, configurations, error messages, or code changes that may be referenced again.]

**Target length:** {{targetTokens}} tokens.`

/**
 * System prompt compression prompt template
 */
const SYSTEM_PROMPT_COMPRESSION_PROMPT = `You are a system prompt compression assistant. Compress the following character system prompt to approximately {{targetTokens}} tokens while preserving:

1. Core identity and personality traits
2. Essential behavioral guidelines
3. Key relationship dynamics
4. Important constraints or rules

You may drop:
- Verbose examples
- Detailed formatting rules
- Redundant explanations
- Lengthy background details

Output only the compressed system prompt text, no additional commentary.`

/**
 * Compresses older conversation history into a structured summary
 *
 * @param messages - Messages to compress (typically messages 1 through N-windowSize)
 * @param characterName - The character's name for context
 * @param userName - The user's name/persona for context
 * @param targetTokens - Target token count for the compressed output
 * @param selection - The cheap LLM provider selection
 * @param userId - The user ID for API key retrieval
 * @returns The compressed conversation history
 */
export async function compressConversationHistory(
  messages: ChatMessage[],
  characterName: string,
  userName: string,
  targetTokens: number,
  selection: CheapLLMSelection,
  userId: string,
  uncensoredFallback?: UncensoredFallbackOptions
): Promise<CheapLLMTaskResult<CompressionResult>> {
  // Format messages for compression
  const conversationText = messages
    .map(m => {
      const speaker = m.role === 'user' ? userName : m.role === 'assistant' ? characterName : 'System'
      return `${speaker}: ${m.content}`
    })
    .join('\n\n')

  // Estimate original token count (rough approximation: 1 token ≈ 4 characters)
  const originalTokens = Math.ceil(conversationText.length / 4)

  // Build the prompt with dynamic values
  const systemPrompt = MESSAGE_COMPRESSION_PROMPT
    .replace(/\{\{userName\}\}/g, userName)
    .replace(/\{\{characterName\}\}/g, characterName)
    .replace(/\{\{targetTokens\}\}/g, String(targetTokens))

  const llmMessages: LLMMessage[] = [
    {
      role: 'system',
      content: systemPrompt,
    },
    {
      role: 'user',
      content: `Compress the following conversation history:\n\n${conversationText}`,
    },
  ]

  return executeCheapLLMTask(
    selection,
    llmMessages,
    userId,
    (content: string): CompressionResult => {
      const compressedText = content.trim()
      const compressedTokens = Math.ceil(compressedText.length / 4)

      return {
        compressedText,
        originalTokens,
        compressedTokens,
      }
    },
    'compress-conversation-history',
    undefined,
    undefined,
    uncensoredFallback
  )
}

/**
 * Compresses a system prompt to a target token count
 *
 * @param systemPrompt - The full system prompt to compress
 * @param targetTokens - Target token count for the compressed output
 * @param selection - The cheap LLM provider selection
 * @param userId - The user ID for API key retrieval
 * @returns The compressed system prompt
 */
export async function compressSystemPrompt(
  systemPrompt: string,
  targetTokens: number,
  selection: CheapLLMSelection,
  userId: string,
  uncensoredFallback?: UncensoredFallbackOptions
): Promise<CheapLLMTaskResult<CompressionResult>> {
  // Estimate original token count
  const originalTokens = Math.ceil(systemPrompt.length / 4)

  // Build the prompt with target tokens
  const prompt = SYSTEM_PROMPT_COMPRESSION_PROMPT
    .replace(/\{\{targetTokens\}\}/g, String(targetTokens))

  const llmMessages: LLMMessage[] = [
    {
      role: 'system',
      content: prompt,
    },
    {
      role: 'user',
      content: `Compress this system prompt:\n\n${systemPrompt}`,
    },
  ]

  return executeCheapLLMTask(
    selection,
    llmMessages,
    userId,
    (content: string): CompressionResult => {
      const compressedText = content.trim()
      const compressedTokens = Math.ceil(compressedText.length / 4)

      return {
        compressedText,
        originalTokens,
        compressedTokens,
      }
    },
    'compress-system-prompt',
    undefined,
    undefined,
    uncensoredFallback
  )
}

// ============================================================================
// CHARACTER APPEARANCE RESOLUTION
// ============================================================================

/**
 * Result of resolving a single character's appearance from context
 */
export interface AppearanceResolutionItem {
  characterId: string
  /** ID of the selected physical description, or null to use the first/default */
  selectedDescriptionId: string | null
  /** What the character is currently wearing */
  clothingDescription: string
  /** How clothing was determined */
  clothingSource: 'narrative' | 'stored' | 'default'
}

/**
 * Input describing a character's available appearances
 */
export interface CharacterAppearanceInput {
  characterId: string
  characterName: string
  physicalDescriptions: Array<{
    id: string
    name: string
    usageContext?: string | null
    shortPrompt?: string | null
    mediumPrompt?: string | null
  }>
  clothingRecords: Array<{
    id: string
    name: string
    usageContext?: string | null
    description?: string | null
  }>
}

/**
 * Appearance resolution system prompt
 * Analyzes chat context to determine what each character currently looks like
 */
const APPEARANCE_RESOLUTION_PROMPT = `You are analyzing a conversation to determine what each character currently looks like and is wearing.

You will receive:
- Recent conversation messages
- An image prompt that is about to be used for image generation
- For each character: their available physical descriptions (with usage contexts) and stored clothing/outfit records

Your task is to determine for each character:
1. Which physical description best matches the current scene context (by usage context)
2. What the character is currently wearing

CLOTHING PRIORITY (highest to lowest):
1. NARRATIVE: If the conversation explicitly describes what a character changed into or is currently wearing, use that description verbatim. This overrides everything.
2. IMAGE PROMPT: If the image prompt specifies clothing for a character, use that.
3. STORED: If neither narrative nor prompt specifies clothing, select the best matching stored clothing record based on its usage context and the current scene.
4. DEFAULT: If no stored records match, use the first stored clothing record. If none exist, respond with an empty string.

Respond with a JSON array, one entry per character:
[
  {
    "characterId": "uuid-here",
    "selectedDescriptionId": "uuid-of-best-matching-description-or-null",
    "clothingDescription": "what they are wearing right now",
    "clothingSource": "narrative" | "stored" | "default"
  }
]

IMPORTANT:
- For selectedDescriptionId, pick the description whose usageContext best fits the current scene. Use null to indicate the first/default.
- For clothingDescription, write a concise visual description suitable for image generation.
- clothingSource must be "narrative" if from conversation, "stored" if from a stored record, "default" if using first/fallback.

JSON only - no other text.`

/**
 * Resolves character appearances based on chat context using a cheap LLM
 *
 * @param characters - Characters with their available descriptions and clothing
 * @param recentMessages - Recent chat messages for context
 * @param imagePrompt - The image prompt being generated
 * @param selection - The cheap LLM provider selection
 * @param userId - The user ID for API key retrieval
 * @param chatId - Optional chat ID for logging
 * @returns Array of resolved appearance items
 */
export async function resolveAppearance(
  characters: CharacterAppearanceInput[],
  recentMessages: ChatMessage[],
  imagePrompt: string,
  selection: CheapLLMSelection,
  userId: string,
  chatId?: string
): Promise<CheapLLMTaskResult<AppearanceResolutionItem[]>> {
  // Build character data section
  const characterSection = characters.map(char => {
    const descParts = char.physicalDescriptions.map(d => {
      const context = d.usageContext ? ` (context: ${d.usageContext})` : ''
      const preview = d.mediumPrompt || d.shortPrompt || '(no description text)'
      return `    - ID: ${d.id}, Name: "${d.name}"${context}: ${preview}`
    })

    const clothingParts = char.clothingRecords.map(c => {
      const context = c.usageContext ? ` (context: ${c.usageContext})` : ''
      const desc = c.description || '(no description)'
      return `    - ID: ${c.id}, Name: "${c.name}"${context}: ${desc}`
    })

    return `  Character: ${char.characterName} (ID: ${char.characterId})
  Physical Descriptions:
${descParts.length > 0 ? descParts.join('\n') : '    (none)'}
  Clothing Records:
${clothingParts.length > 0 ? clothingParts.join('\n') : '    (none)'}`
  }).join('\n\n')

  // Format recent messages
  const messageText = recentMessages
    .slice(-20)
    .map(m => {
      const speaker = m.role === 'user' ? 'User' : m.role === 'assistant' ? 'Character' : 'System'
      const content = m.content.length > 500 ? m.content.substring(0, 500) + '...' : m.content
      return `${speaker}: ${content}`
    })
    .join('\n\n')

  const messages: LLMMessage[] = [
    {
      role: 'system',
      content: APPEARANCE_RESOLUTION_PROMPT,
    },
    {
      role: 'user',
      content: `Image prompt: ${imagePrompt}

Characters:
${characterSection}

Recent Conversation:
${messageText || '(no messages yet)'}

Determine what each character currently looks like and is wearing:`,
    },
  ]

  return executeCheapLLMTask(
    selection,
    messages,
    userId,
    (content: string): AppearanceResolutionItem[] => {
      try {
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

        return parsed.map((item: Record<string, unknown>) => ({
          characterId: String(item.characterId || ''),
          selectedDescriptionId: item.selectedDescriptionId ? String(item.selectedDescriptionId) : null,
          clothingDescription: String(item.clothingDescription || ''),
          clothingSource: (['narrative', 'stored', 'default'].includes(String(item.clothingSource))
            ? String(item.clothingSource)
            : 'default') as 'narrative' | 'stored' | 'default',
        }))
      } catch {
        return []
      }
    },
    'resolve-character-appearances',
    chatId
  )
}

// ============================================================================
// APPEARANCE SANITIZATION
// ============================================================================

/**
 * Appearance sanitization system prompt
 * Rewrites explicit/dangerous appearance descriptions into safe alternatives
 */
const APPEARANCE_SANITIZATION_PROMPT = `You are a content safety filter for image generation prompts. You will receive character appearance descriptions that have been flagged as potentially explicit or inappropriate for a standard image generation provider.

Your task is to rewrite ONLY the problematic parts to make them safe for image generation while preserving as much visual detail as possible.

GUIDELINES:
- Replace explicit clothing descriptions with neutral alternatives (e.g., "wearing nothing" → "wearing casual clothes", "lingerie" → "comfortable loungewear")
- Keep hair color, eye color, body type, and other non-explicit physical traits unchanged
- Preserve the character's overall aesthetic and style where possible
- Keep descriptions concise and suitable for image generation
- Do NOT add new details that weren't implied by the original

You will receive a JSON array of objects with characterId and appearanceText.
Respond with the SAME JSON array but with sanitized appearanceText values.

JSON only - no other text.`

/**
 * Sanitizes appearance descriptions that contain dangerous content
 *
 * @param appearances - Array of character appearances to sanitize
 * @param selection - The cheap LLM provider selection
 * @param userId - The user ID for API key retrieval
 * @param chatId - Optional chat ID for logging
 * @returns Array of sanitized appearance texts keyed by characterId
 */
export async function sanitizeAppearance(
  appearances: Array<{ characterId: string; appearanceText: string }>,
  selection: CheapLLMSelection,
  userId: string,
  chatId?: string
): Promise<CheapLLMTaskResult<Array<{ characterId: string; appearanceText: string }>>> {
  const messages: LLMMessage[] = [
    {
      role: 'system',
      content: APPEARANCE_SANITIZATION_PROMPT,
    },
    {
      role: 'user',
      content: JSON.stringify(appearances),
    },
  ]

  return executeCheapLLMTask(
    selection,
    messages,
    userId,
    (content: string): Array<{ characterId: string; appearanceText: string }> => {
      try {
        let cleanContent = content.trim()
        if (cleanContent.startsWith('```json')) {
          cleanContent = cleanContent.replace(/^```json\s*/, '').replace(/\s*```$/, '')
        } else if (cleanContent.startsWith('```')) {
          cleanContent = cleanContent.replace(/^```\s*/, '').replace(/\s*```$/, '')
        }

        const parsed = JSON.parse(cleanContent)
        if (!Array.isArray(parsed)) {
          return appearances // Return originals if parsing fails
        }

        return parsed.map((item: Record<string, unknown>) => ({
          characterId: String(item.characterId || ''),
          appearanceText: String(item.appearanceText || ''),
        }))
      } catch {
        return appearances // Return originals on error
      }
    },
    'sanitize-appearance',
    chatId
  )
}
