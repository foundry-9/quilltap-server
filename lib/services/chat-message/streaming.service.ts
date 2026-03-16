/**
 * Streaming Service
 *
 * Handles the streaming response from LLM providers,
 * including chunk processing and stream management.
 */

import { createServiceLogger } from '@/lib/logging/create-logger'
import { createLLMProvider, type LLMMessage } from '@/lib/llm'
import { buildToolsForProvider, checkModelSupportsTools } from '@/lib/tools'
import { isShellEnvironment } from '@/lib/paths'
import { getRepositories } from '@/lib/repositories/factory'
import { logLLMCall } from '@/lib/services/llm-logging.service'
import { normalizeContentBlockFormat } from '@/lib/llm/message-formatter'
import type { ConnectionProfile, ImageProfile } from '@/lib/schemas/types'
import type { BuiltContext } from '@/lib/chat/context-manager'
import type { FallbackResult } from '@/lib/chat/file-attachment-fallback'
import type { StreamingResult } from './types'

const logger = createServiceLogger('StreamingService')

/**
 * LLM streaming options
 */
export interface StreamOptions {
  messages: Array<{
    role: string
    content: string
    attachments?: unknown[]
    name?: string
    thoughtSignature?: string
    toolCallId?: string
    toolCalls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>
  }>
  connectionProfile: ConnectionProfile
  apiKey: string
  modelParams: Record<string, unknown>
  tools: unknown[]
  useNativeWebSearch: boolean
  userId?: string
  messageId?: string
  chatId?: string
  characterId?: string
  /** Previous response ID for conversation chaining (OpenAI Responses API) */
  previousResponseId?: string
}

/**
 * Debug info to send at start of stream
 */
export interface StreamDebugInfo {
  builtContext: BuiltContext
  connectionProfile: ConnectionProfile
  modelParams: Record<string, unknown>
  messages: Array<{ role: string; contentLength: number; hasAttachments: boolean }>
  tools: unknown[]
  enabledToolOptions?: Record<string, boolean>
  fallbackResults?: FallbackResult[]
}

/**
 * Stream chunk callback
 */
export type StreamChunkCallback = (chunk: {
  content?: string
  done?: boolean
  usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number }
  cacheUsage?: { cacheCreationInputTokens?: number; cacheReadInputTokens?: number }
  attachmentResults?: { sent: string[]; failed: { id: string; error: string }[] }
  rawResponse?: unknown
  thoughtSignature?: string
}) => void

/**
 * Metadata about a tool's source for hierarchical filtering
 */
interface ToolSourceMetadata {
  pluginName?: string
  subgroupId?: string
}

/**
 * Check if a tool is disabled based on individual tool disabling or group patterns
 *
 * @param toolId The tool's ID (function name)
 * @param disabledTools List of individually disabled tool IDs
 * @param disabledToolGroups List of disabled group patterns (e.g., "plugin:mcp", "plugin:mcp:subgroup:filesystem")
 * @param sourceMetadata Metadata about the tool's source (plugin name, subgroup)
 * @returns true if the tool is disabled
 */
function isToolDisabled(
  toolId: string,
  disabledTools: string[],
  disabledToolGroups: string[],
  sourceMetadata: ToolSourceMetadata
): boolean {
  // Never disable request_full_context - it's a critical safety valve
  if (toolId === 'request_full_context') return false

  // Check individual tool disable
  if (disabledTools.includes(toolId)) return true

  // Check plugin-level disable: "plugin:{pluginName}"
  if (sourceMetadata.pluginName) {
    if (disabledToolGroups.includes(`plugin:${sourceMetadata.pluginName}`)) {
      return true
    }

    // Check subgroup-level disable: "plugin:{pluginName}:subgroup:{subgroupId}"
    if (sourceMetadata.subgroupId) {
      if (disabledToolGroups.includes(`plugin:${sourceMetadata.pluginName}:subgroup:${sourceMetadata.subgroupId}`)) {
        return true
      }
    }
  }

  return false
}

/**
 * Build tools for the provider
 */
export async function buildTools(
  connectionProfile: ConnectionProfile,
  imageProfileId: string | null,
  imageProfile: ImageProfile | null,
  userId: string,
  /** Project ID if chat is associated with a project (enables project_info tool) */
  projectId?: string | null,
  /** Whether context compression is enabled (enables request_full_context tool) */
  requestFullContext?: boolean,
  /** List of tool IDs to disable (or undefined to return empty tools for this message) */
  disabledTools?: string[],
  /** List of disabled group patterns (e.g., "plugin:mcp", "plugin:mcp:subgroup:filesystem") */
  disabledToolGroups?: string[],
  /** Whether agent mode is enabled (enables submit_final_response tool) */
  agentModeEnabled?: boolean,
  /** Whether this is a multi-character chat (enables whisper tool) */
  isMultiCharacter?: boolean,
  /** Whether help tools are enabled for this character (enables help_search and help_settings) */
  helpToolsEnabled?: boolean
): Promise<{
  tools: unknown[]
  modelSupportsNativeTools: boolean
  useNativeWebSearch: boolean
}> {
  const provider = await createLLMProvider(
    connectionProfile.provider,
    connectionProfile.baseUrl || undefined
  )

  const modelSupportsNativeTools = await checkModelSupportsTools(
    connectionProfile.provider,
    connectionProfile.modelName,
    userId
  )

  // Native web search requires both the profile setting AND provider support
  const useNativeWebSearch = connectionProfile.useNativeWebSearch && provider.supportsWebSearch

  // Profile-level tool override - if allowToolUse is explicitly false, skip all tools
  if (connectionProfile.allowToolUse === false) {
    logger.debug('Tools disabled by connection profile setting', {
      context: 'chat-message.buildTools',
      profileId: connectionProfile.id,
      profileName: connectionProfile.name,
    });
    return { tools: [], modelSupportsNativeTools, useNativeWebSearch }
  }

  // Fetch user's plugin tool configurations from database
  let toolConfigs = new Map<string, Record<string, unknown>>()
  try {
    const repos = getRepositories()
    const userPluginConfigs = await repos.pluginConfigs.findByUserId(userId)
    for (const config of userPluginConfigs) {
      // Extract tool name from plugin name (e.g., 'qtap-plugin-curl' -> 'curl')
      const toolName = config.pluginName.replace(/^qtap-plugin-/, '')
      toolConfigs.set(toolName, config.config)
    }

  } catch (configError) {
    logger.warn('Failed to load plugin tool configs, using defaults', {
      userId,
      error: configError instanceof Error ? configError.message : String(configError),
    })
  }

  // If disabledTools is undefined (not an array), skip tools entirely for this message
  // This is a legacy fallback - tools are now always sent with every prompt
  if (disabledTools === undefined) {
    return { tools: [], modelSupportsNativeTools, useNativeWebSearch }
  }

  // Web search tool is independent of native web search - user can enable both
  let tools = await buildToolsForProvider(connectionProfile.provider, {
    imageGeneration: !!imageProfileId,
    imageProviderType: imageProfile?.provider,
    memorySearch: true,
    webSearch: connectionProfile.allowWebSearch,
    projectInfo: !!projectId,
    requestFullContext: !!requestFullContext,
    agentMode: !!agentModeEnabled,
    helpSearch: !!helpToolsEnabled,
    helpSettings: !!helpToolsEnabled,
    whisper: !!isMultiCharacter,
    shellInteractivity: isShellEnvironment(),
    toolConfigs,
  })

  // Filter out disabled tools (individual IDs and group patterns)
  const hasDisabledTools = disabledTools.length > 0
  const hasDisabledGroups = disabledToolGroups && disabledToolGroups.length > 0

  if (hasDisabledTools || hasDisabledGroups) {
    // Build a map of tool name -> source metadata for group filtering
    // We need to know which plugin/subgroup each tool came from
    const toolSourceMap = new Map<string, ToolSourceMetadata>()

    // Get hierarchy info from all plugins that support it
    const allPlugins = (await import('@/lib/plugins/tool-registry')).toolRegistry.getAllPlugins()
    for (const plugin of allPlugins) {
      if (typeof plugin.getToolHierarchy === 'function') {
        try {
          const pluginName = plugin.metadata.toolName
          const config = toolConfigs.get(pluginName) || {}
          const hierarchy = await plugin.getToolHierarchy(config)

          for (const info of hierarchy) {
            toolSourceMap.set(info.toolId, {
              pluginName,
              subgroupId: info.subgroupId,
            })
          }
        } catch (err) {
          logger.warn('Failed to get tool hierarchy for filtering', {
            plugin: plugin.metadata.toolName,
            error: err instanceof Error ? err.message : String(err),
          })
        }
      }
    }

    const originalCount = tools.length
    tools = tools.filter((tool: unknown) => {
      // Get tool name from the tool object (handle different formats)
      const toolObj = tool as { function?: { name?: string }; name?: string }
      const toolName = toolObj.function?.name || toolObj.name
      if (!toolName) return true // Keep tools without names

      // Get source metadata for this tool (may be empty for built-in tools)
      const sourceMetadata = toolSourceMap.get(toolName) || {}

      // Check if tool is disabled (handles both individual and group patterns)
      return !isToolDisabled(
        toolName,
        disabledTools,
        disabledToolGroups || [],
        sourceMetadata
      )
    })

  }

  return { tools, modelSupportsNativeTools, useNativeWebSearch }
}

/**
 * Stream a message from the LLM
 */
export async function* streamMessage(
  options: StreamOptions
): AsyncGenerator<{
  content?: string
  done?: boolean
  usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number }
  cacheUsage?: { cacheCreationInputTokens?: number; cacheReadInputTokens?: number }
  attachmentResults?: { sent: string[]; failed: { id: string; error: string }[] }
  rawResponse?: unknown
  thoughtSignature?: string
}> {
  const { messages, connectionProfile, apiKey, modelParams, tools, useNativeWebSearch, userId, messageId, chatId, characterId, previousResponseId } = options

  const provider = await createLLMProvider(
    connectionProfile.provider,
    connectionProfile.baseUrl || undefined
  )

  // Cast messages to LLMMessage[] - the role type is constrained to valid values
  const llmMessages = messages.map(m => ({
    role: m.role as 'system' | 'user' | 'assistant' | 'tool',
    content: m.content,
    attachments: m.attachments,
    name: m.name,
    thoughtSignature: m.thoughtSignature,
    toolCallId: m.toolCallId,
    toolCalls: m.toolCalls,
  })) as LLMMessage[]

  // Track timing and accumulated content
  const startTime = Date.now()
  let chunkCount = 0
  let totalContentLength = 0
  let accumulatedContent = ''
  let lastUsage: { promptTokens?: number; completionTokens?: number; totalTokens?: number } | undefined
  let lastCacheUsage: { cacheCreationInputTokens?: number; cacheReadInputTokens?: number } | undefined

  for await (const chunk of provider.streamMessage(
    {
      messages: llmMessages,
      model: connectionProfile.modelName,
      temperature: modelParams.temperature as number | undefined,
      maxTokens: modelParams.maxTokens as number | undefined,
      topP: modelParams.topP as number | undefined,
      tools: tools.length > 0 ? tools : undefined,
      webSearchEnabled: useNativeWebSearch,
      profileParameters: modelParams,
      previousResponseId,
    },
    apiKey
  )) {
    chunkCount++
    if (chunk.content) {
      // Normalize content that may be wrapped in content block format
      // e.g., [{'type': 'text', 'text': "actual content"}]
      const normalizedContent = normalizeContentBlockFormat(chunk.content)
      if (normalizedContent !== chunk.content) {
        chunk.content = normalizedContent
      }
      totalContentLength += chunk.content.length
      accumulatedContent += chunk.content
    }
    if (chunk.usage) {
      lastUsage = chunk.usage
    }
    if (chunk.cacheUsage) {
      lastCacheUsage = chunk.cacheUsage
    }
    if (chunk.done) {

      // Log the LLM call if userId is provided
      if (userId) {
        const durationMs = Date.now() - startTime

        logLLMCall({
          userId,
          type: 'CHAT_MESSAGE',
          messageId,
          chatId,
          characterId,
          provider: connectionProfile.provider,
          modelName: connectionProfile.modelName,
          request: {
            messages: llmMessages.map(m => ({
              role: m.role,
              content: m.content,
              attachments: m.attachments,
            })),
            temperature: modelParams.temperature as number | undefined,
            maxTokens: modelParams.maxTokens as number | undefined,
            tools: tools.length > 0 ? tools : undefined,
          },
          response: {
            content: accumulatedContent,
          },
          usage: lastUsage,
          cacheUsage: lastCacheUsage,
          durationMs,
        }).catch(err => {
          logger.warn('Failed to log LLM call from streaming service', {
            userId,
            error: err instanceof Error ? err.message : String(err),
          })
        })
      }
    }
    yield chunk
  }
}

/**
 * Send debug info at start of stream
 */
export function encodeDebugInfo(
  encoder: TextEncoder,
  debugInfo: StreamDebugInfo
): Uint8Array {
  const { builtContext, connectionProfile, modelParams, messages, tools } = debugInfo

  const llmRequestDetails = {
    provider: connectionProfile.provider,
    model: connectionProfile.modelName,
    temperature: modelParams.temperature,
    maxTokens: modelParams.maxTokens,
    topP: modelParams.topP,
    messageCount: messages.length,
    hasTools: tools.length > 0,
    tools: tools.length > 0 ? tools : undefined,
    messages: messages,
    contextManagement: {
      tokenUsage: builtContext.tokenUsage,
      budget: {
        total: builtContext.budget.totalLimit,
        responseReserve: builtContext.budget.responseReserve,
      },
      memoriesIncluded: builtContext.memoriesIncluded,
      messagesIncluded: builtContext.messagesIncluded,
      messagesTruncated: builtContext.messagesTruncated,
      includedSummary: builtContext.includedSummary,
      debugMemories: builtContext.debugMemories,
      debugSummary: builtContext.debugSummary,
      debugSystemPrompt: builtContext.debugSystemPrompt,
    },
  }

  return encoder.encode(`data: ${JSON.stringify({ debugLLMRequest: llmRequestDetails })}\n\n`)
}

/**
 * Send fallback processing info
 */
export function encodeFallbackInfo(
  encoder: TextEncoder,
  fallbackResults: FallbackResult[]
): Uint8Array {
  const fallbackInfo = fallbackResults.map((result) => ({
    filename: result.processingMetadata?.originalFilename || 'Unknown',
    type: result.type,
    usedImageDescriptionLLM: result.processingMetadata?.usedImageDescriptionLLM || false,
    error: result.error,
  }))

  return encoder.encode(`data: ${JSON.stringify({ fileProcessing: fallbackInfo })}\n\n`)
}

/**
 * Encode a content chunk
 */
export function encodeContentChunk(encoder: TextEncoder, content: string): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify({ content })}\n\n`)
}

/**
 * Encode the done event
 */
export function encodeDoneEvent(
  encoder: TextEncoder,
  data: {
    messageId: string | null
    participantId?: string | null
    usage: { promptTokens?: number; completionTokens?: number; totalTokens?: number } | null
    cacheUsage: { cacheCreationInputTokens?: number; cacheReadInputTokens?: number } | null
    attachmentResults: { sent: string[]; failed: { id: string; error: string }[] } | null
    toolsExecuted: boolean
    turn?: {
      nextSpeakerId: string | null
      reason: string
      cycleComplete: boolean
      isUsersTurn: boolean
    }
    emptyResponse?: boolean
    emptyResponseReason?: string
    provider?: string
    modelName?: string
  }
): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify({ done: true, ...data })}\n\n`)
}

/**
 * Encode an error event
 */
export function encodeErrorEvent(
  encoder: TextEncoder,
  error: string,
  errorType: string,
  details: string
): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify({ error, errorType, details })}\n\n`)
}

/**
 * Encode a keep-alive/heartbeat ping
 * SSE comment lines (starting with :) are ignored by clients but keep the connection alive
 */
export function encodeKeepAlive(encoder: TextEncoder): Uint8Array {
  return encoder.encode(': keep-alive\n\n')
}

/**
 * Encode a status update event for UI feedback during response generation
 */
export function encodeStatusEvent(
  encoder: TextEncoder,
  status: {
    stage: string
    message: string
    toolName?: string
    characterName?: string
    characterId?: string
  }
): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify({ status })}\n\n`)
}

/**
 * Encode a turn start event (chained character about to respond)
 */
export function encodeTurnStartEvent(
  encoder: TextEncoder,
  data: { participantId: string; characterName: string; chainDepth: number }
): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify({ turnStart: true, ...data })}\n\n`)
}

/**
 * Encode a turn complete event (chained character finished responding)
 */
export function encodeTurnCompleteEvent(
  encoder: TextEncoder,
  data: { participantId: string; messageId: string; chainDepth: number }
): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify({ turnComplete: true, ...data })}\n\n`)
}

/**
 * Encode a chain complete event (all chained turns done)
 */
export function encodeChainCompleteEvent(
  encoder: TextEncoder,
  data: {
    reason: 'user_turn' | 'paused' | 'max_depth' | 'max_time' | 'error' | 'no_next_speaker' | 'cycle_complete'
    nextSpeakerId: string | null
    chainDepth: number
  }
): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify({ chainComplete: true, ...data })}\n\n`)
}

/**
 * Safely enqueue data to a stream controller
 * Returns true if successful, false if the controller is already closed
 */
export function safeEnqueue(
  controller: ReadableStreamDefaultController<Uint8Array>,
  data: Uint8Array
): boolean {
  try {
    controller.enqueue(data)
    return true
  } catch (error) {
    // Controller is already closed (client disconnected, timeout, etc.)

    return false
  }
}

/**
 * Safely close a stream controller
 */
export function safeClose(controller: ReadableStreamDefaultController<Uint8Array>): void {
  try {
    controller.close()
  } catch {
    // Already closed - ignore
  }
}

/**
 * Create streaming response result
 */
export function createStreamingResult(
  fullResponse: string,
  usage: { promptTokens?: number; completionTokens?: number; totalTokens?: number } | null,
  cacheUsage: { cacheCreationInputTokens?: number; cacheReadInputTokens?: number } | null,
  attachmentResults: { sent: string[]; failed: { id: string; error: string }[] } | null,
  rawResponse: unknown,
  thoughtSignature?: string
): StreamingResult {
  return {
    fullResponse,
    usage,
    cacheUsage,
    attachmentResults,
    rawResponse,
    thoughtSignature,
  }
}
