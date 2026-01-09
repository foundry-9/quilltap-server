/**
 * Streaming Service
 *
 * Handles the streaming response from LLM providers,
 * including chunk processing and stream management.
 */

import { createServiceLogger } from '@/lib/logging/create-logger'
import { createLLMProvider, type LLMMessage } from '@/lib/llm'
import { buildToolsForProvider, checkModelSupportsTools } from '@/lib/tools'
import { getRepositories } from '@/lib/repositories/factory'
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
  }>
  connectionProfile: ConnectionProfile
  apiKey: string
  modelParams: Record<string, unknown>
  tools: unknown[]
  useNativeWebSearch: boolean
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
  usePseudoTools: boolean
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
 * Build tools for the provider
 */
export async function buildTools(
  connectionProfile: ConnectionProfile,
  imageProfileId: string | null,
  imageProfile: ImageProfile | null,
  userId: string,
  usePseudoTools: boolean,
  /** Project ID if chat is associated with a project (enables project_info tool) */
  projectId?: string | null,
  /** Whether context compression is enabled (enables request_full_context tool) */
  requestFullContext?: boolean
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

  if (usePseudoTools) {
    logger.debug('Skipping native tools (using pseudo-tools)', {
      provider: connectionProfile.provider,
      model: connectionProfile.modelName,
    })
    return { tools: [], modelSupportsNativeTools, useNativeWebSearch }
  }

  logger.debug('Building native tools for provider', {
    provider: connectionProfile.provider,
    imageProfileId: !!imageProfileId,
    imageProviderType: imageProfile?.provider,
    memorySearchEnabled: true,
    webSearchToolEnabled: connectionProfile.allowWebSearch,
    projectInfoEnabled: !!projectId,
    requestFullContextEnabled: !!requestFullContext,
    useNativeWebSearch,
  })

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
    logger.debug('Loaded plugin tool configs', {
      userId,
      configCount: toolConfigs.size,
      tools: Array.from(toolConfigs.keys()),
    })
  } catch (configError) {
    logger.warn('Failed to load plugin tool configs, using defaults', {
      userId,
      error: configError instanceof Error ? configError.message : String(configError),
    })
  }

  // Web search tool is independent of native web search - user can enable both
  const tools = buildToolsForProvider(connectionProfile.provider, {
    imageGeneration: !!imageProfileId,
    imageProviderType: imageProfile?.provider,
    memorySearch: true,
    webSearch: connectionProfile.allowWebSearch,
    projectInfo: !!projectId,
    requestFullContext: !!requestFullContext,
    toolConfigs,
  })

  logger.debug('Native tools built successfully', {
    toolCount: tools.length,
    tools: tools.map((t: unknown) => (t as { name?: string; function?: { name?: string } }).name || (t as { function?: { name?: string } }).function?.name || 'unknown'),
  })

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
  const { messages, connectionProfile, apiKey, modelParams, tools, useNativeWebSearch } = options

  const provider = await createLLMProvider(
    connectionProfile.provider,
    connectionProfile.baseUrl || undefined
  )

  // Cast messages to LLMMessage[] - the role type is constrained to valid values
  const llmMessages = messages.map(m => ({
    role: m.role as 'system' | 'user' | 'assistant',
    content: m.content,
    attachments: m.attachments,
    name: m.name,
    thoughtSignature: m.thoughtSignature,
  })) as LLMMessage[]

  // Debug log: LLM request payload
  const requestPayload = {
    messages: llmMessages.map(m => ({
      role: m.role,
      contentLength: m.content?.length || 0,
      hasAttachments: !!(m.attachments && m.attachments.length > 0),
      attachmentCount: m.attachments?.length || 0,
      name: m.name,
      hasThoughtSignature: !!m.thoughtSignature,
    })),
    model: connectionProfile.modelName,
    temperature: modelParams.temperature,
    maxTokens: modelParams.maxTokens,
    topP: modelParams.topP,
    toolCount: tools.length,
    webSearchEnabled: useNativeWebSearch,
  }
  logger.debug('[LLM Request] streaming.service.ts:streamMessage - Sending to provider', {
    context: 'llm-api',
    provider: connectionProfile.provider,
    model: connectionProfile.modelName,
    request: JSON.stringify(requestPayload),
  })
  logger.debug('[LLM Request] Full message contents', {
    context: 'llm-api-verbose',
    provider: connectionProfile.provider,
    model: connectionProfile.modelName,
    messages: JSON.stringify(llmMessages.map(m => ({
      role: m.role,
      content: m.content,
      name: m.name,
    }))),
    tools: tools.length > 0 ? JSON.stringify(tools) : undefined,
  })

  let chunkCount = 0
  let totalContentLength = 0
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
    },
    apiKey
  )) {
    chunkCount++
    if (chunk.content) {
      totalContentLength += chunk.content.length
    }
    if (chunk.usage) {
      lastUsage = chunk.usage
    }
    if (chunk.cacheUsage) {
      lastCacheUsage = chunk.cacheUsage
    }
    if (chunk.done) {
      logger.debug('[LLM Response] streaming.service.ts:streamMessage - Stream complete', {
        context: 'llm-api',
        provider: connectionProfile.provider,
        model: connectionProfile.modelName,
        chunkCount,
        totalContentLength,
        usage: lastUsage ? JSON.stringify(lastUsage) : undefined,
        cacheUsage: lastCacheUsage ? JSON.stringify(lastCacheUsage) : undefined,
        hasThoughtSignature: !!chunk.thoughtSignature,
      })
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
  const { builtContext, connectionProfile, modelParams, messages, tools, usePseudoTools, enabledToolOptions } = debugInfo

  const llmRequestDetails = {
    provider: connectionProfile.provider,
    model: connectionProfile.modelName,
    temperature: modelParams.temperature,
    maxTokens: modelParams.maxTokens,
    topP: modelParams.topP,
    messageCount: messages.length,
    hasTools: tools.length > 0,
    tools: tools.length > 0 ? tools : undefined,
    usePseudoTools,
    pseudoToolsEnabled: usePseudoTools && enabledToolOptions
      ? Object.entries(enabledToolOptions)
          .filter(([, enabled]) => enabled)
          .map(([name]) => name)
      : undefined,
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
    logger.debug('Stream controller closed, enqueue skipped', {
      error: error instanceof Error ? error.message : String(error),
    })
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
