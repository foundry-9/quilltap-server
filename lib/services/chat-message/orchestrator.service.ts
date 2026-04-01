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
import { isParticipantPresent } from '@/lib/schemas/chat.types'
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
  encodeTurnStartEvent,
  encodeTurnCompleteEvent,
  encodeChainCompleteEvent,
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
  triggerMemoryExtraction,
  triggerInterCharacterMemory,
  triggerUserControlledCharacterMemory,
  triggerContextSummaryCheck,
  triggerChatDangerClassification,
  triggerSceneStateTracking,
} from './memory-trigger.service'
import { trackMessageTokenUsage } from '@/lib/services/token-tracking.service'
import { estimateMessageCost } from '@/lib/services/cost-estimation.service'
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
  resolveAgentModeSetting,
  buildAgentModeInstructions,
  buildForceFinalMessage,
  generateIterationSummary,
  type ResolvedAgentMode,
} from './agent-mode-resolver.service'
import { resolveUserIdentity } from './user-identity-resolver.service'
import {
  shouldChainNext,
  persistTurnParticipantId,
  DEFAULT_CHAIN_CONFIG,
} from './turn-orchestrator.service'
import {
  resolveDangerousContentSettings,
} from '@/lib/services/dangerous-content/resolver.service'
import {
  classifyContent as classifyDangerousContent,
} from '@/lib/services/dangerous-content/gatekeeper.service'
import {
  resolveProviderForDangerousContent,
} from '@/lib/services/dangerous-content/provider-routing.service'
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

        // Server-side chain orchestration for multi-character chats
        // After the first character responds, chain subsequent character responses
        // in the same SSE stream instead of requiring client round-trips
        if (result.isMultiCharacter && result.hasContent && !result.isPaused) {
          const chainStartTime = Date.now()
          let chainDepth = 0

          // If the user just sent a message, ensure the chain loop knows a human is present
          // even if no participant has controlledBy='user'. The sentinel '__user__' causes
          // selectNextSpeaker to return user_turn/cycle_complete instead of looping forever.
          const effectiveUserParticipantId = result.userParticipantId
            ?? (options.continueMode ? null : '__user__')

          while (true) {
            const decision = await shouldChainNext(
              repos,
              chatId,
              effectiveUserParticipantId,
              chainDepth,
              chainStartTime,
              DEFAULT_CHAIN_CONFIG
            )


            if (!decision.chain || !decision.participantId) {
              // Persist the final turn state
              const finalNextSpeaker = decision.participantId || null
              await persistTurnParticipantId(repos, chatId, finalNextSpeaker)

              // Send chain complete event
              safeEnqueue(controller, encodeChainCompleteEvent(encoder, {
                reason: decision.reason as 'user_turn' | 'paused' | 'max_depth' | 'max_time' | 'error' | 'no_next_speaker' | 'cycle_complete',
                nextSpeakerId: finalNextSpeaker,
                chainDepth,
              }))
              break
            }

            chainDepth++

            // Send turn start event
            safeEnqueue(controller, encodeTurnStartEvent(encoder, {
              participantId: decision.participantId,
              characterName: decision.characterName || 'Unknown',
              chainDepth,
            }))

            // Process the chained response using continue mode
            try {
              const chainResult = await processMessage(
                repos,
                chatId,
                userId,
                {
                  continueMode: true,
                  respondingParticipantId: decision.participantId,
                },
                controller,
                encoder
              )

              // Send turn complete event
              safeEnqueue(controller, encodeTurnCompleteEvent(encoder, {
                participantId: decision.participantId,
                messageId: chainResult.messageId || '',
                chainDepth,
              }))

              // If the chained response had no content (empty response), stop chaining
              if (!chainResult.hasContent) {
                logger.info('[TurnOrchestrator] Chain stopped: empty response', { chatId, chainDepth })
                await persistTurnParticipantId(repos, chatId, null)
                safeEnqueue(controller, encodeChainCompleteEvent(encoder, {
                  reason: 'error',
                  nextSpeakerId: null,
                  chainDepth,
                }))
                break
              }
            } catch (chainError) {
              logger.error('[TurnOrchestrator] Chain error, stopping', {
                chatId,
                chainDepth,
                error: chainError instanceof Error ? chainError.message : String(chainError),
              })

              // Pause chat on chain error
              await repos.chats.update(chatId, { isPaused: true })
              await persistTurnParticipantId(repos, chatId, null)
              safeEnqueue(controller, encodeChainCompleteEvent(encoder, {
                reason: 'error',
                nextSpeakerId: null,
                chainDepth,
              }))
              break
            }
          }
        }

        // Trigger scene state tracking once after the complete chain
        if (result.isMultiCharacter && result.hasContent) {
          try {
            const chainChat = await repos.chats.findById(chatId)
            if (chainChat) {
              const chatSettings = await repos.chatSettings.findByUserId(userId)
              if (chatSettings?.cheapLLMSettings) {
                const chainCharacterIds = chainChat.participants
                  .filter(p => isParticipantPresent(p.status) && p.characterId)
                  .map(p => p.characterId)
                const chainConnectionProfile = await repos.connections.findById(
                  chainChat.participants[0]?.connectionProfileId || ''
                )
                if (chainConnectionProfile) {
                  await triggerSceneStateTracking(repos, {
                    chatId,
                    userId,
                    connectionProfile: chainConnectionProfile,
                    chatSettings: { cheapLLMSettings: chatSettings.cheapLLMSettings },
                    characterIds: chainCharacterIds,
                  })
                }
              }
            }
          } catch (error) {
            logger.warn('[TurnOrchestrator] Failed to trigger scene state tracking after chain', {
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
 * Result returned by processMessage for chain orchestration
 */
interface ProcessMessageResult {
  /** Whether the chat has multiple characters */
  isMultiCharacter: boolean
  /** Whether the response had content (non-empty) */
  hasContent: boolean
  /** The assistant message ID (if content was generated) */
  messageId: string | null
  /** User participant ID for turn calculations */
  userParticipantId: string | null
  /** Whether the chat is paused */
  isPaused: boolean
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
  const persona: { name: string; description: string } | null = {
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

  let dangerFlags: DangerFlag[] | undefined
  // Effective profile/key - may be overridden by dangerous content routing
  let effectiveProfile = connectionProfile
  let effectiveApiKey = apiKey

  const dangerousContentResolved = resolveDangerousContentSettings(chatSettings)
  const dangerSettings = dangerousContentResolved.settings

  if (chat.isDangerousChat === true && dangerSettings.mode !== 'OFF' && !isContinueMode && options.content) {
    // Chat is permanently dangerous — skip per-message classification to save tokens
    logger.debug('[DangerousContent] Skipping per-message classification — chat permanently dangerous', {
      chatId,
      dangerCategories: chat.dangerCategories,
    })

    // Synthesize danger flags from stored chat-level categories
    const categories = chat.dangerCategories && chat.dangerCategories.length > 0
      ? chat.dangerCategories
      : ['unspecified']
    dangerFlags = categories.map(cat => ({
      category: cat,
      score: 1.0,
      userOverridden: false,
      wasRerouted: false,
    }))

    // If AUTO_ROUTE and current profile is NOT uncensored-compatible, reroute
    if (dangerSettings.mode === 'AUTO_ROUTE' && !effectiveProfile.isDangerousCompatible) {
      const routeResult = await resolveProviderForDangerousContent(
        effectiveProfile,
        effectiveApiKey,
        dangerSettings,
        userId
      )

      if (routeResult.rerouted) {
        effectiveProfile = routeResult.connectionProfile
        effectiveApiKey = routeResult.apiKey

        dangerFlags = dangerFlags.map(flag => ({
          ...flag,
          wasRerouted: true,
          reroutedProvider: routeResult.connectionProfile.provider,
          reroutedModel: routeResult.connectionProfile.modelName,
        }))

        logger.info('[DangerousContent] Rerouted to uncensored provider (permanently dangerous chat)', {
          chatId,
          originalProfile: connectionProfile.name,
          uncensoredProfile: routeResult.connectionProfile.name,
        })
      }
    } else if (dangerSettings.mode === 'AUTO_ROUTE') {
      logger.debug('[DangerousContent] Current provider is already uncensored-compatible, skipping reroute', {
        chatId,
        provider: effectiveProfile.provider,
        model: effectiveProfile.modelName,
      })
    }
  } else if (dangerSettings.mode !== 'OFF' && dangerSettings.scanTextChat && !isContinueMode && options.content && cheapLLMSelection) {
    try {
      // Send classification status
      safeEnqueue(controller, encodeStatusEvent(encoder, {
        stage: 'classifying',
        message: 'Checking content...',
        characterName: character.name,
        characterId: character.id,
      }))

      const classificationResult = await classifyDangerousContent(
        options.content,
        cheapLLMSelection,
        userId,
        dangerSettings,
        chatId
      )

      if (classificationResult.isDangerous) {
        // Build danger flags for the message
        dangerFlags = classificationResult.categories.map(cat => ({
          category: cat.category,
          score: cat.score,
          userOverridden: false,
          wasRerouted: false,
        }))

        logger.info('[DangerousContent] User message classified as dangerous', {
          chatId,
          score: classificationResult.score,
          categories: classificationResult.categories.map(c => c.category),
          mode: dangerSettings.mode,
        })

        // If AUTO_ROUTE, try to reroute to uncensored provider
        if (dangerSettings.mode === 'AUTO_ROUTE') {
          if (!effectiveProfile.isDangerousCompatible) {
            safeEnqueue(controller, encodeStatusEvent(encoder, {
              stage: 'rerouting',
              message: 'Routing to uncensored provider...',
              characterName: character.name,
              characterId: character.id,
            }))

            const routeResult = await resolveProviderForDangerousContent(
              effectiveProfile,
              effectiveApiKey,
              dangerSettings,
              userId
            )

            if (routeResult.rerouted) {
              effectiveProfile = routeResult.connectionProfile
              effectiveApiKey = routeResult.apiKey

              // Update danger flags with routing info
              dangerFlags = dangerFlags.map(flag => ({
                ...flag,
                wasRerouted: true,
                reroutedProvider: routeResult.connectionProfile.provider,
                reroutedModel: routeResult.connectionProfile.modelName,
              }))

              logger.info('[DangerousContent] Rerouted to uncensored provider', {
                chatId,
                originalProfile: connectionProfile.name,
                uncensoredProfile: routeResult.connectionProfile.name,
                reason: routeResult.reason,
              })
            } else {
              logger.warn('[DangerousContent] No uncensored provider available, using original', {
                chatId,
                reason: routeResult.reason,
              })
            }
          } else {
            logger.debug('[DangerousContent] Current provider is already uncensored-compatible, skipping reroute', {
              chatId,
              provider: effectiveProfile.provider,
              model: effectiveProfile.modelName,
            })
          }
        }

        // Save DANGER_CLASSIFICATION system event for token tracking
        if (classificationResult.usage) {
          const classificationEvent = {
            id: crypto.randomUUID(),
            type: 'system' as const,
            systemEventType: 'DANGER_CLASSIFICATION' as const,
            description: `Content classified: score ${classificationResult.score.toFixed(2)}, categories: ${classificationResult.categories.map(c => c.category).join(', ')}`,
            promptTokens: classificationResult.usage.promptTokens,
            completionTokens: classificationResult.usage.completionTokens,
            totalTokens: classificationResult.usage.totalTokens,
            provider: cheapLLMSelection.provider,
            modelName: cheapLLMSelection.modelName,
            createdAt: new Date().toISOString(),
          }
          await repos.chats.addMessage(chatId, classificationEvent)
        }

      }
    } catch (error) {
      // Fail safe - never block on classification errors
      logger.error('[DangerousContent] Classification failed, continuing with original provider', {
        chatId,
        error: error instanceof Error ? error.message : String(error),
      })
    }
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

  // Check if tool settings were just changed (for notification message)
  const toolSettingsChanged = chat.forceToolsOnNextMessage === true

  // Clear forceToolsOnNextMessage flag if it was set
  if (toolSettingsChanged) {
    await repos.chats.update(chatId, { forceToolsOnNextMessage: false })
  }

  // Check tool options
  const enabledToolOptions = determineEnabledToolOptions(
    imageProfileId,
    effectiveProfile.allowWebSearch
  )

  // Resolve help tools enabled from character (default: disabled)
  const helpToolsEnabled = character?.defaultHelpToolsEnabled === true

  // Build tools (include request_full_context when compression is enabled, submit_final_response when agent mode is enabled)
  // Always pass disabledTools and disabledToolGroups for filtering
  const { tools, modelSupportsNativeTools, useNativeWebSearch } = await buildTools(
    effectiveProfile,
    imageProfileId,
    imageProfile,
    userId,
    chat.projectId ?? undefined, // projectId - enables project_info tool
    compressionEnabled, // requestFullContext - enable the tool when compression is active
    chat.disabledTools ?? [],
    chat.disabledToolGroups ?? [],
    agentMode.enabled, // agentModeEnabled - enables submit_final_response tool
    isMultiCharacter, // isMultiCharacter - enables whisper tool
    helpToolsEnabled // helpToolsEnabled - enables help_search and help_settings tools
  )

  const useTextBlockTools = checkShouldUseTextBlockTools(modelSupportsNativeTools)
  const actualTools = useTextBlockTools ? [] : tools

  // Build tool instructions (text-block or native tool rules)
  let toolInstructions: string | undefined
  if (useTextBlockTools) {
    const textBlockOptions = determineTextBlockToolOptions(
      imageProfileId,
      effectiveProfile.allowWebSearch,
      isMultiCharacter,
      !!chat.projectId,
      helpToolsEnabled
    )
    toolInstructions = buildTextBlockSystemInstructions(textBlockOptions)
    logTextBlockToolUsage(effectiveProfile.provider, effectiveProfile.modelName, textBlockOptions)
  } else if (actualTools.length > 0) {
    toolInstructions = buildNativeToolSystemInstructions()
  }

  // Build message context
  const modelParams = effectiveProfile.parameters as Record<string, unknown>
  const contextChatSettings = chatSettings ? {
    cheapLLMSettings: chatSettings.cheapLLMSettings ? {
      embeddingProfileId: chatSettings.cheapLLMSettings.embeddingProfileId ?? undefined,
    } : undefined,
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
    const embeddingProfileId = chatSettings?.cheapLLMSettings?.embeddingProfileId ?? undefined

    try {
      const memoryResults = await searchMemoriesSemantic(
        character.id,
        searchQuery,
        {
          userId,
          embeddingProfileId,
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
  const [cachedCompressionResponse, preSearchedMemories] = await Promise.all([
    compressionTask(),
    proactiveRecallTask(),
  ])

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
      connectionProfile: effectiveProfile,
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
    connectionProfile: effectiveProfile,
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
      provider: effectiveProfile.provider,
      model: effectiveProfile.modelName,
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
      message: `Context (~${Math.round(estimatedInputTokens / 1000)}k tokens) may exceed ${effectiveProfile.modelName} limit (~${Math.round(safeInputLimit / 1000)}k tokens)`,
      characterName: character.name,
      characterId: character.id,
    }))
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

  // Extract previous response ID for conversation chaining (OpenAI Responses API)
  // This allows OpenAI to use its internal cache, reducing input token costs
  let previousResponseId: string | undefined
  if (effectiveProfile.provider === 'OPENAI') {
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

  // Track if streaming has started for status update
  let hasStartedStreaming = false

  try {
    for await (const chunk of streamMessage({
      messages: formattedMessages,
      connectionProfile: effectiveProfile,
      apiKey: effectiveApiKey,
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
    // Check if this is a tool-unsupported error (e.g., Gemini 3 doesn't support function calling)
    // Retry the same request without tools before falling through to other recovery paths
    if (isToolUnsupportedError(streamingError) && actualTools.length > 0) {
      logger.warn('Model does not support function calling, retrying without tools', {
        chatId,
        provider: effectiveProfile.provider,
        model: effectiveProfile.modelName,
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
          connectionProfile: effectiveProfile,
          apiKey: effectiveApiKey,
          modelParams,
          tools: [],
          useNativeWebSearch,
          userId,
          messageId: preGeneratedAssistantMessageId,
          chatId,
        })) {
          if (chunk.content) {
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

        logger.info('Tool-unsupported retry succeeded. Consider configuring text-block tools for this model.', {
          chatId,
          provider: effectiveProfile.provider,
          model: effectiveProfile.modelName,
          responseLength: fullResponse.length,
        })
      } catch (retryError) {
        logger.error('Tool-unsupported retry also failed', {
          chatId,
          provider: effectiveProfile.provider,
          model: effectiveProfile.modelName,
          error: retryError instanceof Error ? retryError.message : String(retryError),
        })
        throw retryError
      }
    }
    // Check if this is a recoverable request error (token limit, PDF pages, etc.)
    else if (isRecoverableRequestError(streamingError)) {
      logger.info('Recoverable request error detected, attempting recovery', {
        chatId,
        provider: effectiveProfile.provider,
        model: effectiveProfile.modelName,
        attachmentCount: fileProcessing.attachedFiles.length,
        error: streamingError instanceof Error ? streamingError.message : String(streamingError),
      })

      const recoveryResult = await attemptRequestLimitRecovery({
        controller,
        encoder,
        character,
        connectionProfile: effectiveProfile,
        apiKey: effectiveApiKey,
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
    const toolCalls = detectToolCallsInResponse(currentRawResponse, effectiveProfile.provider)

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
        { role: 'assistant' as const, content: currentResponse, thoughtSignature, name: undefined, toolCalls: assistantToolCalls }
      ]
    } else {
      currentMessages = [
        ...currentMessages,
        { role: 'assistant' as const, content: '', thoughtSignature, name: undefined, toolCalls: assistantToolCalls }
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

    // Continue conversation with tool results
    currentResponse = ''
    currentRawResponse = null

    for await (const chunk of streamMessage({
      messages: currentMessages,
      connectionProfile: effectiveProfile,
      apiKey: effectiveApiKey,
      modelParams,
      tools: actualTools,
      useNativeWebSearch,
      userId,
      messageId: preGeneratedAssistantMessageId,
      chatId,
      characterId: character.id,
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
        connectionProfile: effectiveProfile,
        apiKey: effectiveApiKey,
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
            const finalToolCalls = detectToolCallsInResponse(chunk.rawResponse, effectiveProfile.provider)
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

  // Process text tool calls via provider plugin (catches spontaneous XML emissions)
  // Each plugin knows which formats its models emit (e.g., DeepSeek <function_calls>, Gemini <tool_use>)
  const providerPlugin = getProvider(effectiveProfile.provider)
  if (fullResponse && providerPlugin?.hasTextToolMarkers?.(fullResponse)) {
    const textToolCallRequests = providerPlugin.parseTextToolCalls?.(fullResponse) ?? []

    if (textToolCallRequests.length > 0) {
      logger.info('Detected text tool calls in response (via plugin)', {
        count: textToolCallRequests.length,
        tools: textToolCallRequests.map(tc => tc.name),
        provider: effectiveProfile.provider,
      })

      // Send tool executing status for each detected tool
      for (const toolCall of textToolCallRequests) {
        safeEnqueue(controller, encodeStatusEvent(encoder, {
          stage: 'tool_executing',
          message: `Running ${toolCall.name}...`,
          toolName: toolCall.name,
          characterName: character.name,
          characterId: character.id,
        }))
      }

      const results = await processToolCalls(textToolCallRequests, toolContext, controller, encoder)
      toolMessages = [...toolMessages, ...results.toolMessages]
      generatedImagePaths = [...generatedImagePaths, ...results.generatedImagePaths]

      const strippedResponse = providerPlugin.stripTextToolMarkers?.(fullResponse) ?? fullResponse

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
        connectionProfile: effectiveProfile,
        apiKey: effectiveApiKey,
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
      // Strip any remaining text tool markers from the continuation
      if (providerPlugin.stripTextToolMarkers) {
        fullResponse = providerPlugin.stripTextToolMarkers(fullResponse)
      }
    }
  }

  // Process text-block tool calls (runs for ALL providers, like XML parsing)
  // Text-block format: [[TOOL_NAME param="value"]]content[[/TOOL_NAME]]
  if (fullResponse && hasTextBlockMarkers(fullResponse)) {
    const textBlockToolCalls = parseTextBlocksFromResponse(fullResponse)

    if (textBlockToolCalls.length > 0) {
      logger.info('Detected text-block tool calls in response', {
        count: textBlockToolCalls.length,
        tools: textBlockToolCalls.map(tc => tc.name),
      })

      // Send tool executing status for each detected tool
      for (const toolCall of textBlockToolCalls) {
        safeEnqueue(controller, encodeStatusEvent(encoder, {
          stage: 'tool_executing',
          message: `Running ${toolCall.name}...`,
          toolName: toolCall.name,
          characterName: character.name,
          characterId: character.id,
        }))
      }

      const results = await processToolCalls(textBlockToolCalls, toolContext, controller, encoder)
      toolMessages = [...toolMessages, ...results.toolMessages]
      generatedImagePaths = [...generatedImagePaths, ...results.generatedImagePaths]

      const strippedResponse = stripTextBlockMarkersFromResponse(fullResponse)

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
        connectionProfile: effectiveProfile,
        apiKey: effectiveApiKey,
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
          usage = chunk.usage || null
          cacheUsage = chunk.cacheUsage || null
          rawResponse = chunk.rawResponse
          if (chunk.thoughtSignature) {
            thoughtSignature = chunk.thoughtSignature
          }
        }
      }

      fullResponse = strippedResponse + (strippedResponse.trim() && continuationResponse.trim() ? '\n\n' : '') + continuationResponse
      // Strip any remaining text-block markers from the continuation
      fullResponse = stripTextBlockMarkersFromResponse(fullResponse)
    }
  }

  // ============================================================================
  // Empty Response Retry Logic
  // ============================================================================
  // If the response is empty and no tool calls were made, the behavior depends
  // on whether the content was flagged as dangerous by the Concierge:
  //
  // Content PASSED moderation (or moderation not run):
  //   1. Retry with the SAME provider (likely a transient issue)
  //   2. If still empty and AUTO_ROUTE with uncensored provider available,
  //      fail over to uncensored provider
  //
  // Content FLAGGED as dangerous:
  //   1. Immediately fail over to uncensored provider (the LLM's own safety
  //      filter likely triggered the empty response)
  let uncensoredRetryAttempted = false
  let sameProviderRetryAttempted = false
  const contentWasFlaggedDangerous = dangerFlags && dangerFlags.length > 0
  if (
    fullResponse.trim().length === 0 &&
    toolMessages.length === 0
  ) {
    // --- Same-provider retry for content that passed moderation ---
    if (!contentWasFlaggedDangerous) {
      sameProviderRetryAttempted = true
      logger.warn('[EmptyResponse] Empty response from provider that passed moderation, retrying same provider', {
        chatId,
        provider: effectiveProfile.provider,
        model: effectiveProfile.modelName,
      })

      safeEnqueue(controller, encodeStatusEvent(encoder, {
        stage: 'retrying',
        message: 'Empty response received — retrying...',
        characterName: character.name,
        characterId: character.id,
      }))

      try {
        for await (const chunk of streamMessage({
          messages: formattedMessages,
          connectionProfile: effectiveProfile,
          apiKey: effectiveApiKey,
          modelParams,
          tools: actualTools,
          useNativeWebSearch,
          userId,
          messageId: preGeneratedAssistantMessageId,
          chatId,
        })) {
          if (chunk.content) {
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

        if (fullResponse.trim().length > 0) {
          logger.info('[EmptyResponse] Same-provider retry succeeded', {
            chatId,
            provider: effectiveProfile.provider,
            model: effectiveProfile.modelName,
            responseLength: fullResponse.length,
          })
        } else {
          logger.warn('[EmptyResponse] Same-provider retry also returned empty', {
            chatId,
            provider: effectiveProfile.provider,
            model: effectiveProfile.modelName,
          })
        }
      } catch (retryError) {
        logger.error('[EmptyResponse] Same-provider retry failed', {
          chatId,
          error: retryError instanceof Error ? retryError.message : String(retryError),
        })
      }
    }

    // --- Uncensored failover (immediate if flagged dangerous, after same-provider retry otherwise) ---
    if (
      fullResponse.trim().length === 0 &&
      dangerSettings.mode === 'AUTO_ROUTE' &&
      dangerSettings.uncensoredTextProfileId
    ) {
      uncensoredRetryAttempted = true
      logger.warn('[DangerousContent] Empty response detected, attempting uncensored retry', {
        chatId,
        originalProvider: effectiveProfile.provider,
        originalModel: effectiveProfile.modelName,
        contentWasFlaggedDangerous,
        sameProviderRetryAttempted,
      })

      try {
        const routeResult = await resolveProviderForDangerousContent(
          effectiveProfile,
          effectiveApiKey,
          dangerSettings,
          userId
        )

        // Skip if routing resolved to the same profile (pointless retry)
        if (routeResult.rerouted && routeResult.connectionProfile.id === effectiveProfile.id) {
          logger.debug('[DangerousContent] Uncensored fallback resolved to same profile, skipping retry', {
            chatId,
            profileId: effectiveProfile.id,
          })
        } else if (routeResult.rerouted) {
          safeEnqueue(controller, encodeStatusEvent(encoder, {
            stage: 'rerouting',
            message: 'Retrying with uncensored provider...',
            characterName: character.name,
            characterId: character.id,
          }))

          // Re-stream with uncensored provider
          for await (const chunk of streamMessage({
            messages: formattedMessages,
            connectionProfile: routeResult.connectionProfile,
            apiKey: routeResult.apiKey,
            modelParams,
            tools: actualTools,
            useNativeWebSearch,
            userId,
            messageId: preGeneratedAssistantMessageId,
            chatId,
          })) {
            if (chunk.content) {
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

          if (fullResponse.trim().length > 0) {
            effectiveProfile = routeResult.connectionProfile
            effectiveApiKey = routeResult.apiKey

            logger.info('[DangerousContent] Uncensored retry succeeded', {
              chatId,
              uncensoredProvider: routeResult.connectionProfile.provider,
              uncensoredModel: routeResult.connectionProfile.modelName,
              responseLength: fullResponse.length,
            })
          } else {
            logger.error('[DangerousContent] Both safe and uncensored providers returned empty', {
              chatId,
              safeProvider: connectionProfile.provider,
              safeModel: connectionProfile.modelName,
              uncensoredProvider: routeResult.connectionProfile.provider,
              uncensoredModel: routeResult.connectionProfile.modelName,
            })
          }
        }
      } catch (retryError) {
        logger.error('[DangerousContent] Uncensored retry failed', {
          chatId,
          error: retryError instanceof Error ? retryError.message : String(retryError),
        })
      }
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
    const cleanedResponse = stripCharacterNamePrefix(normalizedResponse, character.name, character.aliases)

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
      preGeneratedAssistantMessageId,
      effectiveProfile.provider,
      effectiveProfile.modelName
    )

    // ============================================================================
    // Async Pre-Compression: Start EARLY for next message
    // ============================================================================
    // Trigger compression as soon as we have the response, BEFORE memory extraction
    // and other async work. This gives maximum time for compression to complete
    // before the user sends their next message.
    if (compressionEnabled && cheapLLMSelection && builtContext.originalSystemPrompt) {
      const updatedMessages = [
        // Extract only visible conversation (USER/ASSISTANT, tool artifacts stripped)
        ...extractVisibleConversation(existingMessages),
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
        participantId: isMultiCharacter ? characterParticipant.id : undefined,
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
          dangerSettings,
          availableProfiles: allProfiles,
        },
      })
    }

    // Track token usage for profile and chat aggregates
    if (usage && (usage.promptTokens || usage.completionTokens)) {
      // Estimate cost using available pricing data
      const costResult = await estimateMessageCost(
        effectiveProfile.provider,
        effectiveProfile.modelName,
        usage.promptTokens || 0,
        usage.completionTokens || 0,
        userId
      )
      await trackMessageTokenUsage(chatId, effectiveProfile.id, usage, costResult.cost, costResult.source)
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
      participantId: characterParticipant.id,
      usage,
      cacheUsage,
      attachmentResults,
      toolsExecuted: toolMessages.length > 0,
      turn: turnInfo,
      provider: effectiveProfile.provider,
      modelName: effectiveProfile.modelName,
      isSilentMessage: characterParticipant.status === 'silent' || undefined,
    }))

    // Trigger memory extraction
    if (chatSettings) {
      const memoryChatSettings: MemoryChatSettings = {
        cheapLLMSettings: chatSettings.cheapLLMSettings,
        dangerSettings,
        isDangerousChat: chat.isDangerousChat === true,
      }

      // Build pronouns map for multi-character chats
      const allCharacterPronouns = isMultiCharacter
        ? Object.fromEntries(Array.from(participantCharacters.values()).map(c => [c.name, c.pronouns ?? null]))
        : undefined

      await triggerMemoryExtraction(repos, {
        characterId: character.id,
        characterName: character.name,
        characterPronouns: character.pronouns,
        personaName: resolvedIdentity.name !== 'User' ? resolvedIdentity.name : undefined,
        userCharacterId,
        allCharacterNames: isMultiCharacter ? Array.from(participantCharacters.values()).map(c => c.name) : undefined,
        allCharacterPronouns,
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

      // Trigger chat-level danger classification (runs after context summary in job queue)
      await triggerChatDangerClassification(repos, {
        chatId,
        userId,
        connectionProfile,
        chatSettings: memoryChatSettings,
      })

      // Trigger scene state tracking (single-character chats only;
      // multi-character chats trigger once after the chain completes)
      if (!isMultiCharacter) {
        const participantCharacterIds = Array.from(participantCharacters.values()).map(c => c.id)
        await triggerSceneStateTracking(repos, {
          chatId,
          userId,
          connectionProfile,
          chatSettings: memoryChatSettings,
          characterIds: participantCharacterIds,
        })
      }
    }
    return {
      isMultiCharacter,
      hasContent: true,
      messageId: assistantMessageId,
      userParticipantId,
      isPaused: chat.isPaused,
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
      participantId: characterParticipant.id,
      usage,
      cacheUsage,
      attachmentResults,
      toolsExecuted: true,
      provider: effectiveProfile.provider,
      modelName: effectiveProfile.modelName,
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
    let emptyReason: string
    if (uncensoredRetryAttempted && sameProviderRetryAttempted) {
      emptyReason = 'The AI model returned an empty response after retrying, and an uncensored provider also returned empty. This may indicate the content was filtered by both providers.'
    } else if (uncensoredRetryAttempted) {
      emptyReason = 'The AI model returned an empty response, and retrying with an uncensored provider also returned empty. This may indicate the content was filtered by both providers.'
    } else if (sameProviderRetryAttempted) {
      emptyReason = 'The AI model returned an empty response twice. This may be a temporary issue with the provider. Please try resending your message.'
    } else {
      emptyReason = 'The AI model returned an empty response. This is a known issue with some providers. Please try resending your message.'
    }
    logger.warn(`Empty response for chat ${chatId}`, {
      uncensoredRetryAttempted,
      sameProviderRetryAttempted,
      provider: effectiveProfile.provider,
      model: effectiveProfile.modelName,
    })
    controller.enqueue(encodeDoneEvent(encoder, {
      messageId: null,
      participantId: characterParticipant.id,
      usage,
      cacheUsage,
      attachmentResults,
      toolsExecuted: false,
      emptyResponse: true,
      emptyResponseReason: emptyReason,
      provider: effectiveProfile.provider,
      modelName: effectiveProfile.modelName,
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
 * Save assistant message to the chat
 */
async function saveAssistantMessage(
  repos: ReturnType<typeof getRepositories>,
  chatId: string,
  character: { id: string; name: string },
  characterParticipant: { id: string; status?: string },
  content: string,
  usage: { promptTokens?: number; completionTokens?: number; totalTokens?: number } | null,
  rawResponse: unknown,
  thoughtSignature: string | undefined,
  generatedImagePaths: GeneratedImage[],
  toolMessages: ToolMessage[],
  preGeneratedMessageId?: string,
  provider?: string,
  modelName?: string
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
    provider: provider || null,
    modelName: modelName || null,
    isSilentMessage: characterParticipant.status === 'silent' || null,
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
