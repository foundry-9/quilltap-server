/**
 * Chat Message Orchestrator Service
 *
 * Coordinates all services for handling chat message sending.
 * This is the main entry point for the message API route.
 */

import { createServiceLogger } from '@/lib/logging/create-logger'
import { createLLMProvider } from '@/lib/llm'
import { requiresApiKey } from '@/lib/plugins/provider-validation'
import {
  selectNextSpeaker,
  calculateTurnStateFromHistory,
  getActiveCharacterParticipants,
  isMultiCharacterChat,
} from '@/lib/chat/turn-manager'
import { stripCharacterNamePrefix } from '@/lib/llm/message-formatter'
import { z } from 'zod'

import type { getRepositories } from '@/lib/repositories/factory'
import type { MessageEvent, ConnectionProfile, ChatMetadataBase, Character, ChatSettings } from '@/lib/schemas/types'
import type { SendMessageOptions, ToolMessage, GeneratedImage } from './types'
import type { MemoryChatSettings } from './memory-trigger.service'

import {
  resolveRespondingParticipant,
  loadAllParticipantData,
  getPersonaData,
  getRoleplayTemplate,
} from './participant-resolver.service'
import {
  loadAndProcessFiles,
  buildMessageContext,
} from './context-builder.service'
import {
  processToolCalls,
  saveToolMessages,
  detectToolCallsInResponse,
  createToolContext,
} from './tool-execution.service'
import {
  buildTools,
  streamMessage,
  encodeDebugInfo,
  encodeFallbackInfo,
  encodeContentChunk,
  encodeDoneEvent,
  encodeErrorEvent,
} from './streaming.service'
import {
  checkShouldUsePseudoTools,
  buildPseudoToolSystemInstructions,
  parsePseudoToolsFromResponse,
  stripPseudoToolMarkersFromResponse,
  determineEnabledToolOptions,
  logPseudoToolUsage,
} from './pseudo-tool.service'
import {
  parseXMLToolCalls,
  convertXMLToToolCallRequest,
  stripXMLToolMarkers,
  hasXMLToolMarkers,
} from '@/lib/tools'
import {
  triggerMemoryExtraction,
  triggerInterCharacterMemory,
  triggerUserControlledCharacterMemory,
  triggerContextSummaryCheck,
} from './memory-trigger.service'
import { trackMessageTokenUsage } from '@/lib/services/token-tracking.service'
import { estimateMessageCost } from '@/lib/services/cost-estimation.service'
import { isRecoverableRequestError } from '@/lib/llm/errors'
import { attemptRequestLimitRecovery } from './recovery.service'
import { getCheapLLMProvider, DEFAULT_CHEAP_LLM_CONFIG } from '@/lib/llm/cheap-llm'
import type { ContextCompressionSettings } from '@/lib/schemas/settings.types'
import {
  getCachedCompression,
  triggerAsyncCompression,
  invalidateCompressionCache,
} from './compression-cache.service'

const logger = createServiceLogger('ChatMessageOrchestrator')

/**
 * Validation schema for send message
 */
export const sendMessageSchema = z.object({
  content: z.string().min(1, 'Message content is required'),
  fileIds: z.array(z.string()).optional(),
})

/**
 * Validation schema for continue mode (nudge action)
 */
export const continueMessageSchema = z.object({
  continueMode: z.literal(true),
  respondingParticipantId: z.string().uuid().optional(),
})

/**
 * Handle sending a message and streaming the response
 */
export async function handleSendMessage(
  repos: ReturnType<typeof getRepositories>,
  chatId: string,
  userId: string,
  options: SendMessageOptions
): Promise<ReadableStream<Uint8Array>> {
  const encoder = new TextEncoder()

  return new ReadableStream({
    async start(controller) {
      try {
        await processMessage(repos, chatId, userId, options, controller, encoder)
      } catch (error) {
        handleStreamError(error, controller, encoder)
      }
    },
  })
}

/**
 * Main message processing logic
 */
async function processMessage(
  repos: ReturnType<typeof getRepositories>,
  chatId: string,
  userId: string,
  options: SendMessageOptions,
  controller: ReadableStreamDefaultController<Uint8Array>,
  encoder: TextEncoder
): Promise<void> {
  const isContinueMode = options.continueMode === true

  // Get chat metadata
  const chat = await repos.chats.findById(chatId)
  if (!chat) {
    throw new Error('Chat not found')
  }

  // Resolve responding participant
  const participantResult = await resolveRespondingParticipant(
    repos,
    chat,
    userId,
    options.respondingParticipantId,
    isContinueMode
  )

  const {
    characterParticipant,
    character,
    connectionProfile,
    apiKey: rawApiKey,
    imageProfileId,
    userParticipant,
    userParticipantId,
    isMultiCharacter,
  } = participantResult

  // Validate API key for providers that require it
  let apiKey = ''
  if (requiresApiKey(connectionProfile.provider)) {
    if (!rawApiKey) {
      throw new Error('No API key configured for this connection profile')
    }
    apiKey = rawApiKey
  }

  // Get persona data
  const { persona, personaData } = await getPersonaData(repos, chat)

  // Get user-controlled character ID (for memory aboutCharacterId)
  // This is the character that the user is "playing as" in this chat
  const userControlledParticipant = chat.participants.find(
    p => p.type === 'CHARACTER' && p.controlledBy === 'user' && p.characterId && p.isActive
  )
  const userCharacterId = userControlledParticipant?.characterId || undefined

  // Get chat settings
  const chatSettings = await repos.chatSettings.findByUserId(userId)

  // ============================================================================
  // Context Compression Setup
  // ============================================================================

  // Check if full context was requested (requestFullContextOnNextMessage flag)
  let bypassCompression = false
  if (chat.requestFullContextOnNextMessage === true) {
    bypassCompression = true
    // Reset the flag
    await repos.chats.update(chatId, { requestFullContextOnNextMessage: false })
    logger.info('Bypassing context compression (full context requested)', { chatId })
  }

  // Get context compression settings (default to enabled)
  const contextCompressionSettings: ContextCompressionSettings = chatSettings?.contextCompressionSettings || {
    enabled: true,
    windowSize: 5,
    compressionTargetTokens: 800,
    systemPromptTargetTokens: 1500,
  }

  // Get cheap LLM selection for compression
  let cheapLLMSelection = null
  if (contextCompressionSettings.enabled && !bypassCompression) {
    try {
      // Get all connection profiles for cheap LLM selection
      const allProfiles = await repos.connections.findByUserId(userId)
      const cheapLLMConfig = chatSettings?.cheapLLMSettings || DEFAULT_CHEAP_LLM_CONFIG

      // Convert null values to undefined for CheapLLMConfig compatibility
      const compatibleConfig = {
        ...cheapLLMConfig,
        userDefinedProfileId: cheapLLMConfig.userDefinedProfileId ?? undefined,
        defaultCheapProfileId: cheapLLMConfig.defaultCheapProfileId ?? undefined,
      }

      cheapLLMSelection = getCheapLLMProvider(
        connectionProfile,
        compatibleConfig,
        allProfiles,
        false // Ollama availability - could be checked but keeping simple for now
      )

      logger.debug('Cheap LLM selection for compression', {
        provider: cheapLLMSelection.provider,
        model: cheapLLMSelection.modelName,
        isLocal: cheapLLMSelection.isLocal,
      })
    } catch (error) {
      logger.warn('Failed to get cheap LLM for compression, compression will be skipped', {
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  // Determine if compression is actually enabled for this request
  const compressionEnabled = !!(contextCompressionSettings.enabled && cheapLLMSelection && !bypassCompression)

  // Get roleplay template
  const roleplayTemplate = await getRoleplayTemplate(repos, chat, chatSettings ? { defaultRoleplayTemplateId: chatSettings.defaultRoleplayTemplateId ?? undefined } : null)

  // Get image profile if configured
  let imageProfile = null
  if (imageProfileId) {
    imageProfile = await repos.imageProfiles.findById(imageProfileId)
  }

  // Load participant data for multi-character chats
  let participantCharacters = new Map()
  let participantPersonas = new Map()

  if (isMultiCharacter) {
    const participantData = await loadAllParticipantData(
      repos,
      chat,
      character,
      personaData
    )
    participantCharacters = participantData.participantCharacters
    participantPersonas = participantData.participantPersonas
  }

  // Get existing messages
  const existingMessages = await repos.chats.getMessages(chatId)

  // Process file attachments
  const fileProcessing = await loadAndProcessFiles(
    repos,
    chatId,
    userId,
    connectionProfile,
    options.fileIds
  )

  // Save user message (not in continue mode)
  let userMessageId: string | null = null
  let content = ''

  if (!isContinueMode && options.content) {
    content = options.content
    userMessageId = crypto.randomUUID()
    const now = new Date().toISOString()

    const userMessage = {
      id: userMessageId,
      type: 'message' as const,
      role: 'USER' as const,
      content,
      createdAt: now,
      attachments: options.fileIds || [],
      participantId: userParticipantId,
    }

    await repos.chats.addMessage(chatId, userMessage)

    logger.debug('User message saved', {
      messageId: userMessageId,
      participantId: userParticipantId,
      isMultiCharacter,
    })

    // Link file attachments
    for (const file of fileProcessing.attachedFiles) {
      await repos.files.addLink(file.id, userMessageId)
    }
  }

  // Build final user message content
  const finalUserMessageContent = isContinueMode
    ? undefined
    : (fileProcessing.messageContentPrefix ? fileProcessing.messageContentPrefix + content : content)

  // Check for pseudo-tools
  const enabledToolOptions = determineEnabledToolOptions(
    imageProfileId,
    connectionProfile.allowWebSearch
  )

  // Build tools (include request_full_context when compression is enabled)
  const { tools, modelSupportsNativeTools, useNativeWebSearch } = await buildTools(
    connectionProfile,
    imageProfileId,
    imageProfile,
    userId,
    false, // Will check pseudo-tools after
    undefined, // projectId (will be set if needed)
    compressionEnabled // requestFullContext - enable the tool when compression is active
  )

  const usePseudoTools = checkShouldUsePseudoTools(modelSupportsNativeTools)
  const actualTools = usePseudoTools ? [] : tools

  // Build pseudo-tool instructions if needed
  let pseudoToolInstructions: string | undefined
  if (usePseudoTools) {
    pseudoToolInstructions = buildPseudoToolSystemInstructions(enabledToolOptions)
    logPseudoToolUsage(connectionProfile.provider, connectionProfile.modelName, enabledToolOptions)
  }

  // Build message context
  const modelParams = connectionProfile.parameters as Record<string, unknown>
  const contextChatSettings = chatSettings ? {
    cheapLLMSettings: chatSettings.cheapLLMSettings ? {
      embeddingProfileId: chatSettings.cheapLLMSettings.embeddingProfileId ?? undefined,
    } : undefined,
    defaultTimestampConfig: chatSettings.defaultTimestampConfig,
  } : null

  // ============================================================================
  // Async Pre-Compression: Get cached compression result if available
  // ============================================================================
  let cachedCompressionResult = null
  if (compressionEnabled && !bypassCompression) {
    // Try to get cached compression from previous async pre-computation
    cachedCompressionResult = await getCachedCompression(chatId, existingMessages.length)
    if (cachedCompressionResult) {
      logger.info('Using cached compression from async pre-computation', {
        chatId,
        messageCount: existingMessages.length,
        savings: cachedCompressionResult.compressionDetails?.totalSavings,
      })
    }
  } else if (bypassCompression) {
    // Invalidate cache when bypass is requested
    invalidateCompressionCache(chatId)
  }

  const { builtContext, formattedMessages, isInitialMessage } = await buildMessageContext(
    {
      repos,
      userId,
      chat,
      character,
      characterParticipant,
      connectionProfile,
      persona,
      personaData,
      isMultiCharacter,
      participantCharacters,
      participantPersonas,
      roleplayTemplate,
      chatSettings: contextChatSettings,
      pseudoToolInstructions,
      newUserMessage: finalUserMessageContent,
      isContinueMode,
      // Context compression options
      contextCompressionSettings: compressionEnabled ? contextCompressionSettings : null,
      cheapLLMSelection,
      bypassCompression,
      cachedCompressionResult,
    },
    existingMessages,
    fileProcessing.attachmentsToSend
  )

  // Create tool context
  const toolContext = createToolContext(
    chatId,
    userId,
    character.id,
    characterParticipant.id,
    imageProfileId,
    chatSettings?.cheapLLMSettings?.embeddingProfileId ?? undefined,
    chat.projectId
  )

  // Send debug info
  controller.enqueue(encodeDebugInfo(encoder, {
    builtContext,
    connectionProfile,
    modelParams,
    messages: formattedMessages.map(m => ({
      role: m.role,
      contentLength: m.content.length,
      hasAttachments: !!m.attachments?.length,
    })),
    tools: actualTools,
    usePseudoTools,
    enabledToolOptions: enabledToolOptions as unknown as Record<string, boolean>,
  }))

  // Send fallback processing info if any
  if (fileProcessing.fallbackResults.length > 0) {
    controller.enqueue(encodeFallbackInfo(encoder, fileProcessing.fallbackResults))
  }

  // Stream the response
  let fullResponse = ''
  let usage: { promptTokens?: number; completionTokens?: number; totalTokens?: number } | null = null
  let cacheUsage: { cacheCreationInputTokens?: number; cacheReadInputTokens?: number } | null = null
  let attachmentResults: { sent: string[]; failed: { id: string; error: string }[] } | null = null
  let rawResponse: unknown = null
  let thoughtSignature: string | undefined

  try {
    for await (const chunk of streamMessage({
      messages: formattedMessages,
      connectionProfile,
      apiKey,
      modelParams,
      tools: actualTools,
      useNativeWebSearch,
    })) {
      if (chunk.content) {
        fullResponse += chunk.content
        controller.enqueue(encodeContentChunk(encoder, chunk.content))
      }

      if (chunk.done) {
        usage = chunk.usage || null
        cacheUsage = chunk.cacheUsage || null
        attachmentResults = chunk.attachmentResults || null
        rawResponse = chunk.rawResponse
        if (chunk.thoughtSignature) {
          thoughtSignature = chunk.thoughtSignature
          logger.debug('Captured thought signature from response', {
            signatureLength: thoughtSignature.length,
          })
        }
      }
    }
  } catch (streamingError) {
    // Check if this is a recoverable request error (token limit, PDF pages, etc.)
    if (isRecoverableRequestError(streamingError)) {
      logger.info('Recoverable request error detected, attempting recovery', {
        chatId,
        provider: connectionProfile.provider,
        model: connectionProfile.modelName,
        attachmentCount: fileProcessing.attachedFiles.length,
        error: streamingError instanceof Error ? streamingError.message : String(streamingError),
      })

      const recoveryResult = await attemptRequestLimitRecovery({
        controller,
        encoder,
        character,
        connectionProfile,
        apiKey,
        attachedFiles: fileProcessing.attachedFiles,
        originalMessage: options.content,
        error: streamingError,
        repos,
        chatId,
        userId,
        characterParticipantId: characterParticipant.id,
      })

      if (recoveryResult.success) {
        logger.info('Request limit recovery successful', {
          chatId,
          messageId: recoveryResult.messageId,
          isStaticFallback: recoveryResult.isStaticFallback,
        })
        // Close the stream - recovery has handled everything
        controller.close()
        return
      }

      // Recovery failed, re-throw the original error
      logger.warn('Request limit recovery failed, propagating error', { chatId })
    }

    // Not a recoverable error or recovery failed - re-throw
    throw streamingError
  }

  // Process tool calls
  let toolMessages: ToolMessage[] = []
  let generatedImagePaths: GeneratedImage[] = []
  let currentMessages = [...formattedMessages]
  let currentResponse = fullResponse
  let currentRawResponse = rawResponse
  const MAX_TOOL_ITERATIONS = 5
  let toolIterations = 0

  // Tool call loop
  while (currentRawResponse && toolIterations < MAX_TOOL_ITERATIONS) {
    const toolCalls = detectToolCallsInResponse(currentRawResponse, connectionProfile.provider)

    if (toolCalls.length === 0) break

    toolIterations++
    logger.debug('Processing tool calls, iteration', {
      iteration: toolIterations,
      toolCallCount: toolCalls.length,
      tools: toolCalls.map(tc => tc.name),
    })

    const results = await processToolCalls(toolCalls, toolContext, controller, encoder)
    toolMessages = [...toolMessages, ...results.toolMessages]
    generatedImagePaths = [...generatedImagePaths, ...results.generatedImagePaths]

    // Add assistant message with tool call to conversation
    if (currentResponse && currentResponse.trim().length > 0) {
      currentMessages = [
        ...currentMessages,
        { role: 'assistant' as const, content: currentResponse, thoughtSignature, name: undefined }
      ]
    } else {
      currentMessages = [
        ...currentMessages,
        { role: 'assistant' as const, content: '[Tool call made]', thoughtSignature, name: undefined }
      ]
    }

    // Add tool results as user messages
    for (const toolMsg of results.toolMessages) {
      currentMessages = [
        ...currentMessages,
        { role: 'user' as const, content: `[Tool Result: ${toolMsg.toolName}]\n${toolMsg.content}`, thoughtSignature: undefined, name: undefined }
      ]
    }

    // Continue conversation with tool results
    currentResponse = ''
    currentRawResponse = null

    for await (const chunk of streamMessage({
      messages: currentMessages,
      connectionProfile,
      apiKey,
      modelParams,
      tools: actualTools,
      useNativeWebSearch,
    })) {
      if (chunk.content) {
        currentResponse += chunk.content
        fullResponse += chunk.content
        controller.enqueue(encodeContentChunk(encoder, chunk.content))
      }

      if (chunk.done) {
        usage = chunk.usage || null
        cacheUsage = chunk.cacheUsage || null
        attachmentResults = chunk.attachmentResults || null
        currentRawResponse = chunk.rawResponse
        rawResponse = chunk.rawResponse
        if (chunk.thoughtSignature) {
          thoughtSignature = chunk.thoughtSignature
        }
      }
    }
  }

  if (toolIterations >= MAX_TOOL_ITERATIONS) {
    logger.warn('Max tool iterations reached', { iterations: toolIterations, chatId })
  }

  // Process XML tool calls (runs for ALL providers, regardless of pseudo-tool mode)
  // This catches LLMs that spontaneously emit XML-style function calls (e.g., DeepSeek)
  if (fullResponse && hasXMLToolMarkers(fullResponse)) {
    const xmlToolCalls = parseXMLToolCalls(fullResponse)

    if (xmlToolCalls.length > 0) {
      const xmlToolCallRequests = xmlToolCalls.map(convertXMLToToolCallRequest)

      logger.info('Detected XML tool calls in response', {
        count: xmlToolCallRequests.length,
        tools: xmlToolCallRequests.map(tc => tc.name),
        formats: xmlToolCalls.map(tc => tc.format),
      })

      const results = await processToolCalls(xmlToolCallRequests, toolContext, controller, encoder)
      toolMessages = [...toolMessages, ...results.toolMessages]
      generatedImagePaths = [...generatedImagePaths, ...results.generatedImagePaths]

      const strippedResponse = stripXMLToolMarkers(fullResponse)

      // Add stripped response and tool results to conversation
      currentMessages = [...formattedMessages]
      if (strippedResponse.trim()) {
        currentMessages.push({
          role: 'assistant' as const,
          content: strippedResponse,
          thoughtSignature,
          name: undefined,
        })
      }

      for (const toolMsg of results.toolMessages) {
        currentMessages.push({
          role: 'user' as const,
          content: `[Tool Result: ${toolMsg.toolName}]\n${toolMsg.content}`,
          thoughtSignature: undefined,
          name: undefined,
        })
      }

      // Continue conversation with tool results
      let continuationResponse = ''
      for await (const chunk of streamMessage({
        messages: currentMessages,
        connectionProfile,
        apiKey,
        modelParams,
        tools: actualTools,
        useNativeWebSearch,
      })) {
        if (chunk.content) {
          continuationResponse += chunk.content
          controller.enqueue(encodeContentChunk(encoder, chunk.content))
        }

        if (chunk.done) {
          usage = chunk.usage || null
          cacheUsage = chunk.cacheUsage || null
          rawResponse = chunk.rawResponse
          if (chunk.thoughtSignature) {
            thoughtSignature = chunk.thoughtSignature
          }
        }
      }

      fullResponse = strippedResponse + (strippedResponse.trim() && continuationResponse.trim() ? '\n\n' : '') + continuationResponse
      // Strip any remaining XML markers from the continuation
      fullResponse = stripXMLToolMarkers(fullResponse)
    }
  }

  // Process pseudo-tools
  if (usePseudoTools && fullResponse) {
    const pseudoToolCalls = parsePseudoToolsFromResponse(fullResponse)

    if (pseudoToolCalls.length > 0) {
      const results = await processToolCalls(pseudoToolCalls, toolContext, controller, encoder)
      toolMessages = [...toolMessages, ...results.toolMessages]
      generatedImagePaths = [...generatedImagePaths, ...results.generatedImagePaths]

      const strippedResponse = stripPseudoToolMarkersFromResponse(fullResponse)

      // Add stripped response and tool results to conversation
      currentMessages = [...formattedMessages]
      if (strippedResponse.trim()) {
        currentMessages.push({
          role: 'assistant' as const,
          content: strippedResponse,
          thoughtSignature,
          name: undefined,
        })
      }

      for (const toolMsg of results.toolMessages) {
        currentMessages.push({
          role: 'user' as const,
          content: `[Tool Result: ${toolMsg.toolName}]\n${toolMsg.content}`,
          thoughtSignature: undefined,
          name: undefined,
        })
      }

      // Continue conversation with tool results
      let continuationResponse = ''
      for await (const chunk of streamMessage({
        messages: currentMessages,
        connectionProfile,
        apiKey,
        modelParams,
        tools: [],
        useNativeWebSearch: useNativeWebSearch && !usePseudoTools,
      })) {
        if (chunk.content) {
          continuationResponse += chunk.content
          controller.enqueue(encodeContentChunk(encoder, chunk.content))
        }

        if (chunk.done) {
          usage = chunk.usage || null
          cacheUsage = chunk.cacheUsage || null
          rawResponse = chunk.rawResponse
          if (chunk.thoughtSignature) {
            thoughtSignature = chunk.thoughtSignature
          }
        }
      }

      fullResponse = strippedResponse + (strippedResponse.trim() && continuationResponse.trim() ? '\n\n' : '') + continuationResponse
      fullResponse = stripPseudoToolMarkersFromResponse(fullResponse)
    }
  }

  // Save assistant message
  let assistantMessageId: string | null = null

  if (fullResponse && fullResponse.trim().length > 0) {
    // Strip any character name prefixes that the LLM might have echoed back
    // This handles cases where LLMs mimic the [Name] prefix format from the input
    const cleanedResponse = stripCharacterNamePrefix(fullResponse, character.name)

    assistantMessageId = await saveAssistantMessage(
      repos,
      chatId,
      character,
      characterParticipant,
      cleanedResponse,
      usage,
      rawResponse,
      thoughtSignature,
      generatedImagePaths,
      toolMessages
    )

    // Track token usage for profile and chat aggregates
    if (usage && (usage.promptTokens || usage.completionTokens)) {
      // Estimate cost using available pricing data
      const costResult = await estimateMessageCost(
        connectionProfile.provider,
        connectionProfile.modelName,
        usage.promptTokens || 0,
        usage.completionTokens || 0,
        userId
      )
      await trackMessageTokenUsage(chatId, connectionProfile.id, usage, costResult.cost, costResult.source)
    }

    // Update chat timestamp
    await repos.chats.update(chatId, { updatedAt: new Date().toISOString() })

    // Calculate next speaker
    const turnInfo = await calculateNextSpeaker(
      repos,
      chatId,
      chat,
      character,
      characterParticipant,
      userParticipantId
    )

    // Send done event
    controller.enqueue(encodeDoneEvent(encoder, {
      messageId: assistantMessageId,
      usage,
      cacheUsage,
      attachmentResults,
      toolsExecuted: toolMessages.length > 0,
      turn: turnInfo,
    }))

    // Trigger memory extraction
    if (chatSettings) {
      const memoryChatSettings: MemoryChatSettings = {
        cheapLLMSettings: chatSettings.cheapLLMSettings,
      }

      await triggerMemoryExtraction(repos, {
        characterId: character.id,
        characterName: character.name,
        personaName: personaData?.name,
        userCharacterId,
        allCharacterNames: isMultiCharacter ? Array.from(participantCharacters.values()).map(c => c.name) : undefined,
        chatId,
        userMessage: isContinueMode ? '[Continue/Nudge - no user message]' : content,
        assistantMessage: cleanedResponse,
        sourceMessageId: assistantMessageId,
        userId,
        connectionProfile,
        chatSettings: memoryChatSettings,
      })

      if (isMultiCharacter) {
        await triggerInterCharacterMemory(repos, {
          character,
          characterParticipantId: characterParticipant.id,
          assistantMessage: cleanedResponse,
          assistantMessageId,
          chatId,
          userId,
          connectionProfile,
          chatSettings: memoryChatSettings,
          existingMessages: existingMessages as MessageEvent[],
          participants: chat.participants,
          participantCharacters,
        })
      }

      // Trigger memory extraction for user-controlled/impersonated characters
      // If the user was typing as a character (not just the persona), that character
      // should form memories about the exchange
      if (!isContinueMode && chat.activeTypingParticipantId) {
        const activeTypingParticipant = chat.participants.find(
          p => p.id === chat.activeTypingParticipantId
        )

        // Check if the active typing participant is a character (not persona)
        // and is different from the responding character
        if (
          activeTypingParticipant &&
          activeTypingParticipant.type === 'CHARACTER' &&
          activeTypingParticipant.characterId &&
          activeTypingParticipant.id !== characterParticipant.id
        ) {
          // Get the character data for the user-controlled character
          const userControlledCharacter = participantCharacters.get(activeTypingParticipant.characterId)
            || await repos.characters.findById(activeTypingParticipant.characterId)

          if (userControlledCharacter) {
            logger.debug('Triggering memory for user-controlled character', {
              userControlledCharacterId: userControlledCharacter.id,
              userControlledCharacterName: userControlledCharacter.name,
              respondingCharacterId: character.id,
              respondingCharacterName: character.name,
            })

            await triggerUserControlledCharacterMemory(repos, {
              userControlledCharacter,
              userControlledParticipantId: activeTypingParticipant.id,
              userTypedMessage: content,
              respondingCharacter: character,
              llmResponse: cleanedResponse,
              llmResponseMessageId: assistantMessageId,
              chatId,
              userId,
              chatSettings: memoryChatSettings,
              allCharacterNames: isMultiCharacter
                ? Array.from(participantCharacters.values()).map(c => c.name)
                : [userControlledCharacter.name, character.name],
            })
          }
        }
      }

      await triggerContextSummaryCheck(repos, {
        chatId,
        provider: connectionProfile.provider,
        modelName: connectionProfile.modelName,
        userId,
        connectionProfile,
        chatSettings: memoryChatSettings,
      })
    }

    // ============================================================================
    // Async Pre-Compression: Trigger compression for next message
    // ============================================================================
    // Start compression asynchronously so it's ready for the next message
    if (compressionEnabled && cheapLLMSelection && builtContext.originalSystemPrompt) {
      // Build updated messages list (including this response)
      const updatedMessages = [
        ...existingMessages
          .filter((m): m is MessageEvent => m.type === 'message' && 'role' in m && 'content' in m)
          .map(m => ({
            role: m.role.toLowerCase() as 'user' | 'assistant' | 'system',
            content: m.content || '',
          })),
        // Add the user message we just sent (if not continue mode)
        ...(content && !isContinueMode ? [{
          role: 'user' as const,
          content,
        }] : []),
        // Add the assistant response we just received
        {
          role: 'assistant' as const,
          content: cleanedResponse,
        },
      ]

      // Trigger async compression (fire and forget)
      triggerAsyncCompression({
        chatId,
        messages: updatedMessages,
        systemPrompt: builtContext.originalSystemPrompt,
        compressionOptions: {
          enabled: contextCompressionSettings.enabled,
          windowSize: contextCompressionSettings.windowSize,
          compressionTargetTokens: contextCompressionSettings.compressionTargetTokens,
          systemPromptTargetTokens: contextCompressionSettings.systemPromptTargetTokens,
          selection: cheapLLMSelection,
          userId,
          characterName: character.name,
          userName: personaData?.name || 'User',
        },
      })
    }
  } else if (toolMessages.length > 0) {
    // Save tool messages even without text response
    const toolSaveResult = await saveToolMessages(
      repos,
      chatId,
      userId,
      toolMessages,
      generatedImagePaths,
      character.id
    )

    await repos.chats.update(chatId, { updatedAt: new Date().toISOString() })

    controller.enqueue(encodeDoneEvent(encoder, {
      messageId: toolSaveResult.firstToolMessageId,
      usage,
      cacheUsage,
      attachmentResults,
      toolsExecuted: true,
    }))
  } else {
    // Empty response - known Gemini issue
    logger.warn(`Empty response for chat ${chatId} - this is a known Gemini API issue`)
    controller.enqueue(encodeDoneEvent(encoder, {
      messageId: null,
      usage,
      cacheUsage,
      attachmentResults,
      toolsExecuted: false,
      emptyResponse: true,
      emptyResponseReason: 'The AI model returned an empty response. This is a known issue with some Gemini models. Please try resending your message.',
    }))
  }

  // Close stream
  try {
    controller.close()
  } catch {
    // Already closed
  }
}

/**
 * Save assistant message to the chat
 */
async function saveAssistantMessage(
  repos: ReturnType<typeof getRepositories>,
  chatId: string,
  character: { id: string; name: string },
  characterParticipant: { id: string },
  content: string,
  usage: { promptTokens?: number; completionTokens?: number; totalTokens?: number } | null,
  rawResponse: unknown,
  thoughtSignature: string | undefined,
  generatedImagePaths: GeneratedImage[],
  toolMessages: ToolMessage[]
): Promise<string> {
  const assistantMessageId = crypto.randomUUID()
  const assistantAttachments = generatedImagePaths.map(img => img.id)

  const assistantMessage = {
    id: assistantMessageId,
    type: 'message' as const,
    role: 'ASSISTANT' as const,
    content,
    createdAt: new Date().toISOString(),
    tokenCount: usage?.totalTokens || null,
    promptTokens: usage?.promptTokens || null,
    completionTokens: usage?.completionTokens || null,
    rawResponse: (rawResponse as Record<string, unknown>) || null,
    attachments: assistantAttachments,
    thoughtSignature: thoughtSignature || null,
    participantId: characterParticipant.id,
  }

  await repos.chats.addMessage(chatId, assistantMessage)

  logger.debug('Assistant message saved', {
    messageId: assistantMessageId,
    participantId: characterParticipant.id,
    characterName: character.name,
  })

  // Save tool messages
  if (toolMessages.length > 0) {
    await saveToolMessages(
      repos,
      chatId,
      '',
      toolMessages,
      generatedImagePaths,
      character.id
    )
  }

  // Link images to assistant message
  for (const imageId of assistantAttachments) {
    try {
      await repos.files.addLink(imageId, assistantMessageId)
    } catch (error) {
      logger.warn('Failed to link image to assistant message', {
        imageId,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return assistantMessageId
}

/**
 * Calculate next speaker for multi-character chats
 */
async function calculateNextSpeaker(
  repos: ReturnType<typeof getRepositories>,
  chatId: string,
  chat: ChatMetadataBase,
  character: Character,
  characterParticipant: { id: string },
  userParticipantId: string | null
): Promise<{
  nextSpeakerId: string | null
  reason: string
  cycleComplete: boolean
  isUsersTurn: boolean
}> {
  const updatedMessages = await repos.chats.getMessages(chatId)
  const messageEvents = updatedMessages.filter(
    (m): m is typeof m & { type: 'message' } => m.type === 'message'
  ) as unknown as MessageEvent[]

  const turnState = calculateTurnStateFromHistory({
    messages: messageEvents,
    participants: chat.participants,
    userParticipantId,
  })

  const activeCharacterParticipants = getActiveCharacterParticipants(chat.participants)
  const charactersMap = new Map<string, Character>()

  for (const p of activeCharacterParticipants) {
    if (p.characterId) {
      const char = p.id === characterParticipant.id
        ? character
        : await repos.characters.findById(p.characterId)
      if (char) {
        charactersMap.set(p.characterId, char)
      }
    }
  }

  const nextSpeakerResult = selectNextSpeaker(
    chat.participants,
    charactersMap,
    turnState,
    userParticipantId
  )

  logger.debug('Next speaker calculated', {
    nextSpeakerId: nextSpeakerResult.nextSpeakerId,
    reason: nextSpeakerResult.reason,
    cycleComplete: nextSpeakerResult.cycleComplete,
    isMultiCharacter: isMultiCharacterChat(chat.participants),
  })

  return {
    nextSpeakerId: nextSpeakerResult.nextSpeakerId,
    reason: nextSpeakerResult.reason,
    cycleComplete: nextSpeakerResult.cycleComplete,
    isUsersTurn: nextSpeakerResult.nextSpeakerId === null,
  }
}

/**
 * Handle stream errors
 */
function handleStreamError(
  error: unknown,
  controller: ReadableStreamDefaultController<Uint8Array>,
  encoder: TextEncoder
): void {
  logger.error('Streaming error', {}, error as Error)

  let errorMessage = 'Unknown error'
  let errorType = 'unknown'

  if (error instanceof z.ZodError) {
    const firstError = error.errors[0]
    errorMessage = firstError
      ? `Validation error: ${firstError.message} at ${firstError.path.join('.')}`
      : 'Response validation failed'
    errorType = 'validation'
    logger.debug('Zod validation error details', { errors: error.errors })
  } else if (error instanceof Error) {
    errorMessage = error.message
    errorType = error.name
  }

  controller.enqueue(encodeErrorEvent(encoder, 'Failed to generate response', errorType, errorMessage))
  controller.close()
}
