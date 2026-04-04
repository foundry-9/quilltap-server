/**
 * Anthropic Provider Implementation for Quilltap Plugin
 *
 * Provides chat completion functionality using Anthropic's Claude API
 * Supports Claude models with multimodal capabilities (text + images + PDFs)
 */

import Anthropic from '@anthropic-ai/sdk'
import type { TextProvider, LLMParams, LLMResponse, StreamChunk, LLMMessage, ImageGenParams, ImageGenResponse } from './types'
import { createPluginLogger, getQuilltapUserAgent } from '@quilltap/plugin-utils'

const logger = createPluginLogger('qtap-plugin-anthropic')

// Anthropic supports images, PDFs, and plain text documents
const ANTHROPIC_SUPPORTED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'application/pdf',
  'text/plain',
]

type ImageMediaType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'

// Cache control type for prompt caching
// TTL: '5m' = 5 minutes (default, 1.25x write cost), '1h' = 1 hour (2x write cost)
// Reads are always 0.1x the base input token cost
type CacheControl = { type: 'ephemeral'; ttl?: '5m' | '1h' }

// Content blocks with optional cache_control
type AnthropicContentBlock =
  | { type: 'text'; text: string; cache_control?: CacheControl }
  | { type: 'image'; source: { type: 'base64'; media_type: ImageMediaType; data: string }; cache_control?: CacheControl }
  | { type: 'document'; source: { type: 'base64'; media_type: 'application/pdf'; data: string }; cache_control?: CacheControl }
  | { type: 'document'; source: { type: 'text'; media_type: 'text/plain'; data: string }; cache_control?: CacheControl }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string }

interface AnthropicMessage {
  role: 'user' | 'assistant'
  content: string | AnthropicContentBlock[]
}

// Anthropic profile parameters for cache control
interface AnthropicProfileParams {
  enableCacheBreakpoints?: boolean
  cacheStrategy?: 'system_only' | 'system_and_long_context'
  cacheTTL?: '5m' | '1h'
}

export class AnthropicProvider implements TextProvider {
  readonly supportsFileAttachments = true
  readonly supportedMimeTypes = ANTHROPIC_SUPPORTED_MIME_TYPES
  readonly supportsWebSearch = false

  /**
   * Helper to build cache_control object with optional TTL
   * TTL is only included if it's '1h' since '5m' is the default
   */
  private buildCacheControl(ttl?: '5m' | '1h'): CacheControl {
    if (ttl === '1h') {
      return { type: 'ephemeral', ttl: '1h' }
    }
    return { type: 'ephemeral' }
  }

  private formatMessagesWithAttachments(
    messages: LLMMessage[],
    cacheOptions?: { enableCaching: boolean; strategy: 'system_only' | 'system_and_long_context'; ttl?: '5m' | '1h' }
  ): { messages: AnthropicMessage[]; attachmentResults: { sent: string[]; failed: { id: string; error: string }[] } } {
    const sent: string[] = []
    const failed: { id: string; error: string }[] = []

    // Filter out system messages (handled separately in Anthropic)
    // Also filter out tool messages without toolCallId (backward compatibility)
    const nonSystemMessages = messages.filter(m => {
      if (m.role === 'system') return false
      if (m.role === 'tool' && !m.toolCallId) return false
      return true
    })

    // Find last user message index for caching (used in system_and_long_context strategy)
    // Only consider actual user messages, not tool results mapped to user role
    const lastUserMessageIndex = cacheOptions?.enableCaching && cacheOptions.strategy === 'system_and_long_context'
      ? nonSystemMessages.findLastIndex(m => m.role === 'user')
      : -1

    // Build formatted messages, batching consecutive tool results into single user messages
    const formattedMessages: AnthropicMessage[] = []

    for (let i = 0; i < nonSystemMessages.length; i++) {
      const msg = nonSystemMessages[i]

      // Handle tool result messages — batch consecutive ones into a single user message
      if (msg.role === 'tool') {
        const toolResultBlocks: AnthropicContentBlock[] = [
          { type: 'tool_result', tool_use_id: msg.toolCallId!, content: msg.content },
        ]
        // Consume any consecutive tool messages
        while (i + 1 < nonSystemMessages.length && nonSystemMessages[i + 1].role === 'tool') {
          i++
          const nextMsg = nonSystemMessages[i]
          toolResultBlocks.push({
            type: 'tool_result',
            tool_use_id: nextMsg.toolCallId!,
            content: nextMsg.content,
          })
        }
        formattedMessages.push({ role: 'user', content: toolResultBlocks })
        continue
      }

      // Handle assistant messages with toolCalls
      if (msg.role === 'assistant' && msg.toolCalls && msg.toolCalls.length > 0) {
        const content: AnthropicContentBlock[] = []
        if (msg.content) {
          content.push({ type: 'text', text: msg.content })
        }
        for (const tc of msg.toolCalls) {
          let input: Record<string, unknown> = {}
          try {
            input = JSON.parse(tc.function.arguments)
          } catch (e) {
            logger.error('Failed to parse tool call arguments', {
              context: 'AnthropicProvider.formatMessagesWithAttachments',
              toolCallId: tc.id,
              name: tc.function.name,
            }, e instanceof Error ? e : undefined)
          }
          content.push({
            type: 'tool_use',
            id: tc.id,
            name: tc.function.name,
            input,
          })
        }
        formattedMessages.push({ role: 'assistant', content })
        continue
      }

      // Standard user/assistant message handling
      const role = msg.role === 'user' ? 'user' : 'assistant'
      const isLastUserMessage = i === lastUserMessageIndex

      // If no attachments, check if we need to add cache control
      if (!msg.attachments || msg.attachments.length === 0) {
        // For system_and_long_context, add cache_control to the last user message
        if (isLastUserMessage) {
          formattedMessages.push({
            role,
            content: [{
              type: 'text' as const,
              text: msg.content,
              cache_control: this.buildCacheControl(cacheOptions?.ttl),
            }],
          })
        } else {
          formattedMessages.push({
            role,
            content: msg.content,
          })
        }
        continue
      }

      // Build multimodal content array
      const content: AnthropicContentBlock[] = []

      // Add text content first
      if (msg.content) {
        content.push({ type: 'text', text: msg.content })
      }

      // Add file attachments
      for (const attachment of msg.attachments) {
        if (!this.supportedMimeTypes.includes(attachment.mimeType)) {
          failed.push({
            id: attachment.id,
            error: `Unsupported file type: ${attachment.mimeType}. Anthropic supports: ${this.supportedMimeTypes.join(', ')}`,
          })
          continue
        }

        if (!attachment.data) {
          failed.push({
            id: attachment.id,
            error: 'File data not loaded',
          })
          continue
        }

        if (attachment.mimeType === 'application/pdf') {
          // PDF document
          content.push({
            type: 'document',
            source: {
              type: 'base64',
              media_type: attachment.mimeType,
              data: attachment.data,
            },
          })
        } else if (attachment.mimeType === 'text/plain') {
          // Plain text document - use text source type, not base64
          // The data for text files should be the actual text content
          let textContent = attachment.data
          // If the data is base64 encoded, decode it
          if (attachment.data && !attachment.data.includes('\n') && /^[A-Za-z0-9+/=]+$/.test(attachment.data)) {
            try {
              textContent = Buffer.from(attachment.data, 'base64').toString('utf-8')
            } catch {
              // If decoding fails, use the data as-is
              textContent = attachment.data
            }
          }
          content.push({
            type: 'document',
            source: {
              type: 'text',
              media_type: 'text/plain',
              data: textContent,
            },
          })
        } else {
          // Image - mimeType is validated above to be one of the supported image types
          content.push({
            type: 'image',
            source: {
              type: 'base64',
              media_type: attachment.mimeType as ImageMediaType,
              data: attachment.data,
            },
          })
        }
        sent.push(attachment.id)
      }

      // For system_and_long_context, add cache_control to the last content block of the last user message
      if (isLastUserMessage && content.length > 0) {
        const lastBlock = content[content.length - 1]
        content[content.length - 1] = {
          ...lastBlock,
          cache_control: this.buildCacheControl(cacheOptions?.ttl),
        } as AnthropicContentBlock
      }

      formattedMessages.push({
        role,
        content: content.length > 0 ? content : msg.content,
      })
    }

    return { messages: formattedMessages, attachmentResults: { sent, failed } }
  }

  async sendMessage(params: LLMParams, apiKey: string): Promise<LLMResponse> {

    const client = new Anthropic({
      apiKey,
      defaultHeaders: { 'User-Agent': getQuilltapUserAgent() },
    })

    // Anthropic requires system message separate from messages array
    const systemMessage = params.messages.find(m => m.role === 'system')

    // Extract profile parameters for cache control
    const profileParams = params.profileParameters as AnthropicProfileParams | undefined
    const cachingEnabled = profileParams?.enableCacheBreakpoints ?? false
    const cacheStrategy = profileParams?.cacheStrategy || 'system_and_long_context'
    const cacheTTL = profileParams?.cacheTTL

    // Format messages with optional cache control
    const { messages, attachmentResults } = this.formatMessagesWithAttachments(
      params.messages,
      cachingEnabled ? { enableCaching: true, strategy: cacheStrategy, ttl: cacheTTL } : undefined
    )

    const requestParams: any = {
      model: params.model,
      messages,
      max_tokens: params.maxTokens ?? 4096,
    }

    // Handle system message with optional cache control
    if (systemMessage?.content) {
      if (cachingEnabled) {
        // Use array format with cache_control for prompt caching
        // This can reduce costs by 90% for repeated system prompts

        requestParams.system = [{
          type: 'text',
          text: systemMessage.content,
          cache_control: this.buildCacheControl(cacheTTL),
        }]
      } else {
        // Standard string format
        requestParams.system = systemMessage.content
      }
    }

    // Anthropic API requires either temperature OR top_p, not both
    if (params.temperature !== undefined) {
      requestParams.temperature = params.temperature
    } else if (params.topP !== undefined) {
      requestParams.top_p = params.topP
    } else {
      // Default to temperature if neither is specified
      requestParams.temperature = 1.0
    }

    // Build tools array with optional cache control on last tool
    // Tools are cached first in Anthropic's hierarchy: tools → system → messages
    const tools: any[] = params.tools ? [...params.tools] : []

    if (tools.length > 0) {

      // Add cache_control to the last tool when caching is enabled
      if (cachingEnabled) {
        const lastTool = tools[tools.length - 1]
        tools[tools.length - 1] = {
          ...lastTool,
          cache_control: this.buildCacheControl(cacheTTL),
        }

      }

      requestParams.tools = tools
    }

    const response = await client.messages.create(requestParams)

    const content = response.content[0]

    // Extract cache usage if available (when prompt caching is enabled)
    const rawUsage = response.usage as any
    const cacheUsage = (rawUsage.cache_creation_input_tokens !== undefined || rawUsage.cache_read_input_tokens !== undefined)
      ? {
          cacheCreationInputTokens: rawUsage.cache_creation_input_tokens,
          cacheReadInputTokens: rawUsage.cache_read_input_tokens,
        }
      : undefined

    if (cacheUsage) {

    }

    return {
      content: content.type === 'text' ? content.text : '',
      finishReason: response.stop_reason ?? 'stop',
      usage: {
        promptTokens: response.usage.input_tokens,
        completionTokens: response.usage.output_tokens,
        totalTokens: response.usage.input_tokens + response.usage.output_tokens,
      },
      raw: response,
      attachmentResults,
      cacheUsage,
    }
  }

  async *streamMessage(params: LLMParams, apiKey: string): AsyncGenerator<StreamChunk> {

    const client = new Anthropic({
      apiKey,
      defaultHeaders: { 'User-Agent': getQuilltapUserAgent() },
    })

    const systemMessage = params.messages.find(m => m.role === 'system')

    // Extract profile parameters for cache control
    const profileParams = params.profileParameters as AnthropicProfileParams | undefined
    const cachingEnabled = profileParams?.enableCacheBreakpoints ?? false
    const cacheStrategy = profileParams?.cacheStrategy || 'system_and_long_context'
    const cacheTTL = profileParams?.cacheTTL

    // Format messages with optional cache control
    const { messages, attachmentResults } = this.formatMessagesWithAttachments(
      params.messages,
      cachingEnabled ? { enableCaching: true, strategy: cacheStrategy, ttl: cacheTTL } : undefined
    )

    const requestParams: any = {
      model: params.model,
      messages,
      max_tokens: params.maxTokens ?? 4096,
      stream: true,
    }

    // Handle system message with optional cache control
    if (systemMessage?.content) {
      if (cachingEnabled) {
        // Use array format with cache_control for prompt caching

        requestParams.system = [{
          type: 'text',
          text: systemMessage.content,
          cache_control: this.buildCacheControl(cacheTTL),
        }]
      } else {
        // Standard string format
        requestParams.system = systemMessage.content
      }
    }

    // Anthropic API requires either temperature OR top_p, not both
    if (params.temperature !== undefined) {
      requestParams.temperature = params.temperature
    } else if (params.topP !== undefined) {
      requestParams.top_p = params.topP
    } else {
      // Default to temperature if neither is specified
      requestParams.temperature = 1.0
    }

    // Build tools array with optional cache control on last tool
    // Tools are cached first in Anthropic's hierarchy: tools → system → messages
    const tools: any[] = params.tools ? [...params.tools] : []

    if (tools.length > 0) {

      // Add cache_control to the last tool when caching is enabled
      if (cachingEnabled) {
        const lastTool = tools[tools.length - 1]
        tools[tools.length - 1] = {
          ...lastTool,
          cache_control: this.buildCacheControl(cacheTTL),
        }

      }

      requestParams.tools = tools
    }

    const stream = (await client.messages.create(requestParams)) as unknown as AsyncIterable<any>

    let totalInputTokens = 0
    let totalOutputTokens = 0
    let fullContent = ''
    let stopReason: string | null = null
    let messageId: string | null = null
    let model: string | null = null
    let cacheCreationInputTokens: number | undefined
    let cacheReadInputTokens: number | undefined

    // Track all content blocks (text and tool_use) for proper tool call detection
    const contentBlocks: Array<{
      type: 'text' | 'tool_use'
      text?: string
      id?: string
      name?: string
      input?: Record<string, unknown>
      partialJson?: string
    }> = []

    for await (const event of stream) {
      // Handle content_block_start - initializes a new content block
      if (event.type === 'content_block_start') {
        const block = event.content_block
        if (block.type === 'text') {
          contentBlocks[event.index] = { type: 'text', text: block.text || '' }
        } else if (block.type === 'tool_use') {

          contentBlocks[event.index] = {
            type: 'tool_use',
            id: block.id,
            name: block.name,
            input: {},
            partialJson: '',
          }
        }
      }

      // Handle content_block_delta - updates an existing content block
      if (event.type === 'content_block_delta') {
        const delta = event.delta
        const blockIndex = event.index

        if (delta?.type === 'text_delta' && delta?.text) {

          fullContent += delta.text
          // Update the content block
          if (contentBlocks[blockIndex]) {
            contentBlocks[blockIndex].text = (contentBlocks[blockIndex].text || '') + delta.text
          }
          yield {
            content: delta.text,
            done: false,
          }
        } else if (delta?.type === 'input_json_delta' && delta?.partial_json) {
          // Accumulate partial JSON for tool_use blocks
          if (contentBlocks[blockIndex] && contentBlocks[blockIndex].type === 'tool_use') {
            contentBlocks[blockIndex].partialJson = (contentBlocks[blockIndex].partialJson || '') + delta.partial_json

          }
        }
      }

      // Handle content_block_stop - finalize the content block
      if (event.type === 'content_block_stop') {
        const blockIndex = event.index
        const block = contentBlocks[blockIndex]
        // Parse accumulated JSON for tool_use blocks
        if (block && block.type === 'tool_use' && block.partialJson) {
          try {
            block.input = JSON.parse(block.partialJson)

          } catch (e) {
            logger.error('Failed to parse tool use input JSON', {
              context: 'AnthropicProvider.streamMessage',
              index: blockIndex,
              partialJson: block.partialJson,
            }, e instanceof Error ? e : undefined)
          }
          // Clean up partialJson field as it's not part of the API response format
          delete block.partialJson
        }
      }

      // Track usage from message_start event
      if (event.type === 'message_start') {
        totalInputTokens = event.message.usage.input_tokens
        messageId = event.message.id
        model = event.message.model
        // Track cache usage if available
        const rawUsage = event.message.usage as any
        cacheCreationInputTokens = rawUsage.cache_creation_input_tokens
        cacheReadInputTokens = rawUsage.cache_read_input_tokens
      }

      // Track usage and stop reason from message_delta event
      if (event.type === 'message_delta') {
        totalOutputTokens = event.usage.output_tokens
        if (event.delta.stop_reason) {
          stopReason = event.delta.stop_reason
        }
      }

      // Final event
      if (event.type === 'message_stop') {
        // Build cache usage object if available
        const cacheUsage = (cacheCreationInputTokens !== undefined || cacheReadInputTokens !== undefined)
          ? {
              cacheCreationInputTokens,
              cacheReadInputTokens,
            }
          : undefined

        // Count tool_use blocks for logging
        const toolUseCount = contentBlocks.filter(b => b.type === 'tool_use').length

        // Build the full message object for tool call detection
        // Use the tracked content blocks which include both text and tool_use
        const fullMessage = {
          id: messageId,
          type: 'message' as const,
          role: 'assistant' as const,
          content: contentBlocks.length > 0 ? contentBlocks : [{ type: 'text' as const, text: fullContent }],
          model: model,
          stop_reason: stopReason,
          usage: {
            input_tokens: totalInputTokens,
            output_tokens: totalOutputTokens,
          },
        }

        yield {
          content: '',
          done: true,
          usage: {
            promptTokens: totalInputTokens,
            completionTokens: totalOutputTokens,
            totalTokens: totalInputTokens + totalOutputTokens,
          },
          attachmentResults,
          rawResponse: fullMessage,
          cacheUsage,
        }
      }
    }
  }

  async validateApiKey(apiKey: string): Promise<boolean> {
    try {

      const client = new Anthropic({
        apiKey,
        defaultHeaders: { 'User-Agent': getQuilltapUserAgent() },
      })
      // Anthropic doesn't have a direct validation endpoint, so we make a minimal request
      await client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1,
        messages: [{ role: 'user', content: 'test' }],
      })

      return true
    } catch (error) {
      logger.error('Anthropic API key validation failed', { context: 'AnthropicProvider.validateApiKey' }, error instanceof Error ? error : undefined)
      return false
    }
  }

  async getAvailableModels(apiKey: string): Promise<string[]> {

    try {
      const client = new Anthropic({
        apiKey,
        defaultHeaders: { 'User-Agent': getQuilltapUserAgent() },
      })
      const response = await client.models.list()

      // Extract model IDs from the response
      const models: string[] = []
      for await (const model of response) {
        models.push(model.id)
      }

      return models
    } catch (error) {
      logger.error('Failed to fetch Anthropic models from API, using fallback list',
        { context: 'AnthropicProvider.getAvailableModels' },
        error instanceof Error ? error : undefined
      )
      // Fallback to known models if API fails
      const fallbackModels = [
        'claude-opus-4-5-20251101',
        'claude-sonnet-4-5-20250929',
        'claude-haiku-4-5-20251001',
        'claude-opus-4-1-20250805',
        'claude-sonnet-4-20250514',
        'claude-opus-4-20250514',
        'claude-3-7-sonnet-20250219',
        'claude-3-5-haiku-20241022',
        'claude-3-haiku-20240307',
      ]

      return fallbackModels
    }
  }

}
