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
import type { MessageEvent, ConnectionProfile } from '@/lib/schemas/types'

import type { SendMessageOptions, ToolMessage, GeneratedImage, ProcessMessageResult, StreamingState } from './types'

import {
  resolveRespondingParticipant,
  loadAllParticipantData,
  getRoleplayTemplate,
} from './participant-resolver.service'
import {
  loadAndProcessFiles,
  buildMessageContext,
} from './context-builder.service'
import {
  loadProsperoProjectContext,
  postProsperoProjectContextAnnouncement,
  loadProsperoGeneralContext,
  postProsperoGeneralContextAnnouncement,
} from '@/lib/services/prospero-notifications/writer'
import {
  saveToolMessages,
  createToolContext,
} from './tool-execution.service'
import {
  buildTools,
  encodeDebugInfo,
  encodeFallbackInfo,
  encodeDoneEvent,
  encodeErrorEvent,
  encodeStatusEvent,
  safeEnqueue,
  safeClose,
} from './streaming.service'
import { dispatchCourierTransport } from './courier-transport.service'
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
import { flushPendingWardrobeAnnouncements } from '@/lib/tools/handlers/wardrobe-handler-shared'
import { countMessagesTokens } from '@/lib/tokens/token-counter'
import { getCheapLLMProvider, DEFAULT_CHEAP_LLM_CONFIG } from '@/lib/llm/cheap-llm'
import type { ContextCompressionSettings } from '@/lib/schemas/settings.types'
import { runPreContextPreCompute } from './pre-compute.service'
import { runTextToolPass } from './text-tool-loop.service'
import { findPreviousResponseId, makePreservePartialOnError, runPrimaryStream } from './primary-stream.service'
import { runNativeToolLoop } from './native-tool-loop.service'
import {
  detectAndConvertRngPatterns,
  type RngToolCall,
} from './rng-pattern-detector.service'
import { executeRngTool, formatRngResults } from '@/lib/tools/handlers/rng-handler'
import {
  finalizeMessageResponse,
} from './message-finalizer.service'
import {
  resolveAgentModeSetting,
  buildAgentModeInstructions,
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

  // The Courier (manual / clipboard transport): no API key, no plugin call.
  // Detected here so the API-key check, tool build, and streamMessage block
  // can all short-circuit later.
  const isCourierTransport = connectionProfile.transport === 'courier'

  // Validate API key for providers that require it
  let apiKey = ''
  if (!isCourierTransport && requiresApiKey(connectionProfile.provider)) {
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
  // Project Context Re-injection (Phase E: Prospero whisper)
  // ============================================================================
  // The chat-start project-context whisper is posted by `createInitialMessages`
  // when the chat is created. Here we handle the cadence-based refresh:
  // every `projectContextReinjectInterval` messages we post a fresh Prospero
  // project-context whisper into the transcript so the LLM keeps the project's
  // description and instructions in mind. The `projectContext` parameter on the
  // system-prompt builder is now unused; the system-prompt block was dropped
  // along with this rewire.

  const reinjectInterval = contextCompressionSettings.projectContextReinjectInterval ?? 5
  const messageCount = existingMessages.filter(m => m.type === 'message').length
  // Skip messageCount === 0 — chat-start handles the initial emit. Cadence
  // re-injects at multiples of N thereafter.
  const shouldInjectContext = reinjectInterval > 0 && messageCount > 0 && messageCount % reinjectInterval === 0

  if (project && shouldInjectContext) {
    const projectContext = await loadProsperoProjectContext(project.id)
    if (projectContext) {
      const posted = await postProsperoProjectContextAnnouncement({
        chatId,
        project: projectContext,
      })
      if (posted) {
        existingMessages.push(posted)
      }
    }
  }

  // Always-on general-context re-injection — fires for every chat, project
  // or not, at the same cadence as the project-context whisper.
  if (shouldInjectContext) {
    const generalContext = await loadProsperoGeneralContext()
    if (generalContext) {
      const posted = await postProsperoGeneralContextAnnouncement({
        chatId,
        general: generalContext,
      })
      if (posted) {
        existingMessages.push(posted)
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

  // Phase D: outfit changes now ride as Aurora whispers in the transcript
  // (see `handleWardrobeOutfitAnnouncement` and `postOutfitChangeWhisper`),
  // so the per-turn `pendingOutfitNotifications` flush is no longer needed.

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
    }
  }

  // System transparency override: when the character isn't opted in, force the
  // self_inventory tool out of the slate — the chat- and project-level toggles
  // for that tool can't override the character-level covenant. Cheap union with
  // whatever the chat already disables.
  const characterIsTransparent = character?.systemTransparency === true
  const effectiveDisabledTools = characterIsTransparent
    ? (chat.disabledTools ?? [])
    : Array.from(new Set([...(chat.disabledTools ?? []), 'self_inventory']))

  // The Courier transport exposes no tools (the external LLM cannot reach
  // them) and injects no tool instructions into the system prompt. Skip the
  // whole tool-build step in that case.
  const isEffectiveCourier = streamingState.effectiveProfile.transport === 'courier'

  let tools: unknown[] = []
  let modelSupportsNativeTools = false
  let useNativeWebSearch = false
  if (!isEffectiveCourier) {
    // Build tools (include request_full_context when compression is enabled, submit_final_response when agent mode is enabled)
    // Always pass disabledTools and disabledToolGroups for filtering
    const builtTools = await buildTools(
      streamingState.effectiveProfile,
      imageProfileId,
      imageProfile,
      userId,
      chat.projectId ?? undefined, // projectId - enables project_info tool
      compressionEnabled, // requestFullContext - enable the tool when compression is active
      effectiveDisabledTools,
      chat.disabledToolGroups ?? [],
      agentMode.enabled, // agentModeEnabled - enables submit_final_response tool
      isMultiCharacter, // isMultiCharacter - enables whisper tool
      helpToolsEnabled, // helpToolsEnabled - enables help_search and help_settings tools
      canDressThemselves, // canDressThemselves - enables list_wardrobe and update_outfit_item
      canCreateOutfits, // canCreateOutfits - enables create_wardrobe_item
      documentEditingEnabled // documentEditingEnabled - enables doc_* editing tools
    )
    tools = builtTools.tools
    modelSupportsNativeTools = builtTools.modelSupportsNativeTools
    useNativeWebSearch = builtTools.useNativeWebSearch
  }

  const useTextBlockTools = !isEffectiveCourier && checkShouldUseTextBlockTools(modelSupportsNativeTools)
  const actualTools = useTextBlockTools ? [] : tools

  // Build tool instructions (text-block or native tool rules)
  let toolInstructions: string | undefined
  if (isEffectiveCourier) {
    toolInstructions = undefined
  } else if (useTextBlockTools) {
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

  const { cachedCompressionResponse, preSearchedMemories, stopKeepAlive } = await runPreContextPreCompute({
    chatId,
    userId,
    chat,
    character,
    characterParticipant,
    isMultiCharacter,
    isContinueMode,
    content,
    existingMessages,
    compressionEnabled,
    bypassCompression,
    cheapLLMSelection,
    dangerSettings,
    allProfiles,
    controller,
    encoder,
  })

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
      connectionProfile: streamingState.effectiveProfile,
      userCharacter,
      isMultiCharacter,
      participantCharacters,
      roleplayTemplate,
      chatSettings: contextChatSettings,
      toolInstructions,
      newUserMessage: finalUserMessageContent,
      isContinueMode,
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

  // Stop keep-alive pings after context building completes
  stopKeepAlive()

  // Update status now that context building is done — prevents
  // "Calculating context budget..." from lingering through pre-send setup
  safeEnqueue(controller, encodeStatusEvent(encoder, {
    stage: 'preparing',
    message: `Preparing request for ${character.name}...`,
    characterName: character.name,
    characterId: character.id,
  }))

  // ============================================================================
  // The Courier (manual / clipboard transport) — short-circuit before tool /
  // streaming machinery. The dispatch service renders the assembled request
  // as Markdown, persists a placeholder assistant message, pauses the chat,
  // and emits SSE events. Turn chaining is halted by isPaused=true; the paste
  // resolver clears the pause when the user submits a reply.
  // ============================================================================
  if (isEffectiveCourier) {
    return dispatchCourierTransport({
      repos,
      chatId,
      chat,
      character,
      characterParticipant,
      userParticipantId,
      isMultiCharacter,
      participantCharacters,
      resolvedIdentity,
      formattedMessages,
      streaming: streamingState,
      controller,
      encoder,
    })
  }

  // Create tool context. Memories loaded into the prompt are forwarded so
  // introspection tools (self_inventory) can report the exact slate the LLM
  // saw this turn.
  const toolContext = createToolContext(
    chatId,
    userId,
    character.id,
    characterParticipant.id,
    imageProfileId,
    undefined, // embeddingProfileId: always use default embedding profile
    chat.projectId,
    options.browserUserAgent,
    {
      semantic: builtContext.debugMemories,
      interCharacter: builtContext.debugInterCharacterMemories,
      recap: builtContext.debugMemoryRecap,
    },
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

  // Idempotent partial-response preserver shared across every streamMessage
  // callsite for this turn. First call that finds streamed content writes
  // it to the DB with an OOC marker; subsequent calls no-op so the original
  // error still propagates.
  const preservePartialOnError = makePreservePartialOnError({
    repos,
    chatId,
    character,
    characterParticipant,
    streaming: streamingState,
    preGeneratedAssistantMessageId,
  })

  const previousResponseId = findPreviousResponseId(
    streamingState.effectiveProfile.provider,
    existingMessages as MessageEvent[]
  )

  const primaryStreamResult = await runPrimaryStream({
    repos,
    chatId,
    userId,
    chat,
    character,
    characterParticipant,
    userParticipantId,
    isMultiCharacter,
    formattedMessages,
    modelParams,
    actualTools,
    useNativeWebSearch,
    previousResponseId,
    preGeneratedAssistantMessageId,
    attachedFiles: fileProcessing.attachedFiles,
    originalMessage: options.content,
    connectionProfile,
    streaming: streamingState,
    controller,
    encoder,
    preservePartialOnError,
  })

  if (primaryStreamResult.earlyReturn) {
    return primaryStreamResult.earlyReturn
  }

  // Process tool calls (native function-calling loop, agent-mode submit_final_response,
  // ghost-wrap guardrail, max-turns force-final pass all live in the sibling service).
  const toolMessages: ToolMessage[] = []
  const generatedImagePaths: GeneratedImage[] = []
  await runNativeToolLoop({
    repos,
    chatId,
    userId,
    character,
    characterParticipant,
    preGeneratedAssistantMessageId,
    agentMode,
    formattedMessages,
    modelParams,
    actualTools,
    useNativeWebSearch,
    toolContext,
    streaming: streamingState,
    toolMessages,
    generatedImagePaths,
    controller,
    encoder,
    preservePartialOnError,
  })

  // Phase 19: provider-native text tool markers (catches spontaneous XML
  // emissions like DeepSeek's <function_calls> or Gemini's <tool_use>). Each
  // plugin knows which formats its models emit; no-op when the plugin
  // doesn't implement the detector or the response is empty.
  const providerPlugin = getProvider(streamingState.effectiveProfile.provider)
  if (providerPlugin?.hasTextToolMarkers && providerPlugin.parseTextToolCalls && providerPlugin.stripTextToolMarkers) {
    const pluginHasMarkers = providerPlugin.hasTextToolMarkers
    const pluginParse = providerPlugin.parseTextToolCalls
    const pluginStrip = providerPlugin.stripTextToolMarkers
    await runTextToolPass({
      chatId,
      userId,
      character,
      preGeneratedAssistantMessageId,
      strategy: {
        name: 'provider-text-markers',
        hasMarkers: pluginHasMarkers,
        parse: pluginParse,
        strip: pluginStrip,
      },
      formattedMessages,
      modelParams,
      continuationTools: actualTools,
      continuationUseNativeWebSearch: useNativeWebSearch,
      toolContext,
      streaming: streamingState,
      toolMessages,
      generatedImagePaths,
      controller,
      encoder,
      preservePartialOnError,
    })
  }

  // Phase 20: text-block tool calls (`[[TOOL_NAME ...]]content[[/TOOL_NAME]]`),
  // runs for ALL providers. When useTextBlockTools is on, the continuation
  // suppresses native tools and web search so the model can't re-emit the
  // markers it just had stripped.
  await runTextToolPass({
    chatId,
    userId,
    character,
    preGeneratedAssistantMessageId,
    strategy: {
      name: 'text-block',
      hasMarkers: hasTextBlockMarkers,
      parse: parseTextBlocksFromResponse,
      strip: stripTextBlockMarkersFromResponse,
    },
    formattedMessages,
    modelParams,
    continuationTools: useTextBlockTools ? [] : actualTools,
    continuationUseNativeWebSearch: useNativeWebSearch && !useTextBlockTools,
    toolContext,
    streaming: streamingState,
    toolMessages,
    generatedImagePaths,
    controller,
    encoder,
    preservePartialOnError,
  })

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

  // End-of-turn drain: collapse any wardrobe edits this character made into a
  // single Aurora announcement per affected character, regardless of which
  // terminal branch we exit through. The handlers add to the Set instead of
  // enqueuing per-edit; here we fire one job each and clear.
  await flushPendingWardrobeAnnouncements(toolContext)

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
      character.id,
      characterParticipant.id
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
