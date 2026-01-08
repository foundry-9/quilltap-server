/**
 * Recovery Service
 *
 * Handles graceful recovery from streaming errors like token limit exceeded.
 * When the prompt is too long, this service creates a simplified message
 * to the LLM explaining what happened, so it can provide a helpful response.
 */

import { createServiceLogger } from '@/lib/logging/create-logger'
import { streamMessage, encodeContentChunk, encodeDoneEvent } from './streaming.service'
import {
  parseTokenLimitError,
  parseContentLimitError,
  isTokenLimitError,
  isContentLimitError,
  type ContentLimitType,
} from '@/lib/llm/errors'
import type { ConnectionProfile, Character } from '@/lib/schemas/types'
import type { AttachedFile } from './types'
import type { getRepositories } from '@/lib/repositories/factory'

const logger = createServiceLogger('RecoveryService')

/**
 * Context needed to attempt error recovery
 */
export interface RecoveryContext {
  controller: ReadableStreamDefaultController<Uint8Array>
  encoder: TextEncoder
  character: Character
  connectionProfile: ConnectionProfile
  apiKey: string
  attachedFiles: AttachedFile[]
  originalMessage?: string
  error: unknown
  repos: ReturnType<typeof getRepositories>
  chatId: string
  userId: string
  characterParticipantId: string
}

/**
 * Result of a recovery attempt
 */
export interface RecoveryResult {
  success: boolean
  response?: string
  messageId?: string
  isStaticFallback: boolean
}

/**
 * Format file size in human-readable format
 */
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * Build a minimal system prompt for recovery
 * This should be small enough to always fit within token limits
 */
export function buildRecoverySystemPrompt(characterName: string): string {
  return `You are ${characterName}. A technical issue occurred with the user's message. Please respond helpfully and in character.`
}

/**
 * Determine the type of error for recovery message building
 */
function getErrorType(error: unknown): 'token_limit' | 'content_limit' {
  if (isTokenLimitError(error)) {
    return 'token_limit'
  }
  return 'content_limit'
}

/**
 * Build the recovery user message explaining what happened
 */
export function buildRecoveryUserMessage(
  error: unknown,
  attachedFiles: AttachedFile[],
  originalMessage?: string
): string {
  const errorType = getErrorType(error)
  const parts: string[] = []

  // Header
  parts.push('[Automatic System Notice]')
  parts.push('')

  // Explain the error based on type
  if (errorType === 'token_limit') {
    const { requestedTokens, maxTokens } = parseTokenLimitError(error)
    if (requestedTokens && maxTokens) {
      parts.push(
        `The user's message could not be processed because the total request size ` +
        `(${requestedTokens.toLocaleString()} tokens) exceeded the model's limit ` +
        `(${maxTokens.toLocaleString()} tokens).`
      )
    } else {
      parts.push(
        `The user's message could not be processed because it exceeded the model's token limit.`
      )
    }
  } else {
    // Content limit error (PDF pages, image size, etc.)
    const contentLimit = parseContentLimitError(error)
    const limitDescriptions: Record<ContentLimitType, string> = {
      pdf_pages: 'PDF page limit',
      image_size: 'image size limit',
      file_size: 'file size limit',
      token: 'token limit',
      unknown: 'content limit',
    }

    if (contentLimit.description) {
      parts.push(`The user's message could not be processed: ${contentLimit.description}`)
    } else if (contentLimit.maxValue && contentLimit.type === 'pdf_pages') {
      parts.push(
        `The user's message could not be processed because the attached PDF exceeds ` +
        `the maximum of ${contentLimit.maxValue} pages.`
      )
    } else {
      parts.push(
        `The user's message could not be processed because an attachment exceeded the ` +
        `${limitDescriptions[contentLimit.type]}.`
      )
    }
  }
  parts.push('')

  // Attachment details (if any)
  if (attachedFiles.length > 0) {
    parts.push('Attached file details:')
    for (const file of attachedFiles) {
      parts.push(`- Filename: ${file.filename}`)
      parts.push(`  Type: ${file.mimeType}`)
      parts.push(`  Size: ${formatFileSize(file.size)}`)
    }
    parts.push('')
  } else if (errorType === 'token_limit') {
    parts.push('No files were attached. The limit was likely exceeded due to a long conversation history.')
    parts.push('')
  }

  // Original message (if provided)
  if (originalMessage && originalMessage.trim()) {
    parts.push(`The user's original message was:`)
    parts.push(`"${originalMessage}"`)
    parts.push('')
  }

  // Request helpful response based on error type
  if (errorType === 'content_limit') {
    const contentLimit = parseContentLimitError(error)
    if (contentLimit.type === 'pdf_pages') {
      parts.push(
        'Please acknowledge this limitation and suggest how the user might proceed ' +
        '(e.g., splitting the PDF into smaller parts with fewer pages, extracting specific sections, ' +
        'or summarizing the document themselves and asking specific questions about it).'
      )
    } else {
      parts.push(
        'Please acknowledge this limitation and suggest how the user might proceed ' +
        '(e.g., using a smaller file, compressing the content, or describing what they need help with).'
      )
    }
  } else {
    parts.push(
      'Please acknowledge this limitation and suggest how the user might proceed ' +
      '(e.g., breaking the document into smaller sections, asking about specific ' +
      'parts, or starting a new conversation with a shorter history).'
    )
  }

  return parts.join('\n')
}

/**
 * Build a static fallback message when LLM recovery also fails
 */
export function buildStaticFallbackMessage(
  attachedFiles: AttachedFile[],
  error: unknown
): string {
  const errorType = getErrorType(error)
  const parts: string[] = []

  parts.push('I apologize, but your message could not be processed.')
  parts.push('')

  if (errorType === 'token_limit') {
    const { requestedTokens, maxTokens } = parseTokenLimitError(error)
    if (requestedTokens && maxTokens) {
      parts.push(
        `Your request contained ${requestedTokens.toLocaleString()} tokens, ` +
        `but the maximum allowed is ${maxTokens.toLocaleString()} tokens.`
      )
    } else {
      parts.push('Your request exceeded the maximum token limit.')
    }
  } else {
    const contentLimit = parseContentLimitError(error)
    if (contentLimit.type === 'pdf_pages' && contentLimit.maxValue) {
      parts.push(
        `The attached PDF exceeds the maximum of ${contentLimit.maxValue} pages.`
      )
    } else if (contentLimit.description) {
      parts.push(contentLimit.description)
    } else {
      parts.push('An attached file exceeded the allowed limits.')
    }
  }

  if (attachedFiles.length > 0) {
    parts.push('')
    parts.push(`You attached ${attachedFiles.length} file(s):`)
    for (const file of attachedFiles) {
      parts.push(`- ${file.filename} (${formatFileSize(file.size)})`)
    }
    parts.push('')
    parts.push('Please try one of the following:')

    const contentLimit = parseContentLimitError(error)
    if (contentLimit.type === 'pdf_pages') {
      parts.push('- Split the PDF into smaller parts (under 100 pages each)')
      parts.push('- Extract only the specific pages you need')
      parts.push('- Summarize the key points yourself and ask specific questions')
    } else {
      parts.push('- Remove the attachment and summarize the key points yourself')
      parts.push('- Break the document into smaller sections')
      parts.push('- Use a smaller or compressed version of the file')
    }
  } else if (errorType === 'token_limit') {
    parts.push('')
    parts.push('This conversation may have become too long. Please try:')
    parts.push('- Starting a new conversation')
    parts.push('- Asking a shorter question')
  }

  return parts.join('\n')
}

/**
 * Attempt to recover from a request limit error (token limit, PDF pages, etc.)
 * by sending a simplified message to the LLM explaining what happened.
 *
 * Returns true if recovery was successful, false if we should fall back to error handling.
 */
export async function attemptRequestLimitRecovery(
  context: RecoveryContext
): Promise<RecoveryResult> {
  const {
    controller,
    encoder,
    character,
    connectionProfile,
    apiKey,
    attachedFiles,
    originalMessage,
    error,
    repos,
    chatId,
    characterParticipantId,
  } = context

  const errorType = getErrorType(error)
  const isTokenLimit = errorType === 'token_limit'

  // Get error details for logging
  const tokenInfo = isTokenLimit ? parseTokenLimitError(error) : null
  const contentInfo = !isTokenLimit ? parseContentLimitError(error) : null

  logger.info('Attempting request limit error recovery', {
    chatId,
    errorType,
    characterName: character.name,
    provider: connectionProfile.provider,
    model: connectionProfile.modelName,
    requestedTokens: tokenInfo?.requestedTokens,
    maxTokens: tokenInfo?.maxTokens,
    contentLimitType: contentInfo?.type,
    contentLimitMax: contentInfo?.maxValue,
    attachmentCount: attachedFiles.length,
    attachments: attachedFiles.map(f => ({
      filename: f.filename,
      mimeType: f.mimeType,
      size: f.size,
    })),
  })

  // Build recovery messages
  const systemPrompt = buildRecoverySystemPrompt(character.name)
  const userMessage = buildRecoveryUserMessage(error, attachedFiles, originalMessage)

  const recoveryMessages = [
    { role: 'system' as const, content: systemPrompt },
    { role: 'user' as const, content: userMessage },
  ]

  logger.debug('Recovery message constructed', {
    chatId,
    errorType,
    systemPrompt,
    systemPromptLength: systemPrompt.length,
    userMessage,
    userMessageLength: userMessage.length,
  })

  // Determine recovery type for message metadata
  const recoveryType = isTokenLimit ? 'token_limit' : 'content_limit'

  // Try to stream a recovery response
  try {
    let fullResponse = ''

    for await (const chunk of streamMessage({
      messages: recoveryMessages,
      connectionProfile,
      apiKey,
      modelParams: {
        temperature: 0.7,
        maxTokens: 1000, // Keep response short
      },
      tools: [], // No tools for recovery
      useNativeWebSearch: false,
    })) {
      if (chunk.content) {
        fullResponse += chunk.content
        controller.enqueue(encodeContentChunk(encoder, chunk.content))
      }
    }

    // Save the recovery response as a message
    const messageId = crypto.randomUUID()
    const now = new Date().toISOString()

    await repos.chats.addMessage(chatId, {
      type: 'message',
      id: messageId,
      role: 'ASSISTANT',
      content: fullResponse,
      attachments: [],
      createdAt: now,
      participantId: characterParticipantId,
      recoveryType,
    })

    // Send done event
    controller.enqueue(encodeDoneEvent(encoder, {
      messageId,
      usage: null,
      cacheUsage: null,
      attachmentResults: null,
      toolsExecuted: false,
    }))

    logger.info('Request limit recovery successful', {
      chatId,
      messageId,
      errorType,
      responseLength: fullResponse.length,
    })

    return {
      success: true,
      response: fullResponse,
      messageId,
      isStaticFallback: false,
    }
  } catch (recoveryError) {
    logger.warn('LLM recovery failed, falling back to static message', {
      chatId,
      errorType,
      error: recoveryError instanceof Error ? recoveryError.message : String(recoveryError),
    })

    // Fall back to static message
    return streamStaticFallback(context)
  }
}

/**
 * @deprecated Use attemptRequestLimitRecovery instead
 * Kept for backwards compatibility
 */
export const attemptTokenLimitRecovery = attemptRequestLimitRecovery

/**
 * Stream a static fallback message when LLM recovery fails
 */
async function streamStaticFallback(
  context: RecoveryContext
): Promise<RecoveryResult> {
  const {
    controller,
    encoder,
    attachedFiles,
    error,
    repos,
    chatId,
    characterParticipantId,
  } = context

  const errorType = getErrorType(error)
  const fallbackMessage = buildStaticFallbackMessage(attachedFiles, error)

  logger.debug('Streaming static fallback message', {
    chatId,
    errorType,
    messageLength: fallbackMessage.length,
  })

  // Stream the message in chunks to simulate typing
  const chunkSize = 50
  for (let i = 0; i < fallbackMessage.length; i += chunkSize) {
    const chunk = fallbackMessage.slice(i, i + chunkSize)
    controller.enqueue(encodeContentChunk(encoder, chunk))
  }

  // Determine recovery type for message metadata
  const recoveryType = errorType === 'token_limit' ? 'token_limit_static' : 'content_limit_static'

  // Save the fallback message
  const messageId = crypto.randomUUID()
  const now = new Date().toISOString()

  await repos.chats.addMessage(chatId, {
    type: 'message',
    id: messageId,
    role: 'ASSISTANT',
    content: fallbackMessage,
    attachments: [],
    createdAt: now,
    participantId: characterParticipantId,
    recoveryType,
  })

  // Send done event
  controller.enqueue(encodeDoneEvent(encoder, {
    messageId,
    usage: null,
    cacheUsage: null,
    attachmentResults: null,
    toolsExecuted: false,
  }))

  logger.info('Static fallback recovery complete', {
    chatId,
    messageId,
    errorType,
    responseLength: fallbackMessage.length,
  })

  return {
    success: true,
    response: fallbackMessage,
    messageId,
    isStaticFallback: true,
  }
}
