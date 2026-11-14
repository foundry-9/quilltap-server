/**
 * OpenRouter Provider Implementation for Quilltap Plugin
 *
 * Provides chat completion functionality using OpenRouter's API
 * Supports 100+ models including GPT-4, Claude, Gemini, Llama and more
 *
 * Every text send and stream speaks Chat Completions over a direct fetch,
 * built by one body builder; the SDK is used only for `models.list` and the
 * key check.
 *
 * Prompt caching: the per-character cache key goes out as `session_id` (sticky
 * provider routing from the first request, not only after a hit), as
 * `prompt_cache_key` (OpenAI-routed sharding) and as `user`. Claude needs
 * asking: with the profile's Prompt Caching switch on, explicit breakpoints
 * go on the stable parts of the prompt (cache-breakpoints.ts).
 */

import { OpenRouter } from '@openrouter/sdk';
import type {
  TextProvider,
  LLMMessage,
  LLMParams,
  LLMResponse,
  StreamChunk,
} from './types';
import { applyClaudeCacheBreakpoints } from './cache-breakpoints';
import { buildRequestAbortSignal, createPluginLogger, getQuilltapUserAgent, resolveRequestTimeoutMs } from '@quilltap/plugin-utils';

const logger = createPluginLogger('qtap-plugin-openrouter');

const CHAT_COMPLETIONS_URL = 'https://openrouter.ai/api/v1/chat/completions';

/**
 * The reasoning text carried by one streamed Chat Completions delta.
 * `delta.reasoning` (a plain string) is what OpenRouter emits in practice;
 * the documented form is `delta.reasoning_details`, typed entries of which
 * `reasoning.text` and `reasoning.summary` carry readable text and
 * `reasoning.encrypted` is skipped. `reasoning` wins when both are present,
 * so the same text is never counted twice.
 */
/**
 * The routing-relevant fields of a Chat Completions body, for debug logs:
 * never the messages or the key, only what decides where and how the request
 * is served (provider preferences incl. ZDR, fallbacks, plugins, format).
 */
function describeChatCompletionsBody(body: Record<string, any>): Record<string, unknown> {
  return {
    model: body.model,
    models: body.models,
    stream: body.stream,
    messageCount: Array.isArray(body.messages) ? body.messages.length : 0,
    toolCount: Array.isArray(body.tools) ? body.tools.length : 0,
    provider: body.provider,
    plugins: body.plugins,
    responseFormat: body.response_format?.type,
    hasUser: typeof body.user === 'string',
    hasSessionId: typeof body.session_id === 'string',
    cacheBreakpoints: Array.isArray(body.messages)
      ? body.messages.filter((m: any) => Array.isArray(m.content) && m.content.some((p: any) => p?.cache_control)).length
      : 0,
    reasoning: body.reasoning,
  };
}

export function reasoningDeltaText(delta: any): string {
  if (!delta) return '';
  if (typeof delta.reasoning === 'string' && delta.reasoning) return delta.reasoning;
  if (!Array.isArray(delta.reasoning_details)) return '';
  let text = '';
  for (const detail of delta.reasoning_details) {
    if (detail?.type === 'reasoning.text' && typeof detail.text === 'string') {
      text += detail.text;
    } else if (detail?.type === 'reasoning.summary' && typeof detail.summary === 'string') {
      text += detail.summary;
    } else if (detail?.type === 'reasoning.summary' && typeof detail.text === 'string') {
      text += detail.text;
    }
  }
  return text;
}

/**
 * OpenRouter provider preferences for fine-grained provider control
 */
interface OpenRouterProviderPreferences {
  order?: string[];              // Provider priority: ["Anthropic", "AWS Bedrock"]
  allowFallbacks?: boolean;      // Allow fallback to other providers (default: true)
  requireParameters?: boolean;   // Only use providers supporting all params
  dataCollection?: 'allow' | 'deny';  // ZDR privacy control
  ignore?: string[];             // Providers to skip
  only?: string[];               // Use only these providers
}

/**
 * OpenRouter-specific profile parameters
 *
 * Two shapes are accepted for backward compatibility:
 * - The original nested `providerPreferences` object — still written by
 *   profiles that predate the provider-options-schema refactor.
 * - The flat keys (`enableZDR`, `useCustomModel`, etc.) written by the
 *   schema-driven profile editor. `useCustomModel` is a UI directive and
 *   is intentionally not consumed here.
 */
interface OpenRouterProfileParams {
  fallbackModels?: string[];
  providerPreferences?: OpenRouterProviderPreferences;
  enableZDR?: boolean;
  useCustomModel?: boolean;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  reasoningEffort?: string;
  /** Opt-in Claude prompt caching (top-level `cache_control`). */
  enablePromptCaching?: boolean;
  cacheTTL?: '5m' | '1h';
}

/**
 * Claude on OpenRouter caches only when asked. Matches `anthropic/…` and the
 * `~anthropic/…-latest` router aliases.
 */
export function isAnthropicRoutedModel(model: string | undefined): boolean {
  return typeof model === 'string' && /^~?anthropic\//.test(model);
}

type OpenRouterCacheUsage = {
  cacheReadInputTokens?: number;
  cachedTokens?: number;
  cacheCreationInputTokens?: number;
};

/**
 * The one reader of an OpenRouter Chat Completions `usage` object (send and
 * stream report the same snake_case shape). Cache reads are
 * `prompt_tokens_details.cached_tokens`, writes `cache_write_tokens` (only
 * models with explicit caching and write pricing). Reads are excluded from
 * prompt/total so cached input is not charged against budgets or cost;
 * cacheUsage still reports them for display.
 */
export function readOpenRouterUsage(raw: any): {
  usage: { promptTokens: number; completionTokens: number; totalTokens: number };
  cacheUsage?: OpenRouterCacheUsage;
} {
  const read = Number(raw?.prompt_tokens_details?.cached_tokens) || 0;
  const written = Number(raw?.prompt_tokens_details?.cache_write_tokens) || 0;
  const cacheUsage: OpenRouterCacheUsage | undefined = read > 0 || written > 0
    ? {
        ...(read > 0 ? { cacheReadInputTokens: read, cachedTokens: read } : {}),
        ...(written > 0 ? { cacheCreationInputTokens: written } : {}),
      }
    : undefined;
  return {
    usage: {
      promptTokens: Math.max(0, (raw?.prompt_tokens ?? 0) - read),
      completionTokens: raw?.completion_tokens ?? 0,
      totalTokens: Math.max(0, (raw?.total_tokens ?? 0) - read),
    },
    ...(cacheUsage ? { cacheUsage } : {}),
  };
}

/**
 * Merge the legacy nested `providerPreferences` shape with the flat keys
 * written by the schema-driven profile editor. Flat keys take precedence
 * because they are what the new UI emits.
 */
function resolveProviderPrefs(
  profileParams: OpenRouterProfileParams | undefined
): OpenRouterProviderPreferences | undefined {
  if (!profileParams) return undefined;
  const merged: OpenRouterProviderPreferences = { ...(profileParams.providerPreferences ?? {}) };
  if (profileParams.enableZDR === true) {
    merged.dataCollection = 'deny';
  }
  return Object.keys(merged).length > 0 ? merged : undefined;
}

type OpenAIContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

/**
 * Image MIME types OpenRouter will serialise as `image_url` content-parts and
 * forward to the routed model. This is the single source of truth: `index.ts`
 * imports it for `attachmentSupport.supportedMimeTypes`, so the declaration
 * the plugin registry reads can no longer drift from what the wire actually
 * carries (bug 97).
 */
export const SUPPORTED_IMAGE_MIME_TYPES: string[] = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
];

export class OpenRouterProvider implements TextProvider {
  readonly supportsFileAttachments = true;
  readonly supportedMimeTypes: string[] = SUPPORTED_IMAGE_MIME_TYPES;
  readonly supportsWebSearch = true;

  /**
   * Build the OpenAI Chat Completions content field for a message.
   * Returns a plain string when there are no image attachments, or a
   * content-parts array (text + image_url) for vision-model requests.
   */
  private buildMessageContent(m: LLMMessage): string | OpenAIContentPart[] {
    const images = (m.attachments ?? []).filter(
      (a) => SUPPORTED_IMAGE_MIME_TYPES.includes(a.mimeType) && (a.data || a.url)
    );
    if (images.length === 0) return m.content;

    const parts: OpenAIContentPart[] = [];
    if (m.content) parts.push({ type: 'text', text: m.content });
    for (const img of images) {
      const url = img.url ?? `data:${img.mimeType};base64,${img.data}`;
      parts.push({ type: 'image_url', image_url: { url } });
    }
    return parts;
  }

  /**
   * Categorize attachments into sent (image attachments now formatted
   * inline as content parts) and failed (everything else — non-image
   * MIME types and image rows missing both data and url).
   */
  private collectAttachmentResults(params: LLMParams): {
    sent: string[];
    failed: { id: string; error: string }[];
  } {
    const sent: string[] = [];
    const failed: { id: string; error: string }[] = [];
    for (const msg of params.messages) {
      for (const a of msg.attachments ?? []) {
        if (SUPPORTED_IMAGE_MIME_TYPES.includes(a.mimeType)) {
          if (a.data || a.url) {
            sent.push(a.id);
          } else {
            failed.push({ id: a.id, error: 'Image attachment missing data and url' });
          }
        } else {
          failed.push({
            id: a.id,
            error: `OpenRouter ${a.mimeType} attachments are not yet implemented`,
          });
        }
      }
    }
    return { sent, failed };
  }

  async sendMessage(params: LLMParams, apiKey: string): Promise<LLMResponse> {
    const attachmentResults = this.collectAttachmentResults(params);

    // Every send speaks Chat Completions over the one body builder. The SDK's
    // chat.send() rejects image content-parts at client-side validation (bug
    // 31) and validates the request against its own schema, so wire fields it
    // does not model (`session_id`, top-level `cache_control`) cannot ride it
    // — which left text-only sends without sticky cache routing and with their
    // cache hits misread from the camelCase usage shape.
    return this.sendViaChatCompletions(params, apiKey, attachmentResults);
  }

  /** The messages that reach the wire: orphan tool messages (no toolCallId) are dropped. */
  private sendableMessages(params: LLMParams): LLMMessage[] {
    return params.messages.filter(m => !(m.role === 'tool' && !m.toolCallId));
  }

  /**
   * Indexes, in the built `messages` array, of the messages the host flagged
   * with `cacheControl` (the summary head).
   */
  private hostCacheMarks(params: LLMParams): Set<number> {
    const marks = new Set<number>();
    this.sendableMessages(params).forEach((m, i) => { if (m.cacheControl?.type === 'ephemeral') marks.add(i); });
    return marks;
  }

  /**
   * Build the OpenAI Chat Completions `messages` array: tool results keyed by
   * `tool_call_id`, assistant tool calls, and image attachments formatted
   * inline as content parts (buildMessageContent). Orphan tool messages
   * (no toolCallId) are dropped.
   */
  private buildChatCompletionsMessages(params: LLMParams): Array<Record<string, unknown>> {
    return this.sendableMessages(params).map((m) => {
        if (m.role === 'tool' && m.toolCallId) {
          return { role: 'tool', tool_call_id: m.toolCallId, content: m.content };
        }
        if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0) {
          return {
            role: 'assistant',
            content: m.content || null,
            tool_calls: m.toolCalls.map(tc => ({ id: tc.id, type: tc.type, function: tc.function })),
          };
        }
        return {
          role: m.role,
          content: this.buildMessageContent(m),
        };
      });
  }

  /**
   * The one Chat Completions request body (snake_case wire shape). Both fetch
   * paths — {@link sendViaChatCompletions} and {@link streamViaChatCompletions}
   * — call this, and no field may be set on a body anywhere else; the two
   * bodies differ only in `stream`. This is what keeps ZDR, provider
   * preferences, fallbacks, structured output and web search from drifting
   * between turn shapes again (#145).
   */
  private buildChatCompletionsBody(params: LLMParams, stream: boolean): Record<string, any> {
    const body: Record<string, any> = {
      model: params.model,
      messages: this.buildChatCompletionsMessages(params),
      stream,
      temperature: params.temperature ?? 0.7,
      max_tokens: params.maxTokens ?? 4096,
      top_p: params.topP ?? 1,
      stop: params.stop,
    };

    // Quilltap's per-character cache identifier. `session_id` (≤256 chars)
    // makes OpenRouter's provider stickiness start on the first successful
    // request instead of waiting for a cache hit, and keys it per character
    // rather than by a hash of the opening messages. `prompt_cache_key` is
    // OpenAI's own sharding hint (and OpenRouter's sticky fallback); `user`
    // is kept for routes that read only that. Stickiness is skipped when the
    // profile pins `provider.order` — OpenRouter's rule, not ours.
    if (typeof params.cacheKey === 'string' && params.cacheKey.length > 0) {
      body.user = params.cacheKey;
      body.prompt_cache_key = params.cacheKey;
      if (params.cacheKey.length <= 256) body.session_id = params.cacheKey;
    }

    // Tools in OpenAI function shape (a no-op on tools already in that shape).
    if (params.tools && params.tools.length > 0) {
      body.tools = params.tools.map((tool: any) => ({
        type: 'function',
        function: {
          name: tool.function?.name || tool.name,
          description: tool.function?.description || tool.description,
          parameters: tool.function?.parameters || tool.parameters,
        },
      }));
      body.tool_choice = 'auto';
    }

    // Web search on Chat Completions is the `web` plugin.
    if (params.webSearchEnabled) {
      body.plugins = [{ id: 'web', max_results: 5 }];
    }

    if (params.responseFormat) {
      if (params.responseFormat.type === 'json_schema' && params.responseFormat.jsonSchema) {
        body.response_format = {
          type: 'json_schema',
          json_schema: {
            name: params.responseFormat.jsonSchema.name,
            strict: params.responseFormat.jsonSchema.strict ?? true,
            schema: params.responseFormat.jsonSchema.schema,
          },
        };
      } else if (params.responseFormat.type !== 'text') {
        body.response_format = { type: params.responseFormat.type };
      }
    }

    const profileParams = params.profileParameters as OpenRouterProfileParams | undefined;

    // Claude caches only when asked, and only at explicit breakpoints placed
    // where the prompt is stable (cache-breakpoints.ts) — never OpenRouter's
    // automatic mode, whose one breakpoint lands on the turn-variable newest
    // line. Writes cost 1.25x input (2x for the hour), so it stays opt-in,
    // like the direct Anthropic plugin.
    if (profileParams?.enablePromptCaching === true && isAnthropicRoutedModel(params.model)) {
      const placed = applyClaudeCacheBreakpoints(
        body.messages,
        this.hostCacheMarks(params),
        profileParams.cacheTTL,
      );
      logger.debug('Placed Claude prompt-cache breakpoints', {
        context: 'OpenRouterProvider.buildChatCompletionsBody',
        model: params.model,
        ttl: profileParams.cacheTTL ?? '5m',
        breakpoints: placed,
      });
    }

    // Model fallbacks: `models` replaces `model` (can't send both).
    if (profileParams?.fallbackModels?.length) {
      body.models = [params.model, ...profileParams.fallbackModels];
      delete body.model;
    }

    // Provider preferences. ZDR is load-bearing: dropping data_collection on
    // any turn shape leaks the prompt.
    const providerPrefs = resolveProviderPrefs(profileParams);
    if (providerPrefs) {
      const provider: Record<string, unknown> = {};
      if (providerPrefs.order) provider.order = providerPrefs.order;
      if (providerPrefs.allowFallbacks !== undefined) provider.allow_fallbacks = providerPrefs.allowFallbacks;
      if (providerPrefs.requireParameters) provider.require_parameters = providerPrefs.requireParameters;
      if (providerPrefs.dataCollection) provider.data_collection = providerPrefs.dataCollection;
      if (providerPrefs.ignore) provider.ignore = providerPrefs.ignore;
      if (providerPrefs.only) provider.only = providerPrefs.only;
      body.provider = provider;
    }

    // `exclude: false` tells OpenRouter not to suppress reasoning.
    const reasoningEffort = profileParams?.reasoningEffort;
    body.reasoning = typeof reasoningEffort === 'string' && reasoningEffort.length > 0
      ? { effort: reasoningEffort, exclude: false }
      : { exclude: false };

    return body;
  }

  private chatCompletionsHeaders(apiKey: string): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      'HTTP-Referer': process.env.BASE_URL || 'http://localhost:3000',
      'X-Title': 'Quilltap',
      'User-Agent': getQuilltapUserAgent(),
    };
  }

  /**
   * Non-streaming send via the OpenAI Chat Completions endpoint using a direct
   * fetch, bypassing the SDK's client-side validation that rejects image
   * content-parts. Used for the vision (image attachment) send path — the
   * non-streaming counterpart to {@link streamViaChatCompletions}.
   */
  private async sendViaChatCompletions(
    params: LLMParams,
    apiKey: string,
    attachmentResults: { sent: string[]; failed: { id: string; error: string }[] }
  ): Promise<LLMResponse> {
    const body = this.buildChatCompletionsBody(params, false);
    logger.debug('OpenRouter Chat Completions send', {
      context: 'OpenRouterProvider.sendViaChatCompletions',
      ...describeChatCompletionsBody(body),
    });

    let response: Response;
    try {
      response = await fetch(CHAT_COMPLETIONS_URL, {
        method: 'POST',
        headers: this.chatCompletionsHeaders(apiKey),
        body: JSON.stringify(body),
        // Non-streaming: the whole exchange is one JSON blob, so bounding the
        // entire request (headers + body) is correct.
        signal: buildRequestAbortSignal(params),
      });
    } catch (error) {
      logger.error('Error in sendViaChatCompletions', {
        context: 'OpenRouterProvider.sendViaChatCompletions',
      }, error instanceof Error ? error : undefined);
      throw error;
    }

    if (!response.ok) {
      const errorText = await response.text();
      logger.error('OpenRouter API error', {
        context: 'OpenRouterProvider.sendViaChatCompletions',
        status: response.status,
        error: errorText,
      });
      throw new Error(`OpenRouter API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    const choice = data.choices?.[0];
    const content = choice?.message?.content;
    const contentStr = typeof content === 'string' ? content : '';
    const finishReason = choice?.finish_reason || 'stop';
    const reasoningContent = choice?.message?.reasoning;

    const { usage, cacheUsage } = readOpenRouterUsage(data.usage);
    logger.debug('OpenRouter Chat Completions send finished', {
      context: 'OpenRouterProvider.sendViaChatCompletions',
      finishReason,
      usage,
      cacheUsage,
      cost: data.usage?.cost,
    });

    return {
      content: contentStr,
      finishReason,
      usage,
      raw: data,
      attachmentResults,
      ...(cacheUsage ? { cacheUsage } : {}),
      ...(reasoningContent && typeof reasoningContent === 'string' ? { reasoningContent } : {}),
    };
  }

  /**
   * Every streaming turn — plain, tool, image — goes through the direct Chat
   * Completions fetch. The SDK's OpenResponses streaming helper was removed upstream in
   * @openrouter/sdk 1.5.57 (#145).
   */
  async *streamMessage(
    params: LLMParams,
    apiKey: string
  ): AsyncGenerator<StreamChunk> {
    const attachmentResults = this.collectAttachmentResults(params);
    yield* this.streamViaChatCompletions(params, apiKey, attachmentResults);
  }

  /**
   * Stream via the OpenAI Chat Completions endpoint using a direct fetch and
   * a small SSE reader.
   */
  private async *streamViaChatCompletions(
    params: LLMParams,
    apiKey: string,
    attachmentResults: { sent: string[]; failed: { id: string; error: string }[] }
  ): AsyncGenerator<StreamChunk> {
    const body = this.buildChatCompletionsBody(params, true);
    logger.debug('OpenRouter Chat Completions stream', {
      context: 'OpenRouterProvider.streamViaChatCompletions',
      ...describeChatCompletionsBody(body),
      hasImages: attachmentResults.sent.length > 0,
    });

    try {
      // Bound how long OpenRouter may take to *start* answering, not how long
      // it takes to finish: the timer is cleared once the response headers land
      // so the SSE body streams unbounded (the host's stall watchdog covers
      // the body). A signal covering the whole exchange would cut off a long
      // generation mid-answer.
      const controller = new AbortController();
      const firstByteTimer = setTimeout(
        () => controller.abort(),
        resolveRequestTimeoutMs(params)
      );
      let response: Response;
      try {
        response = await fetch(CHAT_COMPLETIONS_URL, {
          method: 'POST',
          headers: this.chatCompletionsHeaders(apiKey),
          body: JSON.stringify(body),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(firstByteTimer);
      }

      if (!response.ok) {
        const errorText = await response.text();
        logger.error('OpenRouter API error', {
          context: 'OpenRouterProvider.streamViaChatCompletions',
          status: response.status,
          error: errorText,
        });
        throw new Error(`OpenRouter API error: ${response.status} - ${errorText}`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('No response body');
      }

      const decoder = new TextDecoder();
      let buffer = '';
      let usage: { promptTokens: number; completionTokens: number; totalTokens: number } | undefined;
      let cacheUsage: OpenRouterCacheUsage | undefined;
      let rawProviderUsage: Record<string, unknown> | null = null;
      const toolCalls: any[] = [];
      let fetchReasoning = '';
      let refusalText = '';
      // Which reasoning field the stream used, and the reported cost — for the
      // debug log only (#145 Phase 0: which of the two fields OpenRouter sends).
      const reasoningFieldsSeen = new Set<string>();
      let reportedCost: number | undefined;
      // The provider's own finish reason from the stream, so a moderation stop
      // (`content_filter`) reaches the host instead of a hardcoded 'stop'.
      let streamFinishReason: string | null = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6).trim();
          if (data === '[DONE]') continue;

          let chunk: any;
          try {
            chunk = JSON.parse(data);
          } catch {
            // Skip malformed JSON chunks (and SSE comments / keep-alives)
            continue;
          }

          const choice = chunk.choices?.[0];
          if (typeof choice?.finish_reason === 'string' && choice.finish_reason) {
            streamFinishReason = choice.finish_reason;
          }

          if (choice?.delta?.content) {
            yield {
              content: choice.delta.content,
              done: false,
            };
          }

          if (typeof choice?.delta?.reasoning === 'string' && choice.delta.reasoning) reasoningFieldsSeen.add('reasoning');
          if (Array.isArray(choice?.delta?.reasoning_details) && choice.delta.reasoning_details.length > 0) {
            reasoningFieldsSeen.add('reasoning_details');
          }
          const deltaReasoning = reasoningDeltaText(choice?.delta);
          if (deltaReasoning) {
            fetchReasoning += deltaReasoning;
            yield { content: '', done: false, reasoningContent: fetchReasoning };
          }

          // OpenAI-schema refusal text (passed through for OpenAI-routed models)
          if (typeof choice?.delta?.refusal === 'string' && choice.delta.refusal) {
            refusalText += choice.delta.refusal;
          }

          // Accumulate tool calls
          if (choice?.delta?.tool_calls) {
            for (const tc of choice.delta.tool_calls) {
              const idx = tc.index ?? 0;
              if (!toolCalls[idx]) {
                toolCalls[idx] = {
                  id: tc.id || '',
                  type: 'function',
                  function: { name: '', arguments: '' },
                };
              }
              if (tc.id) toolCalls[idx].id = tc.id;
              if (tc.function?.name) toolCalls[idx].function.name += tc.function.name;
              if (tc.function?.arguments) toolCalls[idx].function.arguments += tc.function.arguments;
            }
          }

          // Usage rides on the final chunk, unconditionally.
          if (chunk.usage) {
            if (typeof chunk.usage.cost === 'number') reportedCost = chunk.usage.cost;
            ({ usage, cacheUsage } = readOpenRouterUsage(chunk.usage));
            // OpenRouter's own usage object (cached / cache-write split, cost)
            // goes on the LLM log so cache health can be audited from it.
            rawProviderUsage = chunk.usage as Record<string, unknown>;
          }
        }
      }

      const finalToolCalls = toolCalls.filter(Boolean);
      const finalFinishReason = finalToolCalls.length > 0
        ? 'tool_calls'
        : refusalText
          ? 'refusal'
          : (streamFinishReason ?? 'stop');
      logger.debug('OpenRouter stream finished', {
        context: 'OpenRouterProvider.streamViaChatCompletions',
        finishReason: finalFinishReason,
        toolCallCount: finalToolCalls.length,
        reasoningChars: fetchReasoning.length,
        reasoningFields: [...reasoningFieldsSeen],
        hasUsage: !!usage,
        usage,
        cacheUsage,
        cost: reportedCost,
      });
      const rawResponse = {
        choices: [{
          // snake_case is what the host's finish-reason reader looks for; the
          // camelCase key is kept for anything that already reads it.
          finish_reason: finalFinishReason,
          finishReason: finalFinishReason,
          delta: {
            toolCalls: finalToolCalls.length > 0 ? finalToolCalls : undefined,
            ...(refusalText ? { refusal: refusalText } : {}),
          },
        }],
        usage,
      };

      yield {
        content: '',
        done: true,
        usage,
        attachmentResults,
        rawResponse,
        rawProviderUsage,
        ...(cacheUsage ? { cacheUsage } : {}),
        ...(fetchReasoning ? { reasoningContent: fetchReasoning } : {}),
      };

    } catch (error) {
      logger.error('Error in streamViaChatCompletions', {
        context: 'OpenRouterProvider.streamViaChatCompletions',
      }, error instanceof Error ? error : undefined);
      throw error;
    }
  }

  async validateApiKey(apiKey: string): Promise<boolean> {
    try {
      const client = new OpenRouter({
        apiKey,
        httpReferer: process.env.BASE_URL || 'http://localhost:3000',
        appTitle: getQuilltapUserAgent(),
      });
      await client.models.list();
      return true;
    } catch (error) {
      logger.error(
        'OpenRouter API key validation failed',
        { provider: 'openrouter' },
        error instanceof Error ? error : undefined
      );
      return false;
    }
  }

  async getAvailableModels(apiKey: string): Promise<string[]> {
    try {
      const client = new OpenRouter({
        apiKey,
        httpReferer: process.env.BASE_URL || 'http://localhost:3000',
        appTitle: getQuilltapUserAgent(),
      });

      // @openrouter/sdk 0.13 changed models.list() to return a paginated
      // async-iterable; the model array now lives at page.result.data (was
      // response.data in 0.12). Iterate pages so we capture every model.
      const pages = await client.models.list();
      const models: string[] = [];
      for await (const page of pages) {
        for (const m of (page.result?.data ?? []) as Array<{ id: string }>) {
          models.push(m.id);
        }
      }
      return models;
    } catch (error) {
      logger.error(
        'Failed to fetch OpenRouter models',
        { provider: 'openrouter' },
        error instanceof Error ? error : undefined
      );
      return [];
    }
  }

}
