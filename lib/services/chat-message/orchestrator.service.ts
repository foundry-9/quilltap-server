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
import { stripCharacterNamePrefix, normalizeContentBlockFormat } from '@/lib/llm/message-formatter'
import { z } from 'zod'

import type { getRepositories } from '@/lib/repositories/factory'
import type { MessageEvent, ConnectionProfile, ChatMetadataBase, Character, ChatSettings } from '@/lib/schemas/types'
import type { SendMessageOptions, ToolMessage, GeneratedImage } from './types'
import type { MemoryChatSettings } from './memory-trigger.service'

import {
  resolveRespondingParticipant,
  loadAllParticipantData,
  getRoleplayTemplate,
} from './participant-resolver.service'
import {
  loadAndProcessFiles,
  buildMessageContext,
} from './context-builder.service'
import type { ProjectContext } from '@/lib/chat/context-manager'
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
  encodeKeepAlive,
  encodeStatusEvent,
  safeEnqueue,
  safeClose,
} from './streaming.service'
import {
  checkShouldUsePseudoTools,
  buildPseudoToolSystemInstructions,
  buildNativeToolSystemInstructions,
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
  type CachedCompressionResponse,
} from './compression-cache.service'
import {
  detectAndConvertRngPatterns,
  type RngToolCall,
} from './rng-pattern-detector.service'
import { executeRngTool, formatRngResults } from '@/lib/tools/handlers/rng-handler'
import {
  resolveAgentModeSetting,
  buildAgentModeInstructions,
  buildForceFinalMessage,
  generateIterationSummary,
  type ResolvedAgentMode,
} from './agent-mode-resolver.service'

const logger = createServiceLogger('ChatMessageOrchestrator')

/**
 * Schema for pending tool results (user-initiated tool calls shown in composer)
 */
const pendingToolResultSchema = z.object({
  tool: z.string(),
  success: z.boolean(),
  result: z.string(),
  prompt: z.string(),
  arguments: z.record(z.string(), z.unknown()),
  createdAt: z.string(),
})

/**
 * Validation schema for send message
 * Content can be empty if there are pending tool results or file attachments
 */
export const sendMessageSchema = z.object({
  content: z.string().default(''),
  fileIds: z.array(z.string()).optional(),
  /** Pending tool results to be saved as TOOL messages before the user message */
  pendingToolResults: z.array(pendingToolResultSchema).optional(),
}).superRefine((data, ctx) => {
  if (data.content.trim().length === 0 &&
      (!data.fileIds || data.fileIds.length === 0) &&
      (!data.pendingToolResults || data.pendingToolResults.length === 0)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Message must have content, attached files, or tool results',
    })
  }
})

/**
 * Validation schema for continue mode (nudge action)
 */
export const continueMessageSchema = z.object({
  continueMode: z.literal(true),
  respondingParticipantId: z.uuid().optional(),
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

  // Get persona data (kept for backward compatibility with legacy participant types)
  let persona: { name: string; description: string } | null = null
  let personaData: { name: string; description: string } | null = null

  // Get user-controlled character ID (for memory aboutCharacterId)
  // This is the character that the user is "playing as" in this chat
  const userControlledParticipant = chat.participants.find(
    p => p.type === 'CHARACTER' && p.controlledBy === 'user' && p.characterId && p.isActive
  )
  const userCharacterId = userControlledParticipant?.characterId || undefined

  // Get chat settings
  const chatSettings = await repos.chatSettings.findByUserId(userId)

  // ============================================================================
  // Agent Mode Resolution
  // ============================================================================

  // Get project for agent mode resolution (also used later for project context)
  const project = chat.projectId ? await repos.projects.findById(chat.projectId) : null

  // Resolve agent mode settings through the cascade
  const agentMode = resolveAgentModeSetting(
    chat,
    project,
    character,
    chatSettings
  )

  // Reset agent turn count on new user message (not continue mode)
  if (!isContinueMode && agentMode.enabled) {
    await repos.chats.update(chatId, { agentTurnCount: 0 })
  }

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
    projectContextReinjectInterval: 5,
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

  if (isMultiCharacter) {
    const participantData = await loadAllParticipantData(
      repos,
      chat,
      character
    )
    participantCharacters = participantData.participantCharacters
  }

  // Get existing messages
  const existingMessages = await repos.chats.getMessages(chatId)

  // ============================================================================
  // Project Context Injection
  // ============================================================================
  // Use project loaded earlier for agent mode resolution
  let projectContext: ProjectContext | null = null

  if (project && (project.description || project.instructions)) {
    // Calculate if we should inject project context this message
    // Default interval matches windowSize (5), can be configured to 0 to disable
    const reinjectInterval = contextCompressionSettings.projectContextReinjectInterval ?? 5
    const messageCount = existingMessages.filter(m => m.type === 'message').length

    // Inject on first message (count 0) or every N messages after that
    // Using messageCount because the new user message hasn't been saved yet
    const shouldInject = reinjectInterval > 0 && (messageCount === 0 || messageCount % reinjectInterval === 0)

    if (shouldInject) {
      projectContext = {
        name: project.name,
        description: project.description,
        instructions: project.instructions,
      }
    }
  }

  // Process file attachments
  const fileProcessing = await loadAndProcessFiles(
    repos,
    chatId,
    userId,
    connectionProfile,
    options.fileIds
  )

  // Save pending tool results as TOOL messages (before user message)
  // Also add them to existingMessages so they're included in context building
  if (!isContinueMode && options.pendingToolResults && options.pendingToolResults.length > 0) {
    for (const toolResult of options.pendingToolResults) {
      const toolMessageId = crypto.randomUUID()
      const toolMessage = {
        id: toolMessageId,
        type: 'message' as const,
        role: 'TOOL' as const,
        content: JSON.stringify({
          tool: toolResult.tool,
          initiatedBy: 'user',
          success: toolResult.success,
          result: toolResult.result,
          prompt: toolResult.prompt,
          arguments: toolResult.arguments,
        }),
        createdAt: toolResult.createdAt,
        attachments: [],
      }
      await repos.chats.addMessage(chatId, toolMessage)
      // Add to existingMessages so it's included in context building
      // (existingMessages was loaded before this save operation)
      existingMessages.push(toolMessage)
    }
  }

  // ============================================================================
  // Auto-Detect RNG Patterns
  // ============================================================================
  // When enabled, detect dice rolls, coin flips, and spin-the-bottle patterns
  // in user messages and automatically execute them as RNG tool calls
  const autoDetectRng = chatSettings?.autoDetectRng ?? true
  if (autoDetectRng && !isContinueMode && options.content) {
    const rngPatterns = detectAndConvertRngPatterns(options.content)
    if (rngPatterns.length > 0) {
      logger.info('Auto-detected RNG patterns in user message', {
        chatId,
        userId,
        patternCount: rngPatterns.length,
        patterns: rngPatterns.map(p => ({ type: p.type, rolls: p.rolls, matchText: p.matchText })),
      })

      // Execute each detected pattern and save as TOOL messages
      for (const pattern of rngPatterns) {
        const rngContext = { userId, chatId }
        const result = await executeRngTool({ type: pattern.type, rolls: pattern.rolls }, rngContext)
        const formattedResult = formatRngResults(result)

        const toolMessageId = crypto.randomUUID()
        const toolMessage = {
          id: toolMessageId,
          type: 'message' as const,
          role: 'TOOL' as const,
          content: JSON.stringify({
            tool: 'rng',
            initiatedBy: 'auto-detect',
            success: result.success,
            result: formattedResult,
            prompt: pattern.matchText,
            arguments: { type: pattern.type, rolls: pattern.rolls },
          }),
          createdAt: new Date().toISOString(),
          attachments: [],
        }

        await repos.chats.addMessage(chatId, toolMessage)
        existingMessages.push(toolMessage)
      }
    }
  }

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

    // Link file attachments
    for (const file of fileProcessing.attachedFiles) {
      await repos.files.addLink(file.id, userMessageId)
    }
  }

  // Build final user message content
  const finalUserMessageContent = isContinueMode
    ? undefined
    : (fileProcessing.messageContentPrefix ? fileProcessing.messageContentPrefix + content : content)

  // ============================================================================
  // Tool Injection
  // ============================================================================
  // Tools are always sent with every LLM prompt to ensure consistent availability

  // Check if tool settings were just changed (for notification message)
  const toolSettingsChanged = chat.forceToolsOnNextMessage === true

  // Clear forceToolsOnNextMessage flag if it was set
  if (toolSettingsChanged) {
    await repos.chats.update(chatId, { forceToolsOnNextMessage: false })
  }

  // Check for pseudo-tools
  const enabledToolOptions = determineEnabledToolOptions(
    imageProfileId,
    connectionProfile.allowWebSearch
  )

  // Build tools (include request_full_context when compression is enabled, submit_final_response when agent mode is enabled)
  // Always pass disabledTools and disabledToolGroups for filtering
  const { tools, modelSupportsNativeTools, useNativeWebSearch } = await buildTools(
    connectionProfile,
    imageProfileId,
    imageProfile,
    userId,
    false, // Will check pseudo-tools after
    chat.projectId ?? undefined, // projectId - enables project_info tool
    compressionEnabled, // requestFullContext - enable the tool when compression is active
    chat.disabledTools ?? [],
    chat.disabledToolGroups ?? [],
    agentMode.enabled // agentModeEnabled - enables submit_final_response tool
  )

  const usePseudoTools = checkShouldUsePseudoTools(modelSupportsNativeTools)
  const actualTools = usePseudoTools ? [] : tools

  // Build tool instructions (pseudo-tool instructions or native tool rules)
  let toolInstructions: string | undefined
  if (usePseudoTools) {
    toolInstructions = buildPseudoToolSystemInstructions(enabledToolOptions)
    logPseudoToolUsage(connectionProfile.provider, connectionProfile.modelName, enabledToolOptions)
  } else if (actualTools.length > 0) {
    toolInstructions = buildNativeToolSystemInstructions()
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
  let cachedCompressionResponse: CachedCompressionResponse | undefined = undefined
  if (compressionEnabled && !bypassCompression) {
    // Send status update for compression check
    safeEnqueue(controller, encodeStatusEvent(encoder, {
      stage: 'compressing',
      message: 'Checking context cache...',
      characterName: character.name,
      characterId: character.id,
    }))

    // Try to get cached compression from previous async pre-computation
    // This returns immediately without waiting for in-flight compression,
    // falling back to previous cache if async isn't ready yet
    // IMPORTANT: Use filtered message count (only type === 'message') to match
    // how messages are counted when persisting the cache
    const actualMessageCount = existingMessages.filter(m => m.type === 'message').length
    cachedCompressionResponse = await getCachedCompression(chatId, actualMessageCount)
    if (cachedCompressionResponse) {
      logger.info('Using cached compression from async pre-computation', {
        chatId,
        messageCount: actualMessageCount,
        cachedMessageCount: cachedCompressionResponse.cachedMessageCount,
        isFallback: cachedCompressionResponse.isFallback,
        savings: cachedCompressionResponse.result.compressionDetails?.totalSavings,
      })
    }
  } else if (bypassCompression) {
    // Invalidate cache when bypass is requested
    invalidateCompressionCache(chatId)
  }

  // Start keep-alive pings during context building (especially important during compression)
  // This prevents proxy/load balancer timeouts during long compression operations
  let keepAliveInterval: ReturnType<typeof setInterval> | null = null
  if (compressionEnabled && !cachedCompressionResponse) {

    keepAliveInterval = setInterval(() => {
      if (!safeEnqueue(controller, encodeKeepAlive(encoder))) {
        // Stream closed, stop the interval
        if (keepAliveInterval) {
          clearInterval(keepAliveInterval)
          keepAliveInterval = null
        }
      }
    }, 15000) // Send ping every 15 seconds
  }

  // Send status update for context gathering
  safeEnqueue(controller, encodeStatusEvent(encoder, {
    stage: 'gathering',
    message: 'Gathering memories and context...',
    characterName: character.name,
    characterId: character.id,
  }))

  const { builtContext, formattedMessages, isInitialMessage } = await buildMessageContext(
    {
      repos,
      userId,
      chat,
      character,
      characterParticipant,
      connectionProfile,
      persona,
      isMultiCharacter,
      participantCharacters,
      roleplayTemplate,
      chatSettings: contextChatSettings,
      toolInstructions,
      newUserMessage: finalUserMessageContent,
      isContinueMode,
      // Project context (injected at configured interval)
      projectContext,
      // Context compression options
      contextCompressionSettings: compressionEnabled ? contextCompressionSettings : null,
      cheapLLMSelection,
      bypassCompression,
      // Pass cached compression result and message count for dynamic window calculation
      cachedCompressionResult: cachedCompressionResponse?.result,
      cachedCompressionMessageCount: cachedCompressionResponse?.cachedMessageCount,
    },
    existingMessages,
    fileProcessing.attachmentsToSend
  )

  // Stop keep-alive pings after context building completes
  if (keepAliveInterval) {
    clearInterval(keepAliveInterval)
    keepAliveInterval = null

  }

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

  // ============================================================================
  // Tool Change Notification
  // ============================================================================
  // If tool settings were changed, inject a system message to inform the LLM
  // This only happens when the user explicitly changed settings, not on first message or interval
  if (toolSettingsChanged) {
    // Extract tool names from the tools array
    const toolNames = actualTools.map((tool: unknown) => {
      const toolObj = tool as { function?: { name?: string }; name?: string }
      return toolObj.function?.name || toolObj.name || 'unknown'
    }).filter(name => name !== 'unknown')

    let toolChangeContent: string
    if (toolNames.length === 0) {
      toolChangeContent = '[System Notice] Your available tools have been updated. All tools have been disabled for this chat. Do not attempt to use any tools.'
    } else {
      toolChangeContent = `[System Notice] Your available tools have been updated. You now have access to the following ${toolNames.length} tool(s): ${toolNames.join(', ')}. Tools not listed are no longer available for this chat.`
    }

    const toolChangeMessage = {
      role: 'system',
      content: toolChangeContent,
      attachments: [],
    }

    // Insert before the last message (which should be the user's new message)
    const lastUserMessageIndex = formattedMessages.findIndex(
      (m, i, arr) => m.role === 'user' && i === arr.length - 1
    )
    if (lastUserMessageIndex > 0) {
      formattedMessages.splice(lastUserMessageIndex, 0, toolChangeMessage)
    } else {
      // Fallback: just add it near the end
      formattedMessages.push(toolChangeMessage)
    }

    logger.info('Injected tool change notification', {
      chatId,
      toolCount: toolNames.length,
      tools: toolNames,
    })
  }

  // ============================================================================
  // Agent Mode Instructions
  // ============================================================================
  // If agent mode is enabled, inject instructions into the system prompt
  if (agentMode.enabled) {
    const agentModeInstructions = buildAgentModeInstructions(agentMode.maxTurns)
    const agentModeMessage = {
      role: 'system',
      content: agentModeInstructions,
      attachments: [],
    }

    // Insert agent mode instructions at the beginning (after any existing system messages)
    // Find the first non-system message and insert before it
    const firstNonSystemIndex = formattedMessages.findIndex(m => m.role !== 'system')
    if (firstNonSystemIndex > 0) {
      formattedMessages.splice(firstNonSystemIndex, 0, agentModeMessage)
    } else if (firstNonSystemIndex === 0) {
      formattedMessages.unshift(agentModeMessage)
    } else {
      // All messages are system messages - add at end
      formattedMessages.push(agentModeMessage)
    }

    logger.info('Injected agent mode instructions', {
      chatId,
      maxTurns: agentMode.maxTurns,
      enabledSource: agentMode.enabledSource,
    })
  }

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

  // Pre-generate assistant message ID so logs can reference it
  const preGeneratedAssistantMessageId = crypto.randomUUID()

  // Send status update for sending to LLM
  safeEnqueue(controller, encodeStatusEvent(encoder, {
    stage: 'sending',
    message: `Sending to ${character.name}...`,
    characterName: character.name,
    characterId: character.id,
  }))

  // Track if streaming has started for status update
  let hasStartedStreaming = false

  try {
    for await (const chunk of streamMessage({
      messages: formattedMessages,
      connectionProfile,
      apiKey,
      modelParams,
      tools: actualTools,
      useNativeWebSearch,
      userId,
      messageId: preGeneratedAssistantMessageId,
      chatId,
    })) {
      if (chunk.content) {
        // Send streaming status on first content
        if (!hasStartedStreaming) {
          safeEnqueue(controller, encodeStatusEvent(encoder, {
            stage: 'streaming',
            message: `${character.name} is responding...`,
            characterName: character.name,
            characterId: character.id,
          }))
          hasStartedStreaming = true
        }
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
        safeClose(controller)
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
  // Use agent mode max turns if enabled, otherwise default to 5
  const effectiveMaxTurns = agentMode.enabled ? agentMode.maxTurns : 5
  let toolIterations = 0
  let agentModeCompleted = false
  let agentFinalResponse: string | undefined

  // Tool call loop
  while (currentRawResponse && toolIterations < effectiveMaxTurns) {
    const toolCalls = detectToolCallsInResponse(currentRawResponse, connectionProfile.provider)

    if (toolCalls.length === 0) break

    // Check if this is the submit_final_response tool in agent mode
    const submitFinalCall = agentMode.enabled
      ? toolCalls.find(tc => tc.name === 'submit_final_response')
      : undefined

    if (submitFinalCall) {
      // Agent mode completion - extract final response
      const args = submitFinalCall.arguments as { response?: string; summary?: string; confidence?: number }
      agentFinalResponse = args.response || currentResponse
      agentModeCompleted = true

      // Send agent completion event
      safeEnqueue(controller, encodeStatusEvent(encoder, {
        stage: 'agent_completed',
        message: 'Agent completed task',
        characterName: character.name,
        characterId: character.id,
      }))

      logger.info('Agent mode completed via submit_final_response', {
        chatId,
        iterations: toolIterations,
        responseLength: agentFinalResponse?.length,
        summary: args.summary,
        confidence: args.confidence,
      })

      // Use the final response as the full response
      fullResponse = agentFinalResponse
      break
    }

    toolIterations++

    // Send agent iteration event if in agent mode
    if (agentMode.enabled) {
      const toolNames = toolCalls.map(tc => tc.name)
      const iterationSummary = generateIterationSummary(toolIterations, toolNames, currentResponse)

      safeEnqueue(controller, encodeStatusEvent(encoder, {
        stage: 'agent_iteration',
        message: iterationSummary,
        characterName: character.name,
        characterId: character.id,
      }))

      // Update agent turn count in database
      await repos.chats.update(chatId, { agentTurnCount: toolIterations })
    }

    // Send tool executing status for each detected tool
    for (const toolCall of toolCalls) {
      safeEnqueue(controller, encodeStatusEvent(encoder, {
        stage: 'tool_executing',
        message: `Running ${toolCall.name}...`,
        toolName: toolCall.name,
        characterName: character.name,
        characterId: character.id,
      }))
    }

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
      userId,
      messageId: preGeneratedAssistantMessageId,
      chatId,
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

  // Handle max iterations reached
  if (toolIterations >= effectiveMaxTurns && !agentModeCompleted) {
    if (agentMode.enabled) {
      // Force final response in agent mode
      logger.info('Agent mode max turns reached, forcing final response', {
        chatId,
        iterations: toolIterations,
        maxTurns: effectiveMaxTurns,
      })

      // Send force final event
      safeEnqueue(controller, encodeStatusEvent(encoder, {
        stage: 'agent_force_final',
        message: 'Requesting final response...',
        characterName: character.name,
        characterId: character.id,
      }))

      // Add force final message and make one more LLM call
      const forceFinalMessage = buildForceFinalMessage()
      currentMessages = [
        ...currentMessages,
        { role: 'assistant' as const, content: currentResponse, thoughtSignature, name: undefined },
        { role: 'user' as const, content: forceFinalMessage, thoughtSignature: undefined, name: undefined }
      ]

      // Make one final call with force message
      for await (const chunk of streamMessage({
        messages: currentMessages,
        connectionProfile,
        apiKey,
        modelParams,
        tools: actualTools,
        useNativeWebSearch,
        userId,
        messageId: preGeneratedAssistantMessageId,
        chatId,
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
          }

          // Check if the final call includes submit_final_response
          if (chunk.rawResponse) {
            const finalToolCalls = detectToolCallsInResponse(chunk.rawResponse, connectionProfile.provider)
            const submitCall = finalToolCalls.find(tc => tc.name === 'submit_final_response')
            if (submitCall) {
              const args = submitCall.arguments as { response?: string }
              if (args.response) {
                fullResponse = args.response
              }
            }
          }
        }
      }
    } else {
      logger.warn('Max tool iterations reached', { iterations: toolIterations, chatId })
    }
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

      // Send tool executing status for each detected tool
      for (const toolCall of xmlToolCallRequests) {
        safeEnqueue(controller, encodeStatusEvent(encoder, {
          stage: 'tool_executing',
          message: `Running ${toolCall.name}...`,
          toolName: toolCall.name,
          characterName: character.name,
          characterId: character.id,
        }))
      }

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
        userId,
        messageId: preGeneratedAssistantMessageId,
        chatId,
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
      // Send tool executing status for each detected tool
      for (const toolCall of pseudoToolCalls) {
        safeEnqueue(controller, encodeStatusEvent(encoder, {
          stage: 'tool_executing',
          message: `Running ${toolCall.name}...`,
          toolName: toolCall.name,
          characterName: character.name,
          characterId: character.id,
        }))
      }

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
        userId,
        messageId: preGeneratedAssistantMessageId,
        chatId,
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
    // Normalize content that may be wrapped in content block format
    // e.g., [{'type': 'text', 'text': "actual content"}]
    const normalizedResponse = normalizeContentBlockFormat(fullResponse)

    // Strip any character name prefixes that the LLM might have echoed back
    // This handles cases where LLMs mimic the [Name] prefix format from the input
    const cleanedResponse = stripCharacterNamePrefix(normalizedResponse, character.name)

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
      toolMessages,
      preGeneratedAssistantMessageId
    )

    // ============================================================================
    // Async Pre-Compression: Start EARLY for next message
    // ============================================================================
    // Trigger compression as soon as we have the response, BEFORE memory extraction
    // and other async work. This gives maximum time for compression to complete
    // before the user sends their next message.
    if (compressionEnabled && cheapLLMSelection && builtContext.originalSystemPrompt) {
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

      // Fire and forget - compression runs in background
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
          userName: 'User',
        },
      })
    }

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

    // ============================================================================
    // Auto-Detect RNG Patterns in Assistant Response
    // ============================================================================
    // When enabled, detect dice rolls, coin flips, and spin-the-bottle patterns
    // in assistant messages and automatically execute them as RNG tool calls
    const autoDetectRngInResponse = chatSettings?.autoDetectRng ?? true
    if (autoDetectRngInResponse && cleanedResponse) {
      const rngPatternsInResponse = detectAndConvertRngPatterns(cleanedResponse)
      if (rngPatternsInResponse.length > 0) {
        logger.info('Auto-detected RNG patterns in assistant response', {
          chatId,
          userId,
          patternCount: rngPatternsInResponse.length,
          patterns: rngPatternsInResponse.map(p => ({ type: p.type, rolls: p.rolls, matchText: p.matchText })),
        })

        // Execute each detected pattern and save as TOOL messages after the assistant message
        for (const pattern of rngPatternsInResponse) {
          const rngContext = { userId, chatId }
          const result = await executeRngTool({ type: pattern.type, rolls: pattern.rolls }, rngContext)
          const formattedResult = formatRngResults(result)

          const toolMessageId = crypto.randomUUID()
          const toolMessage = {
            id: toolMessageId,
            type: 'message' as const,
            role: 'TOOL' as const,
            content: JSON.stringify({
              tool: 'rng',
              initiatedBy: 'auto-detect-response',
              success: result.success,
              result: formattedResult,
              prompt: pattern.matchText,
              arguments: { type: pattern.type, rolls: pattern.rolls },
            }),
            createdAt: new Date().toISOString(),
            attachments: [],
          }

          await repos.chats.addMessage(chatId, toolMessage)

          // Add to toolMessages array so done event reflects the execution
          toolMessages.push({
            toolName: 'rng',
            content: formattedResult,
            success: result.success,
            arguments: { type: pattern.type, rolls: pattern.rolls },
          })
        }
      }
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

      // Note: personaName is undefined since we only support CHARACTER type participants now
      await triggerMemoryExtraction(repos, {
        characterId: character.id,
        characterName: character.name,
        personaName: undefined,
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
  safeClose(controller)
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
  toolMessages: ToolMessage[],
  preGeneratedMessageId?: string
): Promise<string> {
  const assistantMessageId = preGeneratedMessageId || crypto.randomUUID()
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
    const firstError = error.issues[0]
    errorMessage = firstError
      ? `Validation error: ${firstError.message} at ${firstError.path.join('.')}`
      : 'Response validation failed'
    errorType = 'validation'

  } else if (error instanceof Error) {
    errorMessage = error.message
    errorType = error.name
  }

  // Use safe methods to prevent crash if stream is already closed
  safeEnqueue(controller, encodeErrorEvent(encoder, 'Failed to generate response', errorType, errorMessage))
  safeClose(controller)
}
