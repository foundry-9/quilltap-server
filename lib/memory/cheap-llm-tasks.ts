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
 * Executes a cheap LLM task with the given messages
 */
async function executeCheapLLMTask<T>(
  selection: CheapLLMSelection,
  messages: LLMMessage[],
  userId: string,
  parseResponse: (content: string) => T,
  taskType?: string,
  chatId?: string,
  messageId?: string
): Promise<CheapLLMTaskResult<T>> {
  try {
    const apiKey = await getApiKeyForSelection(selection, userId)
    if (apiKey === null) {
      return {
        success: false,
        error: 'No API key available for cheap LLM provider',
      }
    }

    const provider = await createLLMProvider(
      selection.provider,
      selection.baseUrl
    )

    // Create a key for this profile to cache temperature support
    const profileKey = `${selection.provider}:${selection.modelName}`

    // Check if we already know this profile doesn't support custom temperature
    if (profilesWithoutCustomTemp.has(profileKey)) {
      const response: LLMResponse = await provider.sendMessage(
        {
          messages,
          model: selection.modelName,
          maxTokens: 1000,
        },
        apiKey
      )

      // Debug log: Cheap LLM response

      const result = parseResponse(response.content)

      // Log the cheap LLM call (fire and forget)
      logLLMCall({
        userId,
        type: mapTaskTypeToLogType(taskType),
        chatId,
        messageId,
        provider: selection.provider,
        modelName: selection.modelName,
        request: {
          messages: messages.map(m => ({ role: m.role, content: m.content })),
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

      return {
        success: true,
        result,
        usage: response.usage,
      }
    }

    // Try with lower temperature for more consistent outputs
    try {
      const response: LLMResponse = await provider.sendMessage(
        {
          messages,
          model: selection.modelName,
          temperature: 0.3, // Lower temperature for more consistent outputs
          maxTokens: 1000,
        },
        apiKey
      )

      // Debug log: Cheap LLM response

      const result = parseResponse(response.content)

      // Log the cheap LLM call (fire and forget)
      logLLMCall({
        userId,
        type: mapTaskTypeToLogType(taskType),
        chatId,
        messageId,
        provider: selection.provider,
        modelName: selection.modelName,
        request: {
          messages: messages.map(m => ({ role: m.role, content: m.content })),
          temperature: 0.3,
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

      return {
        success: true,
        result,
        usage: response.usage,
      }
    } catch (error) {
      // If temperature is not supported, cache it and retry with default temperature
      const errorMessage = getErrorMessage(error, '')
      if (errorMessage.includes('temperature') || errorMessage.includes('does not support')) {
        profilesWithoutCustomTemp.add(profileKey)

        const response: LLMResponse = await provider.sendMessage(
          {
            messages,
            model: selection.modelName,
            maxTokens: 1000,
          },
          apiKey
        )

        // Debug log: Cheap LLM response (retry)

        const result = parseResponse(response.content)

        // Log the cheap LLM call (fire and forget)
        logLLMCall({
          userId,
          type: mapTaskTypeToLogType(taskType),
          chatId,
          messageId,
          provider: selection.provider,
          modelName: selection.modelName,
          request: {
            messages: messages.map(m => ({ role: m.role, content: m.content })),
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

        return {
          success: true,
          result,
          usage: response.usage,
        }
      }
      throw error
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
  userId: string
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
        return {
          significant: parsed.significant === true,
          content: parsed.content,
          summary: parsed.summary,
          keywords: parsed.keywords || [],
          importance: typeof parsed.importance === 'number' ? parsed.importance : 0.5,
        }
      } catch {
        // If JSON parsing fails, assume not significant
        return { significant: false }
      }
    },
    'memory-extraction-user'
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
  userId: string
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
        return {
          significant: parsed.significant === true,
          content: parsed.content,
          summary: parsed.summary,
          keywords: parsed.keywords || [],
          importance: typeof parsed.importance === 'number' ? parsed.importance : 0.5,
        }
      } catch {
        // If JSON parsing fails, assume not significant
        return { significant: false }
      }
    },
    'memory-extraction-character'
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
  userId: string
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
        return {
          significant: parsed.significant === true,
          content: parsed.content,
          summary: parsed.summary,
          keywords: parsed.keywords || [],
          importance: typeof parsed.importance === 'number' ? parsed.importance : 0.5,
        }
      } catch {
        // If JSON parsing fails, assume not significant
        return { significant: false }
      }
    },
    'memory-extraction-inter-character'
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
 * Chat title prompt template
 */
const CHAT_TITLE_PROMPT = `Generate a short, descriptive title for this conversation.
The title should:
- Be 3-6 words maximum
- Capture the main topic or theme
- Be engaging but not clickbait

Respond with only the title, no quotes or additional text.`

/**
 * Chat title from summary prompt template
 */
const CHAT_TITLE_FROM_SUMMARY_PROMPT = `Generate a short, descriptive title for this conversation based on the summary provided.
The title should:
- Be under 60 characters
- Capture the main topic or theme of the conversation
- Be engaging but not clickbait
- Be concise and clear

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
  // Take only first few messages for title generation
  const relevantMessages = messages.slice(0, 6)
  const conversationText = relevantMessages
    .map(m => `${m.role.toUpperCase()}: ${m.content}`)
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
- If the current title is generic (like "Chat with [Name]" or "New Chat"), it SHOULD be replaced with a descriptive title based on what the conversation is actually about
- If the title is already descriptive, only suggest a change if the main topic has shifted significantly
- A good title captures the essence of the conversation in a few words

Respond with a JSON object:
{
  "needsNewTitle": true/false,
  "reason": "brief explanation",
  "suggestedTitle": "new title if needsNewTitle is true, otherwise null"
}

Keep suggested titles under 60 characters, descriptive, and engaging.`

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

        return parsed.map((item: Record<string, unknown>) => ({
          significant: item.significant === true,
          content: item.content as string | undefined,
          summary: item.summary as string | undefined,
          keywords: (item.keywords as string[]) || [],
          importance: typeof item.importance === 'number' ? item.importance : 0.5,
        }))
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
- A character limit for the final prompt

Your task is to write a SINGLE COHERENT PARAGRAPH that:
1. Describes the scene and what is happening
2. Introduces each person naturally with their physical details woven into the narrative
3. Maintains proper sentence structure and flow

CRITICAL WRITING GUIDELINES:
- Write in a cinematic, descriptive style suitable for image generation
- Introduce people with phrases like "A young woman with...", "Beside her, a middle-aged man with..."
- NEVER just concatenate descriptions - write flowing prose that a human would write
- Use transitional phrases to connect people: "sitting on the lap of", "next to", "holding hands with", etc.
- Keep the scene context (location, mood, lighting) as a frame around the people descriptions
- Each person must be clearly distinct and identifiable in the description

STRUCTURE EXAMPLE:
BAD (concatenated): "Woman with red hair, hazel eyes, fair skin. sitting on Man with gray hair, glasses, plaid shirt.'s lap on a bench"
GOOD (coherent): "On a sunlit park bench, a young woman with flowing red-orange hair and warm hazel eyes sits comfortably on the lap of a middle-aged man wearing rectangular glasses and a cozy sweater vest. Dappled light filters through the leaves above them."

For the descriptions:
- Use the most detailed tier that fits within the limit
- You may condense or paraphrase descriptions to fit naturally
- Prioritize the most visually distinctive features (hair color, eye color, notable clothing, distinguishing features)
- Don't include every detail if it makes the text awkward - focus on what matters visually

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
    tiers: {
      short?: string
      medium?: string
      long?: string
      complete?: string
    }
  }>
  /** Target maximum length */
  targetLength: number
  /** Target provider (for context) */
  provider: string
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

      if (parts.length === 1) {
        // No descriptions available
        parts.push(`  (No descriptions available - use name only)`);
      }

      return parts.join('\n');
    })
    .join('\n\n');

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
  userId: string
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
    'compress-conversation-history'
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
  userId: string
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
    'compress-system-prompt'
  )
}
