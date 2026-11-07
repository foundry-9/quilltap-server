/**
 * Anthropic Provider Implementation for Quilltap Plugin
 *
 * Provides chat completion functionality using Anthropic's Claude API
 * Supports Claude models with multimodal capabilities (text + images + PDFs)
 */

import Anthropic from '@anthropic-ai/sdk'
import type { TextProvider, LLMParams, LLMResponse, StreamChunk, LLMMessage, ImageGenParams, ImageGenResponse } from './types'
import { buildSdkClientOptions, createPluginLogger, getQuilltapUserAgent } from '@quilltap/plugin-utils'

const logger = createPluginLogger('qtap-plugin-anthropic')

/**
 * Headers every Anthropic client in this plugin sends. The `anthropic-version`
 * header is left to the SDK (2026-10-21 since SDK 1.0), which rejects
 * `temperature`, `top_p` and `top_k` on every model and refuses a `document`
 * block placed directly in an assistant message. The plugin therefore sends
 * no sampling parameters, and `formatMessagesWithAttachments` moves assistant
 * documents into a user turn.
 */
function clientHeaders(): Record<string, string> {
  return {
    'User-Agent': getQuilltapUserAgent(),
  }
}

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

/**
 * A text-file attachment's `data` may hold either the raw text or a base64
 * encoding of it. `Buffer.from(s, 'base64')` never throws — it silently mangles
 * non-base64 input (`"hello"` → garbage, `"x=1"` → empty) — so a bare try/catch
 * can't tell the two apart. Round-trip instead: decode, re-encode, and compare
 * (normalizing padding/whitespace). A match means the input really was base64,
 * so return the decoded text; a mismatch means it was plain text all along, so
 * return it verbatim.
 */
function decodeBase64Text(data: string): string {
  const normalize = (s: string): string => s.replace(/\s+/g, '').replace(/=+$/, '')
  const decoded = Buffer.from(data, 'base64')
  if (normalize(decoded.toString('base64')) === normalize(data)) {
    return decoded.toString('utf-8')
  }
  return data
}

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
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown>; cache_control?: CacheControl }
  | { type: 'tool_result'; tool_use_id: string; content: string; cache_control?: CacheControl }

interface AnthropicMessage {
  role: 'user' | 'assistant'
  content: string | AnthropicContentBlock[]
}

// Anthropic profile parameters for cache control and extended thinking
interface AnthropicProfileParams {
  enableCacheBreakpoints?: boolean
  cacheStrategy?: 'system_only' | 'system_and_long_context'
  cacheTTL?: '5m' | '1h'
  // Extended thinking: number of budget tokens (min 1024). When set, enables thinking mode.
  thinkingBudget?: number
  // Alternative flag: enables thinking with a default 4096-token budget.
  extendedThinking?: boolean
}

// Per-character caching is handled here via content-hashed `cache_control`
// breakpoints in `buildCacheControl` and the message-formatting path —
// `params.cacheKey` (Quilltap's per-character routing hint for OpenAI / Grok /
// DeepSeek) is intentionally unused.
export class AnthropicProvider implements TextProvider {
  readonly supportsFileAttachments = true
  readonly supportedMimeTypes = ANTHROPIC_SUPPORTED_MIME_TYPES
  readonly supportsWebSearch = false

  // Models that reject fixed-budget thinking (`thinking.type: "enabled"` with
  // `budget_tokens` returns 400) and take adaptive thinking instead: Claude
  // Sonnet 5, Claude Opus 5, the Opus 4.7/4.8 family, Fable and Mythos.
  // Matched by prefix since these are stable aliases (no dated snapshots).
  // Older models (Haiku 4.5, Sonnet 4.5, ...) still need `budget_tokens`.
  private static readonly BUDGET_THINKING_REJECTED_MODELS = [
    /^claude-sonnet-5(-|$)/,
    /^claude-opus-5(-|$)/,
    /^claude-opus-4-7(-|$)/,
    /^claude-opus-4-8(-|$)/,
    /^claude-fable-5(-|$)/,
    /^claude-mythos-5(-|$)/,
    /^claude-mythos-preview(-|$)/,
  ]

  private modelRejectsBudgetThinking(model: string): boolean {
    return AnthropicProvider.BUDGET_THINKING_REJECTED_MODELS.some(re => re.test(model))
  }

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

  /**
   * Anthropic refuses a request carrying more than four `cache_control`
   * breakpoints across tools, system and messages.
   */
  private static readonly MAX_CACHE_BREAKPOINTS = 4

  /**
   * Mark the last cacheable content block of `messages[index]` with a
   * `cache_control` breakpoint, lifting string content to a single text block
   * (Anthropic tokenizes the two forms identically, so the lift does not move
   * the cached prefix). Returns false when the message has nothing to mark.
   */
  private markBreakpoint(messages: AnthropicMessage[], index: number, ttl?: '5m' | '1h'): boolean {
    const target = messages[index]
    if (!target) return false
    const targetContent = target.content

    if (typeof targetContent === 'string') {
      if (targetContent.length === 0) return false
      messages[index] = {
        role: target.role,
        content: [{ type: 'text', text: targetContent, cache_control: this.buildCacheControl(ttl) }],
      }
      return true
    }

    if (Array.isArray(targetContent) && targetContent.length > 0) {
      const lastBlock = targetContent[targetContent.length - 1]
      if (lastBlock.cache_control) return true
      const updatedContent = [...targetContent]
      updatedContent[updatedContent.length - 1] = {
        ...lastBlock,
        cache_control: this.buildCacheControl(ttl),
      } as AnthropicContentBlock
      messages[index] = { ...target, content: updatedContent }
      return true
    }
    return false
  }

  /** Count the breakpoints already placed in the message array. */
  private countMessageBreakpoints(messages: AnthropicMessage[]): number {
    let count = 0
    for (const m of messages) {
      if (Array.isArray(m.content)) {
        for (const block of m.content) {
          if (block.cache_control) count++
        }
      }
    }
    return count
  }

  /**
   * Place the conversation breakpoints for `system_and_long_context`.
   *
   * **The newest line is never marked.** A Salon turn's newest user line
   * carries that turn's trailing context sections (recall, Core whisper, the
   * line being answered, …), which are gone from the next turn's copy of it,
   * so an entry written there is never read. It is the last *real* user
   * message — one that is not just tool results — and need not be the final
   * message: a multi-character `[Name]` prefill or a tool loop can follow it.
   *
   * **History breakpoints**, in order of worth:
   *  1. in a tool loop, the final message (the latest tool results), which
   *     every later step of the turn repeats;
   *  2. the previous reply: the message before the run of user messages that
   *     ends in the newest line. Live on Friday the old `length - 2` rule
   *     marked the last of the whispers that precede the newest line; those
   *     are swept and replaced on later turns, so the entry was never read and
   *     reads stalled at an older prefix while the history grew;
   *  3. the message just before the newest line, when it is not the previous
   *     reply — whispers that are recorded and recur do get read back;
   *  4. a stepped mid-history breakpoint on long arrays. On a long array the
   *     previous turn's tail can fall outside Anthropic's 20-block lookback
   *     from the new one; its index is rounded down to a multiple of
   *     MID_BREAKPOINT_STEP so it stays on the same block for several turns.
   *
   * A lone message keeps its breakpoint on itself. Breakpoints are placed only
   * while the four-breakpoint budget allows (tools, system and a caller's
   * summary-head mark take theirs first).
   */
  private applyHistoryBreakpoints(
    messages: AnthropicMessage[],
    opts: { strategy: 'system_only' | 'system_and_long_context'; ttl?: '5m' | '1h'; reservedBreakpoints: number },
  ): void {
    if (opts.strategy !== 'system_and_long_context' || messages.length === 0) return

    const budget = AnthropicProvider.MAX_CACHE_BREAKPOINTS - opts.reservedBreakpoints
    const placed: number[] = []
    const tryMark = (index: number): boolean => {
      if (index < 0 || index >= messages.length) return false
      if (this.countMessageBreakpoints(messages) >= budget) return false
      if (!this.markBreakpoint(messages, index, opts.ttl)) return false
      placed.push(index)
      return true
    }

    const last = messages.length - 1
    if (messages.length === 1) {
      tryMark(0)
      return
    }

    let latestUser = -1
    for (let i = last; i >= 0; i--) {
      if (this.isRealUserMessage(messages[i])) { latestUser = i; break }
    }
    const toolLoop = latestUser >= 0 && messages.slice(latestUser + 1).some(m => this.isToolResultMessage(m))

    if (toolLoop) tryMark(last)

    if (latestUser > 0) {
      let runStart = latestUser
      while (runStart - 1 >= 0 && messages[runStart - 1].role === 'user' && !this.isToolResultMessage(messages[runStart - 1])) {
        runStart--
      }
      tryMark(runStart - 1)
      if (latestUser - 1 !== runStart - 1) tryMark(latestUser - 1)
    } else if (latestUser < 0) {
      // No real user line at all (an assistant-led request): the old rule.
      tryMark(last - 1)
    }

    const MIN_MESSAGES_FOR_MID_BREAKPOINT = 20
    const MID_BREAKPOINT_STEP = 15
    if (messages.length >= MIN_MESSAGES_FOR_MID_BREAKPOINT) {
      const rawIndex = messages.length - MID_BREAKPOINT_STEP
      const steppedIndex = Math.floor(rawIndex / MID_BREAKPOINT_STEP) * MID_BREAKPOINT_STEP
      const lowestHistoryMark = placed.length > 0 ? Math.min(...placed) : last
      if (steppedIndex >= 0 && steppedIndex < lowestHistoryMark && !tryMark(steppedIndex)) {
        logger.debug('Anthropic cache breakpoint budget spent; skipping mid-history breakpoint', {
          context: 'AnthropicProvider.applyHistoryBreakpoints',
          reservedBreakpoints: opts.reservedBreakpoints,
          messageCount: messages.length,
        })
      }
    }

    logger.debug('Placed Anthropic conversation cache breakpoints', {
      context: 'AnthropicProvider.applyHistoryBreakpoints',
      messageCount: messages.length,
      latestUser,
      toolLoop,
      breakpoints: placed,
    })
  }

  /** A user message that carries only tool results (a tool-loop step). */
  private isToolResultMessage(message: AnthropicMessage): boolean {
    return message.role === 'user'
      && Array.isArray(message.content)
      && message.content.length > 0
      && message.content.every(block => block.type === 'tool_result')
  }

  /** A user message that is the operator's (or a whisper's) words, not tool results. */
  private isRealUserMessage(message: AnthropicMessage): boolean {
    return message.role === 'user' && !this.isToolResultMessage(message)
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
      // Honor caller-supplied cacheControl (e.g., the running summary head)
      // even when long-context strategy is off — gives the running-summary
      // path a stable mid-array breakpoint independent of the tail
      // breakpoint placed by applyHistoryBreakpoints.
      const honorMsgCacheControl = cacheOptions?.enableCaching === true && msg.cacheControl?.type === 'ephemeral'

      // If no attachments, check if we need to add cache control
      if (!msg.attachments || msg.attachments.length === 0) {
        if (honorMsgCacheControl) {
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
          // Plain text document - use text source type, not base64.
          // `data` may be raw text or base64; only base64-charset, newline-free
          // data is a decode candidate, and decodeBase64Text round-trips to
          // confirm it (a bare decode would mangle already-plain text).
          let textContent = attachment.data
          if (attachment.data && !attachment.data.includes('\n') && /^[A-Za-z0-9+/=]+$/.test(attachment.data)) {
            textContent = decodeBase64Text(attachment.data)
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

      // API version 2026-10-21 refuses a `document` block placed directly in
      // an assistant message. Carry an assistant turn's documents in a user
      // turn just ahead of it; images stay where they were.
      if (role === 'assistant') {
        const documents = content.filter(block => block.type === 'document')
        if (documents.length > 0) {
          logger.debug('Moving assistant-message documents into a preceding user turn', {
            context: 'AnthropicProvider.formatMessagesWithAttachments',
            documentCount: documents.length,
          })
          formattedMessages.push({ role: 'user', content: documents })
          const kept = content.filter(block => block.type !== 'document')
          content.length = 0
          content.push(...kept)
        }
      }

      // Honor caller-supplied cacheControl (running-summary head). The
      // conversation breakpoints proper are placed afterwards by
      // applyHistoryBreakpoints.
      if (honorMsgCacheControl && content.length > 0) {
        const lastBlock = content[content.length - 1]
        content[content.length - 1] = {
          ...lastBlock,
          cache_control: this.buildCacheControl(cacheOptions?.ttl),
        } as AnthropicContentBlock
      }

      // An assistant turn that carried only documents has nothing left to say
      // once they move; an empty assistant message would be refused.
      if (content.length === 0 && !msg.content) {
        continue
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
      defaultHeaders: clientHeaders(),
      // A caller-supplied budget is a ceiling; without one the SDK's 10-minute
      // default would let a silent endpoint hold a turn open indefinitely.
      ...buildSdkClientOptions(params),
    })

    // Anthropic requires system messages separate from the messages array.
    // Quilltap may emit multiple system messages (a stable identity stack
    // followed by a static identity reminder); concatenate their contents
    // into ordered text blocks below.
    const systemMessages = params.messages.filter(m => m.role === 'system' && typeof m.content === 'string' && m.content.length > 0)

    // Extract profile parameters for cache control and extended thinking
    const profileParams = params.profileParameters as AnthropicProfileParams | undefined
    const cachingEnabled = profileParams?.enableCacheBreakpoints ?? false
    const cacheStrategy = profileParams?.cacheStrategy || 'system_and_long_context'
    const cacheTTL = profileParams?.cacheTTL

    // Determine thinking budget: prefer explicit thinkingBudget, fall back to
    // extendedThinking flag with a 4096-token default.
    const rawThinkingBudget = profileParams?.thinkingBudget
    const thinkingBudget = typeof rawThinkingBudget === 'number' && rawThinkingBudget >= 1024
      ? rawThinkingBudget
      : (profileParams?.extendedThinking === true ? 4096 : 0)
    const thinkingEnabled = thinkingBudget > 0

    const budgetThinkingRejected = this.modelRejectsBudgetThinking(params.model)

    // Format messages with optional cache control
    const { messages, attachmentResults } = this.formatMessagesWithAttachments(
      params.messages,
      cachingEnabled ? { enableCaching: true, strategy: cacheStrategy, ttl: cacheTTL } : undefined
    )

    // Conversation breakpoints: one before the final (turn-variable) message,
    // plus a mid-history one on long arrays — within the four-breakpoint
    // budget left after the tools and system breakpoints below.
    if (cachingEnabled) {
      this.applyHistoryBreakpoints(messages, {
        strategy: cacheStrategy,
        ttl: cacheTTL,
        reservedBreakpoints: (params.tools && params.tools.length > 0 ? 1 : 0) + (systemMessages.length > 0 ? 1 : 0),
      })
    }

    // When thinking is enabled, max_tokens must exceed the budget.
    const baseMaxTokens = params.maxTokens ?? 4096
    const effectiveMaxTokens = thinkingEnabled
      ? Math.max(baseMaxTokens, thinkingBudget + 1024)
      : baseMaxTokens

    const requestParams: any = {
      model: params.model,
      messages,
      max_tokens: effectiveMaxTokens,
    }

    // Enable extended thinking if requested. Sonnet 5 / Opus 4.7+ / Fable /
    // Mythos removed fixed-budget thinking entirely — "thinking.type.enabled"
    // 400s on those models; they require adaptive thinking instead, which has
    // no token budget to set. These models also default thinking.display to
    // "omitted" (empty thinking text) — request "summarized" explicitly so
    // Quilltap's reasoningContent capture keeps working.
    if (thinkingEnabled) {
      requestParams.thinking = budgetThinkingRejected
        ? { type: 'adaptive', display: 'summarized' }
        : { type: 'enabled', budget_tokens: thinkingBudget }
    }

    // Handle system messages with optional cache control.
    //
    // When caching is enabled we emit one text block per Quilltap system
    // message and place the cache breakpoint on the FIRST block (the stable
    // identity stack — every byte before this checkpoint becomes the cached
    // prefix). Subsequent system blocks (identity reminder, etc.) follow
    // outside the cached prefix and don't invalidate it on edits.
    //
    // When caching is disabled and there's exactly one system message, we
    // keep the simpler string form for backward-compatibility with logs and
    // upstream tests.
    if (systemMessages.length > 0) {
      if (cachingEnabled) {
        requestParams.system = systemMessages.map((m, i) => {
          const block: AnthropicContentBlock = {
            type: 'text',
            text: m.content as string,
          }
          if (i === 0) {
            block.cache_control = this.buildCacheControl(cacheTTL)
          }
          return block
        })
      } else if (systemMessages.length === 1) {
        requestParams.system = systemMessages[0].content as string
      } else {
        // Multiple system messages without caching: still send as blocks so
        // none get silently dropped.
        requestParams.system = systemMessages.map(m => ({
          type: 'text',
          text: m.content as string,
        }))
      }
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

    if (params.stop) {
      const stopArr = (Array.isArray(params.stop) ? params.stop : [params.stop]).filter(Boolean)
      if (stopArr.length > 0) {
        // Anthropic accepts at most 4 stop sequences.
        requestParams.stop_sequences = stopArr.slice(0, 4)
        if (stopArr.length > 4) {
          logger.warn('Anthropic accepts at most 4 stop sequences; truncating', {
            context: 'AnthropicProvider.sendMessage',
            requested: stopArr.length,
          })
        }
      }
    }

    const response = await client.messages.create(requestParams)

    // Extract text by concatenating all text blocks (skip thinking/redacted_thinking/tool_use).
    // When thinking is enabled, content[0] may be a thinking block — indexing [0] would return ''.
    const textContent = response.content
      .filter((block: any) => block.type === 'text')
      .map((block: any) => block.text as string)
      .join('')

    // Collect thinking block text for reasoningContent
    const thinkingContent = response.content
      .filter((block: any) => block.type === 'thinking')
      .map((block: any) => block.thinking as string)
      .join('')


    // Extract cache usage if available (when prompt caching is enabled)
    const rawUsage = response.usage as any
    const cacheUsage = (rawUsage.cache_creation_input_tokens !== undefined || rawUsage.cache_read_input_tokens !== undefined)
      ? {
          cacheCreationInputTokens: rawUsage.cache_creation_input_tokens,
          cacheReadInputTokens: rawUsage.cache_read_input_tokens,
        }
      : undefined

    return {
      content: textContent,
      finishReason: response.stop_reason ?? 'stop',
      usage: {
        // Anthropic reports input_tokens SEPARATELY from cache_read_input_tokens
        // (and cache_creation_input_tokens), so prompt/total already exclude
        // cache reads — no subtraction needed here, unlike the OpenAI-family
        // plugins. cacheUsage below still reports cache reads for display.
        promptTokens: response.usage.input_tokens,
        completionTokens: response.usage.output_tokens,
        totalTokens: response.usage.input_tokens + response.usage.output_tokens,
      },
      raw: response,
      attachmentResults,
      cacheUsage,
      ...(thinkingContent ? { reasoningContent: thinkingContent } : {}),
    }
  }

  async *streamMessage(params: LLMParams, apiKey: string): AsyncGenerator<StreamChunk> {

    const client = new Anthropic({
      apiKey,
      defaultHeaders: clientHeaders(),
      // A caller-supplied budget is a ceiling; without one the SDK's 10-minute
      // default would let a silent endpoint hold a turn open indefinitely.
      ...buildSdkClientOptions(params),
    })

    // Quilltap may emit multiple system messages (a stable identity stack
    // followed by a static identity reminder); collect all so block 2 is not
    // silently dropped.
    const systemMessages = params.messages.filter(m => m.role === 'system' && typeof m.content === 'string' && m.content.length > 0)

    // Extract profile parameters for cache control and extended thinking
    const profileParams = params.profileParameters as AnthropicProfileParams | undefined
    const cachingEnabled = profileParams?.enableCacheBreakpoints ?? false
    const cacheStrategy = profileParams?.cacheStrategy || 'system_and_long_context'
    const cacheTTL = profileParams?.cacheTTL

    // Determine thinking budget (mirrors sendMessage logic)
    const streamRawThinkingBudget = profileParams?.thinkingBudget
    const streamThinkingBudget = typeof streamRawThinkingBudget === 'number' && streamRawThinkingBudget >= 1024
      ? streamRawThinkingBudget
      : (profileParams?.extendedThinking === true ? 4096 : 0)
    const streamThinkingEnabled = streamThinkingBudget > 0

    const streamBudgetThinkingRejected = this.modelRejectsBudgetThinking(params.model)

    // Format messages with optional cache control
    const { messages, attachmentResults } = this.formatMessagesWithAttachments(
      params.messages,
      cachingEnabled ? { enableCaching: true, strategy: cacheStrategy, ttl: cacheTTL } : undefined
    )

    // Conversation breakpoints: one before the final (turn-variable) message,
    // plus a mid-history one on long arrays — within the four-breakpoint
    // budget left after the tools and system breakpoints below.
    if (cachingEnabled) {
      this.applyHistoryBreakpoints(messages, {
        strategy: cacheStrategy,
        ttl: cacheTTL,
        reservedBreakpoints: (params.tools && params.tools.length > 0 ? 1 : 0) + (systemMessages.length > 0 ? 1 : 0),
      })
    }

    // When thinking is enabled, max_tokens must exceed the budget.
    const streamBaseMaxTokens = params.maxTokens ?? 4096
    const streamEffectiveMaxTokens = streamThinkingEnabled
      ? Math.max(streamBaseMaxTokens, streamThinkingBudget + 1024)
      : streamBaseMaxTokens

    const requestParams: any = {
      model: params.model,
      messages,
      max_tokens: streamEffectiveMaxTokens,
      stream: true,
    }

    // Enable extended thinking if requested. Sonnet 5 / Opus 4.7+ / Fable /
    // Mythos removed fixed-budget thinking entirely — "thinking.type.enabled"
    // 400s on those models; they require adaptive thinking instead, which has
    // no token budget to set. These models also default thinking.display to
    // "omitted" (empty thinking text) — request "summarized" explicitly so
    // Quilltap's reasoningContent capture keeps working.
    if (streamThinkingEnabled) {
      requestParams.thinking = streamBudgetThinkingRejected
        ? { type: 'adaptive', display: 'summarized' }
        : { type: 'enabled', budget_tokens: streamThinkingBudget }
    }

    // Handle system messages with optional cache control. Mirrors the
    // sendMessage path — emit one text block per Quilltap system message and
    // place cache_control on the FIRST block when caching is enabled.
    if (systemMessages.length > 0) {
      if (cachingEnabled) {
        requestParams.system = systemMessages.map((m, i) => {
          const block: AnthropicContentBlock = {
            type: 'text',
            text: m.content as string,
          }
          if (i === 0) {
            block.cache_control = this.buildCacheControl(cacheTTL)
          }
          return block
        })
      } else if (systemMessages.length === 1) {
        requestParams.system = systemMessages[0].content as string
      } else {
        requestParams.system = systemMessages.map(m => ({
          type: 'text',
          text: m.content as string,
        }))
      }
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

    if (params.stop) {
      const stopArr = (Array.isArray(params.stop) ? params.stop : [params.stop]).filter(Boolean)
      if (stopArr.length > 0) {
        requestParams.stop_sequences = stopArr.slice(0, 4)
        if (stopArr.length > 4) {
          logger.warn('Anthropic accepts at most 4 stop sequences; truncating', {
            context: 'AnthropicProvider.streamMessage',
            requested: stopArr.length,
          })
        }
      }
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
    let rawProviderUsage: Record<string, unknown> | null = null
    // Accumulated reasoning from thinking blocks (cumulative)
    let streamReasoning = ''

    // Track all content blocks (text, tool_use, and thinking) for proper detection
    const contentBlocks: Array<{
      type: 'text' | 'tool_use' | 'thinking'
      text?: string
      thinking?: string
      signature?: string
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
        } else if (block.type === 'thinking') {
          // ThinkingBlock: has thinking + signature fields
          contentBlocks[event.index] = { type: 'thinking', thinking: '', signature: '' }
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
        } else if (delta?.type === 'thinking_delta' && delta?.thinking) {
          // Accumulate thinking text (cumulative semantics: emit full string each time)
          if (contentBlocks[blockIndex] && contentBlocks[blockIndex].type === 'thinking') {
            contentBlocks[blockIndex].thinking = (contentBlocks[blockIndex].thinking || '') + delta.thinking
          }
          streamReasoning += delta.thinking
          yield { content: '', done: false, reasoningContent: streamReasoning }
        } else if (delta?.type === 'signature_delta' && delta?.signature) {
          // Accumulate the signature for the current thinking block (needed for tool round-trips)
          if (contentBlocks[blockIndex] && contentBlocks[blockIndex].type === 'thinking') {
            contentBlocks[blockIndex].signature = (contentBlocks[blockIndex].signature || '') + delta.signature
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
        // Snapshot the provider-shape usage object pre-normalization so the
        // logger can detect cache-field-mapping regressions in a SQL query.
        rawProviderUsage = { ...rawUsage }
      }

      // Track usage and stop reason from message_delta event
      if (event.type === 'message_delta') {
        totalOutputTokens = event.usage.output_tokens
        if (event.delta.stop_reason) {
          stopReason = event.delta.stop_reason
        }
        // Merge the delta usage (carries output_tokens and may carry updated
        // cache_*_input_tokens) into the snapshot so the terminal yield
        // surfaces the full provider-shape usage including cache fields.
        if (rawProviderUsage) {
          rawProviderUsage = { ...rawProviderUsage, ...(event.usage as Record<string, unknown>) }
        } else {
          rawProviderUsage = { ...(event.usage as Record<string, unknown>) }
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

        // Build the full message object for tool call detection.
        // Include thinking blocks with their signatures so multi-turn tool rounds
        // can echo the thinking content back as required by Anthropic's API.
        const fullMessageContent = contentBlocks.length > 0
          ? contentBlocks.map(b => {
              if (b.type === 'thinking') {
                return { type: 'thinking' as const, thinking: b.thinking || '', signature: b.signature || '' }
              }
              if (b.type === 'tool_use') {
                return { type: 'tool_use' as const, id: b.id, name: b.name, input: b.input }
              }
              return { type: 'text' as const, text: b.text || '' }
            })
          : [{ type: 'text' as const, text: fullContent }]

        const fullMessage = {
          id: messageId,
          type: 'message' as const,
          role: 'assistant' as const,
          content: fullMessageContent,
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
            // input_tokens already excludes cache reads (Anthropic reports them
            // separately), so prompt/total exclude cache reads with no
            // subtraction — see sendMessage. cacheUsage reports them for display.
            promptTokens: totalInputTokens,
            completionTokens: totalOutputTokens,
            totalTokens: totalInputTokens + totalOutputTokens,
          },
          attachmentResults,
          rawResponse: fullMessage,
          rawProviderUsage,
          cacheUsage,
          ...(streamReasoning ? { reasoningContent: streamReasoning } : {}),
        }
      }
    }
  }

  async validateApiKey(apiKey: string): Promise<boolean> {
    try {

      const client = new Anthropic({
        apiKey,
        defaultHeaders: clientHeaders(),
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
        defaultHeaders: clientHeaders(),
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
        'claude-opus-4-6',
        'claude-sonnet-4-6',
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
