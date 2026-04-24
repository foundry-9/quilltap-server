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
  isMultiCharacterChat,
} from '@/lib/chat/turn-manager'
import { z } from 'zod'

import type { getRepositories } from '@/lib/repositories/factory'
import type { MessageEvent, ConnectionProfile, ChatMetadataBase, Character, ChatSettings } from '@/lib/schemas/types'

import type { SendMessageOptions, ToolMessage, GeneratedImage, ProcessMessageResult, StreamingState, ToolProcessingResult } from './types'

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
  buildNativeToolSystemInstructions,
  determineEnabledToolOptions,
  checkShouldUseTextBlockTools,
  buildTextBlockSystemInstructions,
  parseTextBlocksFromResponse,
  stripTextBlockMarkersFromResponse,
  determineTextBlockToolOptions,
  logTextBlockToolUsage,
} from './pseudo-tool.service'
import {
  hasTextBlockMarkers,
} from '@/lib/tools'
import { getProvider } from '@/lib/plugins/provider-registry'
import {
  triggerSceneStateTracking,
  triggerConversationRender,
} from './memory-trigger.service'
import { isRecoverableRequestError, isToolUnsupportedError } from '@/lib/llm/errors'
import { countMessagesTokens } from '@/lib/tokens/token-counter'
import { attemptRequestLimitRecovery } from './recovery.service'
import { getCheapLLMProvider, DEFAULT_CHEAP_LLM_CONFIG, resolveUncensoredCheapLLMSelection } from '@/lib/llm/cheap-llm'
import { extractMemorySearchKeywords, stripToolArtifacts, extractVisibleConversation } from '@/lib/memory/cheap-llm-tasks'
import { searchMemoriesSemantic, type SemanticSearchResult } from '@/lib/memory/memory-service'
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
  finalizeMessageResponse,
  saveAssistantMessage,
} from './message-finalizer.service'
import { stripCharacterNamePrefix, normalizeContentBlockFormat } from '@/lib/llm/message-formatter'
import {
  resolveAgentModeSetting,
  buildAgentModeInstructions,
  buildForceFinalMessage,
  generateIterationSummary,
  type ResolvedAgentMode,
} from './agent-mode-resolver.service'
import { resolveUserIdentity } from './user-identity-resolver.service'
import {
  executeTurnChain,
} from './turn-orchestrator.service'
import { resolveMessageDangerState } from './danger-orchestrator.service'
import {
  attemptEmptyResponseRecovery,
  getEmptyResponseReason,
} from './provider-failover.service'
import type { DangerFlag } from '@/lib/schemas/chat.types'

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
  /** Target participant IDs for whisper messages */
  targetParticipantIds: z.array(z.string()).nullable().optional(),
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
        const result = await processMessage(repos, chatId, userId, options, controller, encoder)

        await executeTurnChain({
          repos,
          chatId,
          userId,
          initialResult: result,
          initialContinueMode: options.continueMode === true,
          controller,
          encoder,
          processChainedMessage: (chainOptions) => processMessage(
            repos,
            chatId,
            userId,
            chainOptions,
            controller,
            encoder
          ),
        })

        // Trigger scene state tracking once after processing (and after any turn chain)
        if (result.hasContent && result.sceneTrackingContext) {
          try {
            await triggerSceneStateTracking(repos, {
              chatId,
              userId,
              connectionProfile: result.sceneTrackingContext.connectionProfile,
              chatSettings: result.sceneTrackingContext.memoryChatSettings,
              characterIds: result.sceneTrackingContext.characterIds,
            })
          } catch (error) {
            logger.warn('Failed to trigger scene state tracking', {
              chatId,
              error: error instanceof Error ? error.message : String(error),
            })
          }
        }

        // Trigger conversation render (Scriptorium) - runs on every turn with content
        if (result.hasContent) {
          try {
            await triggerConversationRender(repos, { chatId, userId })
          } catch (error) {
            logger.warn('Failed to trigger conversation render', {
              chatId,
              error: error instanceof Error ? error.message : String(error),
            })
          }
        }

        safeClose(controller)
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
): Promise<ProcessMessageResult> {
  const isContinueMode = options.continueMode === true

  // Initial status — user sees this immediately after sending
  safeEnqueue(controller, encodeStatusEvent(encoder, {
    stage: 'initializing',
    message: 'Loading chat...',
  }))

  // Get chat metadata
  const chat = await repos.chats.findById(chatId)
  if (!chat) {
    throw new Error('Chat not found')
  }

  // Resolve responding participant
  // For whisper messages, the target participant should respond (not the default first character)
  const respondingId = options.respondingParticipantId
    || (options.targetParticipantIds?.length ? options.targetParticipantIds[0] : undefined)

  const participantResult = await resolveRespondingParticipant(
    repos,
    chat,
    userId,
    respondingId,
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

  // Now that we know who's responding, update status with character name
  safeEnqueue(controller, encodeStatusEvent(encoder, {
    stage: 'resolving',
    message: `Setting up ${character.name}...`,
    characterName: character.name,
    characterId: character.id,
  }))

  // Validate API key for providers that require it
  let apiKey = ''
  if (requiresApiKey(connectionProfile.provider)) {
    if (!rawApiKey) {
      throw new Error('No API key configured for this connection profile')
    }
    apiKey = rawApiKey
  }

  // Resolve user identity through fallback chain:
  // 1. User-controlled character in chat → 2. Sole user-controlled character → 3. User profile → 4. "User"
  const resolvedIdentity = await resolveUserIdentity(repos, userId, chat)
  const userCharacter: { name: string; description: string } | null = {
    name: resolvedIdentity.name,
    description: resolvedIdentity.description,
  }


  // User-controlled character ID for memory aboutCharacterId
  const userCharacterId = resolvedIdentity.characterId || undefined

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

  // Get cheap LLM selection (used for compression, danger classification, and proactive memory recall)
  let cheapLLMSelection = null
  let allProfiles: ConnectionProfile[] = []
  try {
    // Get all connection profiles for cheap LLM selection
    allProfiles = await repos.connections.findByUserId(userId)
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
    logger.warn('Failed to get cheap LLM provider, features requiring it will be skipped', {
      error: error instanceof Error ? error.message : String(error),
    })
  }

  // Determine if compression is actually enabled for this request
  const compressionEnabled = !!(contextCompressionSettings.enabled && cheapLLMSelection && !bypassCompression)

  // ============================================================================
  // Dangerous Content Classification & Routing
  // ============================================================================

  const dangerState = await resolveMessageDangerState({
    repos,
    chatId,
    userId,
    chat,
    chatSettings,
    character,
    isContinueMode,
    content: options.content,
    cheapLLMSelection,
    connectionProfile,
    apiKey,
    controller,
    encoder,
  })

  let dangerFlags: DangerFlag[] | undefined = dangerState.dangerFlags
  const dangerSettings = dangerState.dangerSettings

  // Mutable streaming state — threaded through failover and finalization by reference
  const streamingState: StreamingState = {
    fullResponse: '',
    effectiveProfile: dangerState.effectiveProfile,
    effectiveApiKey: dangerState.effectiveApiKey,
    usage: null,
    cacheUsage: null,
    attachmentResults: null,
    rawResponse: null,
    thoughtSignature: undefined,
    hasStartedStreaming: false,
  }

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

  // Status: processing files
  if (options.fileIds && options.fileIds.length > 0) {
    safeEnqueue(controller, encodeStatusEvent(encoder, {
      stage: 'processing_files',
      message: 'Processing attachments...',
      characterName: character.name,
      characterId: character.id,
    }))
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
      targetParticipantIds: options.targetParticipantIds || null,
    }

    await repos.chats.addMessage(chatId, userMessage)

    // Link file attachments
    for (const file of fileProcessing.attachedFiles) {
      await repos.files.addLink(file.id, userMessageId)
    }

    // Attach dangerFlags to the saved user message
    if (dangerFlags && dangerFlags.length > 0) {
      try {
        await repos.chats.updateMessage(chatId, userMessageId, { dangerFlags })
      } catch (updateError) {
        logger.warn('[DangerousContent] Failed to attach dangerFlags to user message', {
          chatId,
          messageId: userMessageId,
          error: updateError instanceof Error ? updateError.message : String(updateError),
        })
      }
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
  safeEnqueue(controller, encodeStatusEvent(encoder, {
    stage: 'loading_tools',
    message: `Loading tools for ${character.name}...`,
    characterName: character.name,
    characterId: character.id,
  }))

  // Check if tool settings were just changed (for notification message)
  const toolSettingsChanged = chat.forceToolsOnNextMessage === true

  // Clear forceToolsOnNextMessage flag if it was set
  if (toolSettingsChanged) {
    await repos.chats.update(chatId, { forceToolsOnNextMessage: false })
  }

  // Check for pending outfit change notifications (visible to ALL characters in the chat)
  // These are set when a user manually changes a character's outfit via the sidebar
  let outfitChangeNotifications: string[] = []
  const pendingOutfitNotifications = chat.pendingOutfitNotifications as Record<string, string> | null
  if (pendingOutfitNotifications && Object.keys(pendingOutfitNotifications).length > 0) {
    outfitChangeNotifications = Object.values(pendingOutfitNotifications)
    logger.info('[Orchestrator] Delivering pending outfit change notifications', {
      context: 'wardrobe',
      chatId,
      characterId: character?.id,
      notificationCount: outfitChangeNotifications.length,
      notifications: outfitChangeNotifications,
    })
    // Clear all pending notifications — every character sees them on next turn
    await repos.chats.update(chatId, { pendingOutfitNotifications: null })
  }

  // Check tool options
  const enabledToolOptions = determineEnabledToolOptions(
    imageProfileId,
    streamingState.effectiveProfile.allowWebSearch
  )

  // Resolve help tools enabled from character (default: disabled)
  const helpToolsEnabled = character?.defaultHelpToolsEnabled === true

  // Resolve wardrobe capability flags from character (default: enabled when null)
  const canDressThemselves = character?.canDressThemselves !== false
  const canCreateOutfits = character?.canCreateOutfits !== false

  // Determine if document editing tools should be enabled (Scriptorium Phase 3.3)
  // Enabled when the project has linked document stores
  let documentEditingEnabled = false
  if (chat.projectId) {
    try {
      const mountLinks = await repos.projectDocMountLinks.findByProjectId(chat.projectId)
      documentEditingEnabled = mountLinks.length > 0
    } catch (mountLinkError) {
      logger.debug('[Orchestrator] Failed to check mount point links for doc editing tools', {
        projectId: chat.projectId,
        error: mountLinkError instanceof Error ? mountLinkError.message : String(mountLinkError),
      })
    }
  }

  // Build tools (include request_full_context when compression is enabled, submit_final_response when agent mode is enabled)
  // Always pass disabledTools and disabledToolGroups for filtering
  const { tools, modelSupportsNativeTools, useNativeWebSearch } = await buildTools(
    streamingState.effectiveProfile,
    imageProfileId,
    imageProfile,
    userId,
    chat.projectId ?? undefined, // projectId - enables project_info tool
    compressionEnabled, // requestFullContext - enable the tool when compression is active
    chat.disabledTools ?? [],
    chat.disabledToolGroups ?? [],
    agentMode.enabled, // agentModeEnabled - enables submit_final_response tool
    isMultiCharacter, // isMultiCharacter - enables whisper tool
    helpToolsEnabled, // helpToolsEnabled - enables help_search and help_settings tools
    canDressThemselves, // canDressThemselves - enables list_wardrobe and update_outfit_item
    canCreateOutfits, // canCreateOutfits - enables create_wardrobe_item
    documentEditingEnabled // documentEditingEnabled - enables doc_* editing tools
  )

  const useTextBlockTools = checkShouldUseTextBlockTools(modelSupportsNativeTools)
  const actualTools = useTextBlockTools ? [] : tools

  // Build tool instructions (text-block or native tool rules)
  let toolInstructions: string | undefined
  if (useTextBlockTools) {
    const textBlockOptions = determineTextBlockToolOptions(
      imageProfileId,
      streamingState.effectiveProfile.allowWebSearch,
      isMultiCharacter,
      !!chat.projectId,
      helpToolsEnabled,
      canDressThemselves,
      canCreateOutfits
    )
    toolInstructions = buildTextBlockSystemInstructions(textBlockOptions)
    logTextBlockToolUsage(streamingState.effectiveProfile.provider, streamingState.effectiveProfile.modelName, textBlockOptions)
  } else if (actualTools.length > 0) {
    toolInstructions = buildNativeToolSystemInstructions()
  }

  // Build message context
  const modelParams = streamingState.effectiveProfile.parameters as Record<string, unknown>
  const contextChatSettings = chatSettings ? {
    cheapLLMSettings: chatSettings.cheapLLMSettings ? {} : undefined,
    defaultTimestampConfig: chatSettings.defaultTimestampConfig,
  } : null

  // ============================================================================
  // Async Pre-Compression + Proactive Memory Recall (run in parallel)
  // ============================================================================

  // Compression check task
  const compressionTask = async (): Promise<CachedCompressionResponse | undefined> => {
    if (compressionEnabled && !bypassCompression) {
      safeEnqueue(controller, encodeStatusEvent(encoder, {
        stage: 'compressing',
        message: 'Checking context cache...',
        characterName: character.name,
        characterId: character.id,
      }))

      // Count only visible USER/ASSISTANT messages to match what triggerAsyncCompression
      // uses (via extractVisibleConversation). Using a broader filter (type === 'message')
      // inflates the count and causes the dynamic window to grow excessively.
      const visibleMessages = extractVisibleConversation(existingMessages)
      const actualMessageCount = visibleMessages.length
      const participantIdForCache = isMultiCharacter ? characterParticipant.id : undefined
      const result = await getCachedCompression(chatId, actualMessageCount, participantIdForCache)
      if (result) {
        logger.info('Using cached compression from async pre-computation', {
          chatId,
          messageCount: actualMessageCount,
          cachedMessageCount: result.cachedMessageCount,
          isFallback: result.isFallback,
          savings: result.result.compressionDetails?.totalSavings,
        })
      }
      return result
    } else if (bypassCompression) {
      invalidateCompressionCache(chatId)
    }
    return undefined
  }

  // Proactive memory recall task
  const proactiveRecallTask = async (): Promise<SemanticSearchResult[] | undefined> => {
    if (!cheapLLMSelection || !character.id) return undefined

    // Filter to actual message events with proper type narrowing
    const messageEvents = existingMessages
      .filter((m): m is MessageEvent => m.type === 'message' && 'role' in m && 'content' in m)

    // Find messages since this character last spoke
    const characterMessages = messageEvents.filter(
      m => m.role === 'ASSISTANT' && m.participantId === characterParticipant.id
    )

    if (characterMessages.length === 0) {
      return undefined
    }

    // Character has spoken before - find all messages after the last one
    const lastCharacterMessage = characterMessages[characterMessages.length - 1]
    const lastCharacterMessageIndex = messageEvents.lastIndexOf(lastCharacterMessage)
    const messagesSinceLastSpoke = messageEvents
      .slice(lastCharacterMessageIndex + 1)
      .filter(m => m.role === 'USER' || m.role === 'ASSISTANT')

    // Include the new user message that was just saved but isn't in the existingMessages snapshot
    if (!isContinueMode && content) {
      messagesSinceLastSpoke.push({
        role: 'USER',
        content,
      } as MessageEvent)
    }

    if (messagesSinceLastSpoke.length === 0) {
      return undefined
    }

    // Status: analyzing conversation for keywords
    safeEnqueue(controller, encodeStatusEvent(encoder, {
      stage: 'recalling_keywords',
      message: 'Analyzing recent conversation...',
      characterName: character.name,
      characterId: character.id,
    }))

    // For dangerous chats, use uncensored provider for keyword extraction
    let recallSelection = cheapLLMSelection
    if (chat.isDangerousChat) {
      recallSelection = resolveUncensoredCheapLLMSelection(
        cheapLLMSelection,
        true,
        dangerSettings,
        allProfiles
      )
      if (recallSelection !== cheapLLMSelection) {
        logger.debug('[ProactiveRecall] Using uncensored provider for memory keyword extraction', {
          chatId,
          originalProvider: cheapLLMSelection.provider,
          uncensoredProvider: recallSelection.provider,
        })
      }
    }

    // Extract keywords via cheap LLM, stripping tool artifacts from assistant messages
    const keywordResult = await extractMemorySearchKeywords(
      messagesSinceLastSpoke.reduce<Array<{ role: 'user' | 'assistant' | 'system'; content: string }>>((acc, m) => {
        const role = m.role.toLowerCase() as 'user' | 'assistant' | 'system'
        if (role === 'assistant') {
          const cleaned = stripToolArtifacts(m.content || '')
          if (cleaned) acc.push({ role, content: cleaned })
        } else {
          acc.push({ role, content: m.content || '' })
        }
        return acc
      }, []),
      character.name,
      recallSelection,
      userId,
      chatId
    )

    if (!keywordResult.success || !keywordResult.result || keywordResult.result.length === 0) {
      return undefined
    }

    // Status: searching memories
    safeEnqueue(controller, encodeStatusEvent(encoder, {
      stage: 'recalling_memories',
      message: `Searching ${character.name}'s memories...`,
      characterName: character.name,
      characterId: character.id,
    }))

    // Search memories using extracted keywords
    const searchQuery = keywordResult.result.join(' ')
    try {
      const memoryResults = await searchMemoriesSemantic(
        character.id,
        searchQuery,
        {
          userId,
          limit: 20,
          minImportance: 0.3,
        }
      )

      if (memoryResults.length > 0) {
        const results = memoryResults.slice(0, 10)
        return results
      }
    } catch (error) {
      logger.warn('Proactive memory recall: memory search failed, falling back to default', {
        chatId,
        characterId: character.id,
        error: error instanceof Error ? error.message : String(error),
      })
    }

    return undefined
  }

  // Run compression check and proactive recall in parallel
  const tParallelStart = performance.now()
  const [cachedCompressionResponse, preSearchedMemories] = await Promise.all([
    compressionTask(),
    proactiveRecallTask(),
  ])
  const tParallelEnd = performance.now()
  logger.debug('[Orchestrator] Parallel compression + proactive recall complete', {
    chatId,
    durationMs: Math.round(tParallelEnd - tParallelStart),
    hadCachedCompression: !!cachedCompressionResponse,
    preSearchedMemoriesCount: preSearchedMemories?.length ?? 0,
  })

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

  const tBuildContextStart = performance.now()
  const { builtContext, formattedMessages, isInitialMessage } = await buildMessageContext(
    {
      repos,
      userId,
      chat,
      character,
      characterParticipant,
      connectionProfile: streamingState.effectiveProfile,
      userCharacter,
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
      // Proactive memory recall results
      preSearchedMemories,
      // Memory recap: uncensored fallback for dangerous chats
      uncensoredFallbackOptions: (chat.isDangerousChat && dangerSettings && cheapLLMSelection)
        ? { dangerSettings, availableProfiles: allProfiles, isDangerousChat: true }
        : undefined,
      // Extract status change notifications from recent system events
      statusChangeNotifications: isMultiCharacter
        ? existingMessages
            .filter(m => m.type === 'system' && (m as Record<string, unknown>).systemEventType === 'STATUS_CHANGE')
            .map(m => (m as Record<string, unknown>).description as string)
            .filter(Boolean)
        : undefined,
      // Outfit change notifications (separate from status changes for prominence)
      outfitChangeNotifications: outfitChangeNotifications.length > 0
        ? outfitChangeNotifications
        : undefined,
      // Status callback for budget-driven compression phases
      onStatusChange: (stage: string, message: string) => {
        safeEnqueue(controller, encodeStatusEvent(encoder, {
          stage,
          message,
          characterName: character.name,
          characterId: character.id,
        }))
      },
    },
    existingMessages,
    fileProcessing.attachmentsToSend
  )
  const tBuildContextEnd = performance.now()
  logger.debug('[Orchestrator] buildMessageContext complete', {
    chatId,
    durationMs: Math.round(tBuildContextEnd - tBuildContextStart),
    formattedMessageCount: formattedMessages.length,
  })

  // Stop keep-alive pings after context building completes
  if (keepAliveInterval) {
    clearInterval(keepAliveInterval)
    keepAliveInterval = null
  }

  // Update status now that context building is done — prevents
  // "Calculating context budget..." from lingering through pre-send setup
  safeEnqueue(controller, encodeStatusEvent(encoder, {
    stage: 'preparing',
    message: `Preparing request for ${character.name}...`,
    characterName: character.name,
    characterId: character.id,
  }))

  // Create tool context
  const toolContext = createToolContext(
    chatId,
    userId,
    character.id,
    characterParticipant.id,
    imageProfileId,
    undefined, // embeddingProfileId: always use default embedding profile
    chat.projectId,
    options.browserUserAgent,
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
    connectionProfile: streamingState.effectiveProfile,
    modelParams,
    messages: formattedMessages.map(m => ({
      role: m.role,
      contentLength: m.content.length,
      hasAttachments: !!m.attachments?.length,
    })),
    tools: actualTools,
    enabledToolOptions: enabledToolOptions as unknown as Record<string, boolean>,
  }))

  // Send fallback processing info if any
  if (fileProcessing.fallbackResults.length > 0) {
    controller.enqueue(encodeFallbackInfo(encoder, fileProcessing.fallbackResults))
  }

  // ============================================================================
  // Pre-Send Context Validation
  // ============================================================================
  // Verify that the assembled payload fits within the model's context window
  // BEFORE sending to the API. This prevents silent failures with small models
  // that can't handle the payload even after compression.
  safeEnqueue(controller, encodeStatusEvent(encoder, {
    stage: 'validating',
    message: `Validating context for ${character.name}...`,
    characterName: character.name,
    characterId: character.id,
  }))
  const estimatedInputTokens = countMessagesTokens(
    formattedMessages.map(m => ({ content: m.content, role: m.role }))
  )
  const modelContextLimit = builtContext.budget.totalLimit
  const responseReserve = builtContext.budget.responseReserve
  const safeInputLimit = modelContextLimit - responseReserve - Math.ceil(modelContextLimit * 0.10)

  if (estimatedInputTokens > safeInputLimit) {
    logger.warn('Context exceeds model safe input limit, payload may be rejected', {
      chatId,
      characterName: character.name,
      provider: streamingState.effectiveProfile.provider,
      model: streamingState.effectiveProfile.modelName,
      estimatedInputTokens,
      safeInputLimit,
      modelContextLimit,
      responseReserve,
      compressionApplied: builtContext.compressionApplied ?? false,
      overage: estimatedInputTokens - safeInputLimit,
    })

    // Send a warning status to the client so the user knows what happened
    safeEnqueue(controller, encodeStatusEvent(encoder, {
      stage: 'warning',
      message: `Context (~${Math.round(estimatedInputTokens / 1000)}k tokens) may exceed ${streamingState.effectiveProfile.modelName} limit (~${Math.round(safeInputLimit / 1000)}k tokens)`,
      characterName: character.name,
      characterId: character.id,
    }))
  }

  // Stream the response (state is accumulated in streamingState)

  // Pre-generate assistant message ID so logs can reference it
  const preGeneratedAssistantMessageId = crypto.randomUUID()

  // Shared helper: when any of the six streamMessage callsites in this function
  // fails mid-stream, preserve whatever accumulated in streamingState.fullResponse
  // to the DB with an OOC marker before re-throwing. Idempotent: the first call
  // that finds content writes it; subsequent calls (if the same id was already
  // written) are swallowed so the original error still propagates.
  let partialPreserved = false
  const preservePartialOnError = async (error: unknown): Promise<void> => {
    if (partialPreserved) return
    if (!streamingState.hasStartedStreaming || streamingState.fullResponse.length === 0) {
      logger.debug('No partial content to preserve after upstream error', {
        chatId,
        hasStartedStreaming: streamingState.hasStartedStreaming,
        fullResponseLength: streamingState.fullResponse.length,
      })
      return
    }
    partialPreserved = true
    const errorReason = error instanceof Error ? error.message : String(error)
    const normalizedPartial = normalizeContentBlockFormat(streamingState.fullResponse)
    const cleanedPartial = stripCharacterNamePrefix(normalizedPartial, character.name, character.aliases)
    const preservedContent = `${cleanedPartial.trimEnd()}\n\n{{OOC: stream ended abruptly (${errorReason})}}`

    try {
      const preservedMessageId = await saveAssistantMessage(
        repos,
        chatId,
        character,
        characterParticipant,
        preservedContent,
        streamingState.usage,
        streamingState.rawResponse,
        streamingState.thoughtSignature,
        [],
        [],
        preGeneratedAssistantMessageId,
        streamingState.effectiveProfile.provider,
        streamingState.effectiveProfile.modelName
      )
      logger.info('Preserved partial streamed response after upstream error', {
        chatId,
        messageId: preservedMessageId,
        characterId: character.id,
        characterName: character.name,
        provider: streamingState.effectiveProfile.provider,
        model: streamingState.effectiveProfile.modelName,
        partialLength: streamingState.fullResponse.length,
        error: errorReason,
      })
    } catch (persistError) {
      logger.error('Failed to persist partial streamed response', {
        chatId,
        characterId: character.id,
        error: persistError instanceof Error ? persistError.message : String(persistError),
        originalError: errorReason,
      })
    }
  }

  // Extract previous response ID for conversation chaining (OpenAI Responses API)
  // This allows OpenAI to use its internal cache, reducing input token costs
  let previousResponseId: string | undefined
  if (streamingState.effectiveProfile.provider === 'OPENAI') {
    // Find the last assistant message with a Responses API ID
    for (let i = existingMessages.length - 1; i >= 0; i--) {
      const msg = existingMessages[i]
      if (msg.type === 'message' && msg.role === 'ASSISTANT' && msg.rawResponse) {
        const raw = msg.rawResponse as Record<string, unknown>
        if (typeof raw.id === 'string' && raw.id.startsWith('resp_')) {
          previousResponseId = raw.id
          break
        }
      }
    }
  }

  // Send status update for sending to LLM
  safeEnqueue(controller, encodeStatusEvent(encoder, {
    stage: 'sending',
    message: `Sending to ${character.name}...`,
    characterName: character.name,
    characterId: character.id,
  }))

  // hasStartedStreaming is tracked in streamingState

  try {
    for await (const chunk of streamMessage({
      messages: formattedMessages,
      connectionProfile: streamingState.effectiveProfile,
      apiKey: streamingState.effectiveApiKey,
      modelParams,
      tools: actualTools,
      useNativeWebSearch,
      userId,
      messageId: preGeneratedAssistantMessageId,
      chatId,
      characterId: character.id,
      previousResponseId,
    })) {
      if (chunk.content) {
        // Send streaming status on first content
        if (!streamingState.hasStartedStreaming) {
          safeEnqueue(controller, encodeStatusEvent(encoder, {
            stage: 'streaming',
            message: `${character.name} is responding...`,
            characterName: character.name,
            characterId: character.id,
          }))
          streamingState.hasStartedStreaming = true
        }
        streamingState.fullResponse += chunk.content
        controller.enqueue(encodeContentChunk(encoder, chunk.content))
      }

      if (chunk.done) {
        streamingState.usage = chunk.usage || null
        streamingState.cacheUsage = chunk.cacheUsage || null
        streamingState.attachmentResults = chunk.attachmentResults || null
        streamingState.rawResponse = chunk.rawResponse
        if (chunk.thoughtSignature) {
          streamingState.thoughtSignature = chunk.thoughtSignature

        }
      }
    }
  } catch (streamingError) {
    // Check if this is a tool-unsupported error (e.g., Gemini 3 doesn't support function calling)
    // Retry the same request without tools before falling through to other recovery paths
    if (isToolUnsupportedError(streamingError) && actualTools.length > 0) {
      logger.warn('Model does not support function calling, retrying without tools', {
        chatId,
        provider: streamingState.effectiveProfile.provider,
        model: streamingState.effectiveProfile.modelName,
        toolCount: actualTools.length,
        error: streamingError instanceof Error ? streamingError.message : String(streamingError),
      })

      safeEnqueue(controller, encodeStatusEvent(encoder, {
        stage: 'sending',
        message: `Retrying without tools for ${character.name}...`,
        characterName: character.name,
        characterId: character.id,
      }))

      try {
        for await (const chunk of streamMessage({
          messages: formattedMessages,
          connectionProfile: streamingState.effectiveProfile,
          apiKey: streamingState.effectiveApiKey,
          modelParams,
          tools: [],
          useNativeWebSearch,
          userId,
          messageId: preGeneratedAssistantMessageId,
          chatId,
        })) {
          if (chunk.content) {
            if (!streamingState.hasStartedStreaming) {
              safeEnqueue(controller, encodeStatusEvent(encoder, {
                stage: 'streaming',
                message: `${character.name} is responding...`,
                characterName: character.name,
                characterId: character.id,
              }))
              streamingState.hasStartedStreaming = true
            }
            streamingState.fullResponse += chunk.content
            controller.enqueue(encodeContentChunk(encoder, chunk.content))
          }

          if (chunk.done) {
            streamingState.usage = chunk.usage || null
            streamingState.cacheUsage = chunk.cacheUsage || null
            streamingState.attachmentResults = chunk.attachmentResults || null
            streamingState.rawResponse = chunk.rawResponse
            if (chunk.thoughtSignature) {
              streamingState.thoughtSignature = chunk.thoughtSignature
            }
          }
        }

        logger.info('Tool-unsupported retry succeeded. Consider configuring text-block tools for this model.', {
          chatId,
          provider: streamingState.effectiveProfile.provider,
          model: streamingState.effectiveProfile.modelName,
          responseLength: streamingState.fullResponse.length,
        })
      } catch (retryError) {
        logger.error('Tool-unsupported retry also failed', {
          chatId,
          provider: streamingState.effectiveProfile.provider,
          model: streamingState.effectiveProfile.modelName,
          error: retryError instanceof Error ? retryError.message : String(retryError),
        })
        await preservePartialOnError(retryError)
        throw retryError
      }
    }
    // Check if this is a recoverable request error (token limit, PDF pages, etc.)
    else if (isRecoverableRequestError(streamingError)) {
      logger.info('Recoverable request error detected, attempting recovery', {
        chatId,
        provider: streamingState.effectiveProfile.provider,
        model: streamingState.effectiveProfile.modelName,
        attachmentCount: fileProcessing.attachedFiles.length,
        error: streamingError instanceof Error ? streamingError.message : String(streamingError),
      })

      const recoveryResult = await attemptRequestLimitRecovery({
        controller,
        encoder,
        character,
        connectionProfile: streamingState.effectiveProfile,
        apiKey: streamingState.effectiveApiKey,
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
        // Recovery has handled everything - return without chaining
        return {
          isMultiCharacter,
          hasContent: true,
          messageId: recoveryResult.messageId || null,
          userParticipantId,
          isPaused: chat.isPaused,
        }
      }

      // Recovery failed, re-throw the original error
      logger.warn('Request limit recovery failed, propagating error', { chatId })
    }

    // Not a recoverable error or recovery failed. Preserve any partial content
    // streamed before the upstream connection dropped.
    await preservePartialOnError(streamingError)
    throw streamingError
  }

  // Process tool calls
  let toolMessages: ToolMessage[] = []
  let generatedImagePaths: GeneratedImage[] = []
  let currentMessages = [...formattedMessages]
  let currentResponse = streamingState.fullResponse
  let currentRawResponse = streamingState.rawResponse
  // Use agent mode max turns if enabled, otherwise default to 5
  const effectiveMaxTurns = agentMode.enabled ? agentMode.maxTurns : 5
  let toolIterations = 0
  let agentModeCompleted = false
  let agentFinalResponse: string | undefined

  // Tool call loop
  while (currentRawResponse && toolIterations < effectiveMaxTurns) {
    const toolCalls = detectToolCallsInResponse(currentRawResponse, streamingState.effectiveProfile.provider)

    if (toolCalls.length === 0) break

    // Check if this is the submit_final_response tool in agent mode
    const submitFinalCall = agentMode.enabled
      ? toolCalls.find(tc => tc.name === 'submit_final_response')
      : undefined

    // Guardrail: if the model calls submit_final_response on iteration 0, as the only
    // tool, and with no accompanying prose, it is almost always ghost-wrapping work from
    // a previous (already-concluded) turn rather than responding to the current user
    // message. Reject it, synthesize a failure tool-result, and let the loop re-prompt
    // for a conversational reply.
    const isGhostWrapUp =
      !!submitFinalCall &&
      toolIterations === 0 &&
      toolCalls.length === 1 &&
      !(currentResponse && currentResponse.trim().length > 0)

    if (submitFinalCall && !isGhostWrapUp) {
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
      streamingState.fullResponse = agentFinalResponse
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

    let results: ToolProcessingResult
    if (isGhostWrapUp && submitFinalCall) {
      logger.info('[AgentMode] Rejecting iteration-0 submit_final_response with no prior work this turn', {
        chatId,
        rejectedResponseLength: (submitFinalCall.arguments as { response?: string }).response?.length,
      })
      results = {
        toolMessages: [{
          toolName: 'submit_final_response',
          success: false,
          content: "Rejected: submit_final_response was called on the first iteration without any accompanying task work or conversational prose this turn. The previous turn already concluded — do not re-wrap completed work. Respond to the user's current message directly, in character, as natural prose. You may use memory or other tools first if helpful, but only call submit_final_response after completing fresh agentic work that warrants a structured summary.",
          callId: submitFinalCall.callId,
          arguments: submitFinalCall.arguments,
        }],
        generatedImagePaths: [],
      }
    } else {
      // Per-tool status updates are now emitted inside processToolCalls
      results = await processToolCalls(toolCalls, toolContext, controller, encoder, { characterName: character.name, characterId: character.id })
    }
    toolMessages = [...toolMessages, ...results.toolMessages]
    generatedImagePaths = [...generatedImagePaths, ...results.generatedImagePaths]

    // Add assistant message with tool call to conversation
    // Include toolCalls metadata so providers can reconstruct the native assistant turn
    const hasCallIds = toolCalls.some(tc => tc.callId)
    const assistantToolCalls = hasCallIds
      ? toolCalls.filter(tc => tc.callId).map(tc => ({
          id: tc.callId!,
          type: 'function' as const,
          function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
        }))
      : undefined

    if (currentResponse && currentResponse.trim().length > 0) {
      currentMessages = [
        ...currentMessages,
        { role: 'assistant' as const, content: currentResponse, thoughtSignature: streamingState.thoughtSignature, name: undefined, toolCalls: assistantToolCalls }
      ]
    } else {
      currentMessages = [
        ...currentMessages,
        { role: 'assistant' as const, content: '', thoughtSignature: streamingState.thoughtSignature, name: undefined, toolCalls: assistantToolCalls }
      ]
    }

    // Add tool results — use native 'tool' role when callId is available, text fallback otherwise
    for (const toolMsg of results.toolMessages) {
      if (toolMsg.callId) {
        currentMessages = [
          ...currentMessages,
          { role: 'tool' as const, content: toolMsg.content, toolCallId: toolMsg.callId, name: toolMsg.toolName, thoughtSignature: undefined }
        ]
      } else {
        currentMessages = [
          ...currentMessages,
          { role: 'user' as const, content: `[Tool Result: ${toolMsg.toolName}]\n${toolMsg.content}`, thoughtSignature: undefined, name: undefined }
        ]
      }
    }

    // Update status after tool processing — prevents "Running X..." from
    // lingering through message assembly and the follow-up LLM call
    safeEnqueue(controller, encodeStatusEvent(encoder, {
      stage: 'sending',
      message: `Sending to ${character.name}...`,
      characterName: character.name,
      characterId: character.id,
    }))

    // Continue conversation with tool results
    currentResponse = ''
    currentRawResponse = null

    let emittedStreamingStatus = false
    try {
      for await (const chunk of streamMessage({
        messages: currentMessages,
        connectionProfile: streamingState.effectiveProfile,
        apiKey: streamingState.effectiveApiKey,
        modelParams,
        tools: actualTools,
        useNativeWebSearch,
        userId,
        messageId: preGeneratedAssistantMessageId,
        chatId,
        characterId: character.id,
      })) {
        if (chunk.content) {
          // Emit streaming status on first content in this tool iteration
          if (!emittedStreamingStatus) {
            emittedStreamingStatus = true
            safeEnqueue(controller, encodeStatusEvent(encoder, {
              stage: 'streaming',
              message: `${character.name} is responding...`,
              characterName: character.name,
              characterId: character.id,
            }))
          }
          currentResponse += chunk.content
          streamingState.fullResponse += chunk.content
          controller.enqueue(encodeContentChunk(encoder, chunk.content))
        }

        if (chunk.done) {
          streamingState.usage = chunk.usage || null
          streamingState.cacheUsage = chunk.cacheUsage || null
          streamingState.attachmentResults = chunk.attachmentResults || null
          currentRawResponse = chunk.rawResponse
          streamingState.rawResponse = chunk.rawResponse
          if (chunk.thoughtSignature) {
            streamingState.thoughtSignature = chunk.thoughtSignature
          }
        }
      }
    } catch (toolLoopStreamError) {
      await preservePartialOnError(toolLoopStreamError)
      throw toolLoopStreamError
    }

    // If the LLM returned tool calls without any content (silent tool use),
    // emit a processing status so the user knows something is happening
    if (!emittedStreamingStatus && currentRawResponse) {
      safeEnqueue(controller, encodeStatusEvent(encoder, {
        stage: 'processing_tools',
        message: `${character.name} is using tools...`,
        characterName: character.name,
        characterId: character.id,
      }))
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
        { role: 'assistant' as const, content: currentResponse, thoughtSignature: streamingState.thoughtSignature, name: undefined },
        { role: 'user' as const, content: forceFinalMessage, thoughtSignature: undefined, name: undefined }
      ]

      // Make one final call with force message
      try {
        for await (const chunk of streamMessage({
          messages: currentMessages,
          connectionProfile: streamingState.effectiveProfile,
          apiKey: streamingState.effectiveApiKey,
          modelParams,
          tools: actualTools,
          useNativeWebSearch,
          userId,
          messageId: preGeneratedAssistantMessageId,
          chatId,
        })) {
          if (chunk.content) {
            streamingState.fullResponse += chunk.content
            controller.enqueue(encodeContentChunk(encoder, chunk.content))
          }

          if (chunk.done) {
            streamingState.usage = chunk.usage || null
            streamingState.cacheUsage = chunk.cacheUsage || null
            streamingState.attachmentResults = chunk.attachmentResults || null
            streamingState.rawResponse = chunk.rawResponse
            if (chunk.thoughtSignature) {
              streamingState.thoughtSignature = chunk.thoughtSignature
            }

            // Check if the final call includes submit_final_response
            if (chunk.rawResponse) {
              const finalToolCalls = detectToolCallsInResponse(chunk.rawResponse, streamingState.effectiveProfile.provider)
              const submitCall = finalToolCalls.find(tc => tc.name === 'submit_final_response')
              if (submitCall) {
                const args = submitCall.arguments as { response?: string }
                if (args.response) {
                  streamingState.fullResponse = args.response
                }
              }
            }
          }
        }
      } catch (forceFinalStreamError) {
        await preservePartialOnError(forceFinalStreamError)
        throw forceFinalStreamError
      }
    } else {
      logger.warn('Max tool iterations reached', { iterations: toolIterations, chatId })
    }
  }

  // Process text tool calls via provider plugin (catches spontaneous XML emissions)
  // Each plugin knows which formats its models emit (e.g., DeepSeek <function_calls>, Gemini <tool_use>)
  const providerPlugin = getProvider(streamingState.effectiveProfile.provider)
  if (streamingState.fullResponse && providerPlugin?.hasTextToolMarkers?.(streamingState.fullResponse)) {
    const textToolCallRequests = providerPlugin.parseTextToolCalls?.(streamingState.fullResponse) ?? []

    if (textToolCallRequests.length > 0) {
      logger.info('Detected text tool calls in response (via plugin)', {
        count: textToolCallRequests.length,
        tools: textToolCallRequests.map(tc => tc.name),
        provider: streamingState.effectiveProfile.provider,
      })

      // Per-tool status updates are now emitted inside processToolCalls
      const results = await processToolCalls(textToolCallRequests, toolContext, controller, encoder, { characterName: character.name, characterId: character.id })
      toolMessages = [...toolMessages, ...results.toolMessages]
      generatedImagePaths = [...generatedImagePaths, ...results.generatedImagePaths]

      const strippedResponse = providerPlugin.stripTextToolMarkers?.(streamingState.fullResponse) ?? streamingState.fullResponse

      // Add stripped response and tool results to conversation
      currentMessages = [...formattedMessages]
      if (strippedResponse.trim()) {
        currentMessages.push({
          role: 'assistant' as const,
          content: strippedResponse,
          thoughtSignature: streamingState.thoughtSignature,
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

      // Update status after tool processing
      safeEnqueue(controller, encodeStatusEvent(encoder, {
        stage: 'sending',
        message: `Sending to ${character.name}...`,
        characterName: character.name,
        characterId: character.id,
      }))

      // Continue conversation with tool results
      let continuationResponse = ''
      try {
        for await (const chunk of streamMessage({
          messages: currentMessages,
          connectionProfile: streamingState.effectiveProfile,
          apiKey: streamingState.effectiveApiKey,
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
            streamingState.usage = chunk.usage || null
            streamingState.cacheUsage = chunk.cacheUsage || null
            streamingState.rawResponse = chunk.rawResponse
            if (chunk.thoughtSignature) {
              streamingState.thoughtSignature = chunk.thoughtSignature
            }
          }
        }
      } catch (textToolContinuationError) {
        // Reconstruct combined response so the preserved message reflects what
        // the user actually saw streamed (stripped initial + partial continuation).
        streamingState.fullResponse = strippedResponse + (strippedResponse.trim() && continuationResponse.trim() ? '\n\n' : '') + continuationResponse
        await preservePartialOnError(textToolContinuationError)
        throw textToolContinuationError
      }

      streamingState.fullResponse = strippedResponse + (strippedResponse.trim() && continuationResponse.trim() ? '\n\n' : '') + continuationResponse
      // Strip any remaining text tool markers from the continuation
      if (providerPlugin.stripTextToolMarkers) {
        streamingState.fullResponse = providerPlugin.stripTextToolMarkers(streamingState.fullResponse)
      }
    }
  }

  // Process text-block tool calls (runs for ALL providers, like XML parsing)
  // Text-block format: [[TOOL_NAME param="value"]]content[[/TOOL_NAME]]
  if (streamingState.fullResponse && hasTextBlockMarkers(streamingState.fullResponse)) {
    const textBlockToolCalls = parseTextBlocksFromResponse(streamingState.fullResponse)

    if (textBlockToolCalls.length > 0) {
      logger.info('Detected text-block tool calls in response', {
        count: textBlockToolCalls.length,
        tools: textBlockToolCalls.map(tc => tc.name),
      })

      // Per-tool status updates are now emitted inside processToolCalls
      const results = await processToolCalls(textBlockToolCalls, toolContext, controller, encoder, { characterName: character.name, characterId: character.id })
      toolMessages = [...toolMessages, ...results.toolMessages]
      generatedImagePaths = [...generatedImagePaths, ...results.generatedImagePaths]

      const strippedResponse = stripTextBlockMarkersFromResponse(streamingState.fullResponse)

      // Add stripped response and tool results to conversation
      currentMessages = [...formattedMessages]
      if (strippedResponse.trim()) {
        currentMessages.push({
          role: 'assistant' as const,
          content: strippedResponse,
          thoughtSignature: streamingState.thoughtSignature,
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

      // Update status after tool processing
      safeEnqueue(controller, encodeStatusEvent(encoder, {
        stage: 'sending',
        message: `Sending to ${character.name}...`,
        characterName: character.name,
        characterId: character.id,
      }))

      // Continue conversation with tool results
      let continuationResponse = ''
      try {
        for await (const chunk of streamMessage({
          messages: currentMessages,
          connectionProfile: streamingState.effectiveProfile,
          apiKey: streamingState.effectiveApiKey,
          modelParams,
          tools: useTextBlockTools ? [] : actualTools,
          useNativeWebSearch: useNativeWebSearch && !useTextBlockTools,
          userId,
          messageId: preGeneratedAssistantMessageId,
          chatId,
        })) {
          if (chunk.content) {
            continuationResponse += chunk.content
            controller.enqueue(encodeContentChunk(encoder, chunk.content))
          }

          if (chunk.done) {
            streamingState.usage = chunk.usage || null
            streamingState.cacheUsage = chunk.cacheUsage || null
            streamingState.rawResponse = chunk.rawResponse
            if (chunk.thoughtSignature) {
              streamingState.thoughtSignature = chunk.thoughtSignature
            }
          }
        }
      } catch (textBlockContinuationError) {
        streamingState.fullResponse = strippedResponse + (strippedResponse.trim() && continuationResponse.trim() ? '\n\n' : '') + continuationResponse
        streamingState.fullResponse = stripTextBlockMarkersFromResponse(streamingState.fullResponse)
        await preservePartialOnError(textBlockContinuationError)
        throw textBlockContinuationError
      }

      streamingState.fullResponse = strippedResponse + (strippedResponse.trim() && continuationResponse.trim() ? '\n\n' : '') + continuationResponse
      // Strip any remaining text-block markers from the continuation
      streamingState.fullResponse = stripTextBlockMarkersFromResponse(streamingState.fullResponse)
    }
  }

  const contentWasFlaggedDangerous = !!(dangerFlags && dangerFlags.length > 0)
  const { uncensoredRetryAttempted, sameProviderRetryAttempted } = await attemptEmptyResponseRecovery({
    state: streamingState,
    toolMessagesLength: toolMessages.length,
    contentWasFlaggedDangerous,
    dangerSettings,
    connectionProfile,
    formattedMessages,
    modelParams,
    actualTools,
    useNativeWebSearch,
    userId,
    chatId,
    character,
    controller,
    encoder,
    preGeneratedAssistantMessageId,
  })

  // Save assistant message
  let assistantMessageId: string | null = null

  if (streamingState.fullResponse && streamingState.fullResponse.trim().length > 0) {
    return finalizeMessageResponse({
      repos,
      chatId,
      userId,
      chat,
      character,
      characterParticipant,
      userParticipantId,
      isMultiCharacter,
      isContinueMode,
      generatedImagePaths,
      toolMessages,
      preGeneratedAssistantMessageId,
      connectionProfile,
      controller,
      encoder,
      streaming: streamingState,
      compression: {
        existingMessages: existingMessages as MessageEvent[],
        content,
        builtContext,
        compressionEnabled,
        cheapLLMSelection,
        contextCompressionSettings,
        allProfiles,
      },
      triggers: {
        dangerSettings,
        chatSettings,
        participantCharacters,
        resolvedIdentity,
        userCharacterId,
      },
    })
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
      participantId: characterParticipant.id,
      usage: streamingState.usage,
      cacheUsage: streamingState.cacheUsage,
      attachmentResults: streamingState.attachmentResults,
      toolsExecuted: true,
      provider: streamingState.effectiveProfile.provider,
      modelName: streamingState.effectiveProfile.modelName,
    }))

    return {
      isMultiCharacter,
      hasContent: true,
      messageId: toolSaveResult.firstToolMessageId || null,
      userParticipantId,
      isPaused: chat.isPaused,
    }
  } else {
    // Empty response
    const emptyReason = getEmptyResponseReason({
      uncensoredRetryAttempted,
      sameProviderRetryAttempted,
      contentWasFlaggedDangerous,
    })
    logger.warn(`Empty response for chat ${chatId}`, {
      uncensoredRetryAttempted,
      sameProviderRetryAttempted,
      contentWasFlaggedDangerous,
      dangerMode: dangerSettings.mode,
      provider: streamingState.effectiveProfile.provider,
      model: streamingState.effectiveProfile.modelName,
    })
    controller.enqueue(encodeDoneEvent(encoder, {
      messageId: null,
      participantId: characterParticipant.id,
      usage: streamingState.usage,
      cacheUsage: streamingState.cacheUsage,
      attachmentResults: streamingState.attachmentResults,
      toolsExecuted: false,
      emptyResponse: true,
      emptyResponseReason: emptyReason,
      provider: streamingState.effectiveProfile.provider,
      modelName: streamingState.effectiveProfile.modelName,
    }))

    return {
      isMultiCharacter,
      hasContent: false,
      messageId: null,
      userParticipantId,
      isPaused: chat.isPaused,
    }
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
