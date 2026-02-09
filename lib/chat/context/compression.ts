/**
 * Context Compression Module
 * Sliding Window Context Compression Feature
 *
 * Provides context compression for long conversations by:
 * 1. Compressing older messages (beyond the sliding window) using a cheap LLM
 * 2. Compressing the system prompt for messages 6+
 * 3. Keeping recent messages in full to preserve conversational continuity
 */

import { Provider, ConnectionProfile } from '@/lib/schemas/types'
import { ContextCompressionSettings, DangerousContentSettings } from '@/lib/schemas/settings.types'
import { CheapLLMSelection } from '@/lib/llm/cheap-llm'
import {
  compressConversationHistory,
  compressSystemPrompt,
  type ChatMessage,
  type CompressionResult,
  type UncensoredFallbackOptions,
} from '@/lib/memory/cheap-llm-tasks'
import { logger } from '@/lib/logger'

/**
 * Options for context compression
 */
export interface ContextCompressionOptions {
  /** Whether compression is enabled */
  enabled: boolean
  /** Number of recent messages to keep in full (sliding window size) */
  windowSize: number
  /** Target token count for compressed conversation history */
  compressionTargetTokens: number
  /** Target token count for compressed system prompt */
  systemPromptTargetTokens: number
  /** Cheap LLM selection for compression */
  selection: CheapLLMSelection
  /** User ID for API access */
  userId: string
  /** Character name for compression prompt */
  characterName: string
  /** User/persona name for compression prompt */
  userName: string
  /** Dangerous content settings for uncensored fallback */
  dangerSettings?: DangerousContentSettings
  /** Available connection profiles for uncensored fallback */
  availableProfiles?: ConnectionProfile[]
}

/**
 * Result of context compression
 */
export interface ContextCompressionResult {
  /** Whether compression was applied */
  compressionApplied: boolean
  /** Compressed conversation history (if applied) */
  compressedHistory?: string
  /** Compressed system prompt (if applied) */
  compressedSystemPrompt?: string
  /** Details about the compression */
  compressionDetails?: {
    /** Original number of messages */
    originalMessageCount: number
    /** Number of messages that were compressed */
    compressedMessageCount: number
    /** Number of messages kept in full (window) */
    windowMessageCount: number
    /** Token estimate of original history */
    originalHistoryTokens: number
    /** Token estimate of compressed history */
    compressedHistoryTokens: number
    /** Token estimate of original system prompt */
    originalSystemPromptTokens: number
    /** Token estimate of compressed system prompt */
    compressedSystemPromptTokens: number
    /** Total token savings */
    totalSavings: number
  }
  /** Errors that occurred during compression (non-fatal) */
  warnings: string[]
}

/**
 * Messages to compress - simplified format
 */
export interface CompressibleMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
}

/**
 * Determines if compression should be applied based on message count and settings
 *
 * @param messageCount - Total number of messages in the conversation
 * @param settings - Compression settings
 * @param bypassCompression - Whether to bypass compression (e.g., requestFullContext flag)
 * @returns Whether compression should be applied
 */
export function shouldApplyCompression(
  messageCount: number,
  settings: ContextCompressionSettings,
  bypassCompression: boolean
): boolean {
  // Don't compress if disabled
  if (!settings.enabled) {
    return false
  }

  // Don't compress if bypass is requested
  if (bypassCompression) {
    return false
  }

  // Only compress if we have more messages than the window size
  // Messages 1-5 (or 1-windowSize) get full context
  return messageCount > settings.windowSize
}

/**
 * Splits messages into those to compress and those to keep in full (window)
 *
 * @param messages - All messages in the conversation
 * @param windowSize - Number of recent messages to keep in full
 * @returns Object containing messages to compress and messages to keep
 */
export function splitMessagesForCompression(
  messages: CompressibleMessage[],
  windowSize: number
): {
  messagesToCompress: CompressibleMessage[]
  windowMessages: CompressibleMessage[]
} {
  if (messages.length <= windowSize) {
    // Nothing to compress
    return {
      messagesToCompress: [],
      windowMessages: messages,
    }
  }

  // Keep the last N messages in the window (full context)
  const windowMessages = messages.slice(-windowSize)
  // Compress everything before the window
  const messagesToCompress = messages.slice(0, messages.length - windowSize)

  return {
    messagesToCompress,
    windowMessages,
  }
}

/**
 * Applies context compression to conversation history and system prompt
 *
 * @param messages - All messages in the conversation (excluding system prompt)
 * @param systemPrompt - The full system prompt
 * @param options - Compression options
 * @returns Compression result with compressed content or original if compression failed
 */
export async function applyContextCompression(
  messages: CompressibleMessage[],
  systemPrompt: string,
  options: ContextCompressionOptions
): Promise<ContextCompressionResult> {
  const warnings: string[] = []

  logger.info('[ContextCompression] Applying context compression', {
    context: 'context-compression',
    messageCount: messages.length,
    windowSize: options.windowSize,
    characterName: options.characterName,
    userName: options.userName,
  })

  // Split messages into those to compress and those to keep
  const { messagesToCompress, windowMessages } = splitMessagesForCompression(
    messages,
    options.windowSize
  )

  // If nothing to compress, return early
  if (messagesToCompress.length === 0) {
    return {
      compressionApplied: false,
      warnings: ['No messages to compress (all within window size)'],
    }
  }

  // Convert to ChatMessage format for the compression function
  const chatMessages: ChatMessage[] = messagesToCompress.map(m => ({
    role: m.role,
    content: m.content,
  }))

  // Build uncensored fallback options if danger settings are provided
  const uncensoredFallback: UncensoredFallbackOptions | undefined =
    options.dangerSettings && options.availableProfiles
      ? { dangerSettings: options.dangerSettings, availableProfiles: options.availableProfiles }
      : undefined

  let compressedHistory: string | undefined
  let historyCompressionResult: CompressionResult | undefined

  // Compress conversation history
  try {
    const historyResult = await compressConversationHistory(
      chatMessages,
      options.characterName,
      options.userName,
      options.compressionTargetTokens,
      options.selection,
      options.userId,
      uncensoredFallback
    )

    if (historyResult.success && historyResult.result) {
      compressedHistory = historyResult.result.compressedText
      historyCompressionResult = historyResult.result

      logger.info('[ContextCompression] Conversation history compressed successfully', {
        context: 'context-compression',
        originalTokens: historyResult.result.originalTokens,
        compressedTokens: historyResult.result.compressedTokens,
        savings: historyResult.result.originalTokens - historyResult.result.compressedTokens,
      })
    } else {
      warnings.push(`Failed to compress conversation history: ${historyResult.error}`)
      logger.warn('[ContextCompression] Failed to compress conversation history', {
        context: 'context-compression',
        error: historyResult.error,
      })
    }
  } catch (error) {
    warnings.push(`Error during conversation compression: ${error instanceof Error ? error.message : 'Unknown error'}`)
    logger.error('[ContextCompression] Error compressing conversation history', {
      context: 'context-compression',
    }, error instanceof Error ? error : undefined)
  }

  let compressedSystemPrompt: string | undefined
  let systemPromptCompressionResult: CompressionResult | undefined

  // Compress system prompt
  try {
    const systemResult = await compressSystemPrompt(
      systemPrompt,
      options.systemPromptTargetTokens,
      options.selection,
      options.userId,
      uncensoredFallback
    )

    if (systemResult.success && systemResult.result) {
      compressedSystemPrompt = systemResult.result.compressedText
      systemPromptCompressionResult = systemResult.result

      logger.info('[ContextCompression] System prompt compressed successfully', {
        context: 'context-compression',
        originalTokens: systemResult.result.originalTokens,
        compressedTokens: systemResult.result.compressedTokens,
        savings: systemResult.result.originalTokens - systemResult.result.compressedTokens,
      })
    } else {
      warnings.push(`Failed to compress system prompt: ${systemResult.error}`)
      logger.warn('[ContextCompression] Failed to compress system prompt', {
        context: 'context-compression',
        error: systemResult.error,
      })
    }
  } catch (error) {
    warnings.push(`Error during system prompt compression: ${error instanceof Error ? error.message : 'Unknown error'}`)
    logger.error('[ContextCompression] Error compressing system prompt', {
      context: 'context-compression',
    }, error instanceof Error ? error : undefined)
  }

  // Calculate compression details
  const compressionApplied = !!(compressedHistory || compressedSystemPrompt)

  if (compressionApplied) {
    const originalHistoryTokens = historyCompressionResult?.originalTokens ?? 0
    const compressedHistoryTokens = historyCompressionResult?.compressedTokens ?? 0
    const originalSystemPromptTokens = systemPromptCompressionResult?.originalTokens ?? 0
    const compressedSystemPromptTokens = systemPromptCompressionResult?.compressedTokens ?? 0

    const historySavings = originalHistoryTokens - compressedHistoryTokens
    const systemPromptSavings = originalSystemPromptTokens - compressedSystemPromptTokens
    const totalSavings = historySavings + systemPromptSavings

    logger.info('[ContextCompression] Compression complete', {
      context: 'context-compression',
      compressionApplied: true,
      messagesCompressed: messagesToCompress.length,
      windowMessages: windowMessages.length,
      historySavings,
      systemPromptSavings,
      totalSavings,
    })

    return {
      compressionApplied: true,
      compressedHistory,
      compressedSystemPrompt,
      compressionDetails: {
        originalMessageCount: messages.length,
        compressedMessageCount: messagesToCompress.length,
        windowMessageCount: windowMessages.length,
        originalHistoryTokens,
        compressedHistoryTokens,
        originalSystemPromptTokens,
        compressedSystemPromptTokens,
        totalSavings,
      },
      warnings,
    }
  }

  // Neither succeeded - return without compression applied
  return {
    compressionApplied: false,
    warnings,
  }
}

/**
 * Builds a system message containing compressed context
 * This is prepended to the messages when compression is applied
 *
 * @param compressedHistory - The compressed conversation history
 * @param compressedSystemPrompt - The compressed system prompt (or null to use full)
 * @param fullSystemPrompt - The full system prompt (used if compression failed)
 * @returns The assembled system message content
 */
export function buildCompressedSystemMessage(
  compressedHistory: string | undefined,
  compressedSystemPrompt: string | undefined,
  fullSystemPrompt: string
): string {
  // Use compressed system prompt if available, otherwise use full
  const systemPromptToUse = compressedSystemPrompt || fullSystemPrompt

  if (!compressedHistory) {
    // No compressed history, just return the system prompt
    return systemPromptToUse
  }

  // Combine compressed system prompt with compressed history
  return `${systemPromptToUse}

## Conversation Context (Compressed Summary of Earlier Messages)

The following is a summary of the earlier conversation. Recent messages follow this summary.

${compressedHistory}`
}
