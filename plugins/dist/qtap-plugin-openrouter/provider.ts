/**
 * OpenRouter Provider Implementation for Quilltap Plugin
 *
 * Provides chat completion functionality using OpenRouter's API
 * Supports 100+ models including GPT-4, Claude, Gemini, Llama and more
 *
 * Streaming (every turn shape) and image sends speak Chat Completions over a
 * direct fetch; the SDK is used only for its generated OpenAPI surface
 * (`chat.send` for text-only non-streaming sends, `models.list`).
 */

import { OpenRouter } from '@openrouter/sdk';
import type { ChatResult } from '@openrouter/sdk/models';
import type {
  TextProvider,
  LLMMessage,
  LLMParams,
  LLMResponse,
  StreamChunk,
} from './types';
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

  private hasImageAttachments(params: LLMParams): boolean {
    return params.messages.some((m) =>
      (m.attachments ?? []).some(
        (a) => SUPPORTED_IMAGE_MIME_TYPES.includes(a.mimeType) && (a.data || a.url)
      )
    );
  }

  async sendMessage(params: LLMParams, apiKey: string): Promise<LLMResponse> {
    const attachmentResults = this.collectAttachmentResults(params);

    // Vision (image attachment) sends can't go through the SDK's non-streaming
    // request path: @openrouter/sdk's chat.send() rejects OpenAI content-parts
    // (image_url) messages at client-side input validation, so the image never
    // reaches the model. Route those around the SDK through a direct Chat
    // Completions fetch — the same escape hatch streamMessage() already uses for
    // image/tool requests. No-image sends keep the SDK path unchanged.
    if (this.hasImageAttachments(params)) {
      return this.sendViaChatCompletions(params, apiKey, attachmentResults);
    }

    const client = new OpenRouter({
      apiKey,
      httpReferer: process.env.BASE_URL || 'http://localhost:3000',
      appTitle: getQuilltapUserAgent(),
      // Non-streaming, so bounding the whole request is right. Without this the
      // SDK default would let a silent endpoint hold a turn open indefinitely.
      timeoutMs: resolveRequestTimeoutMs(params),
    });

    // Same messages array the fetch paths send (OpenAI Chat Completions shape).
    const messages = this.buildChatCompletionsMessages(params) as any;

    const requestParams: any = {
      model: params.model,
      messages,
      temperature: params.temperature ?? 0.7,
      maxTokens: params.maxTokens ?? 4096,
      topP: params.topP ?? 1,
      stop: params.stop,
      stream: false,
    };

    // Forward Quilltap's per-character cache identifier as `user`. OpenAI-
    // routed downstreams use it as a sticky-routing hint; other downstreams
    // (Anthropic, etc.) ignore it.
    if (typeof params.cacheKey === 'string' && params.cacheKey.length > 0) {
      requestParams.user = params.cacheKey;
    }

    // Add tools if provided
    if (params.tools && params.tools.length > 0) {
      requestParams.tools = params.tools;
      // Explicitly enable tool use with "auto" - let the model decide when to use tools
      requestParams.toolChoice = 'auto';
    }

    // Add web search plugin if enabled
    if (params.webSearchEnabled) {
      requestParams.plugins = [{ id: 'web', maxResults: 5 }];
    }

    // Add structured output format if specified
    if (params.responseFormat) {
      if (params.responseFormat.type === 'json_schema' && params.responseFormat.jsonSchema) {
        requestParams.responseFormat = {
          type: 'json_schema',
          jsonSchema: {
            name: params.responseFormat.jsonSchema.name,
            strict: params.responseFormat.jsonSchema.strict ?? true,
            schema: params.responseFormat.jsonSchema.schema,
          },
        };
      } else if (params.responseFormat.type !== 'text') {
        requestParams.responseFormat = { type: params.responseFormat.type };
      }
    }

    // Handle OpenRouter-specific profile parameters
    const profileParams = params.profileParameters as OpenRouterProfileParams | undefined;

    // Add model fallbacks if configured
    if (profileParams?.fallbackModels?.length) {
      requestParams.models = [params.model, ...profileParams.fallbackModels];
      requestParams.route = 'fallback';
      delete requestParams.model; // Can't have both model and models
    }

    // Add provider preferences if configured
    const providerPrefs = resolveProviderPrefs(profileParams);
    if (providerPrefs) {
      requestParams.provider = {};
      if (providerPrefs.order) requestParams.provider.order = providerPrefs.order;
      if (providerPrefs.allowFallbacks !== undefined) requestParams.provider.allowFallbacks = providerPrefs.allowFallbacks;
      if (providerPrefs.requireParameters) requestParams.provider.requireParameters = providerPrefs.requireParameters;
      if (providerPrefs.dataCollection) requestParams.provider.dataCollection = providerPrefs.dataCollection;
      if (providerPrefs.ignore) requestParams.provider.ignore = providerPrefs.ignore;
      if (providerPrefs.only) requestParams.provider.only = providerPrefs.only;
    }

    // Enable reasoning output for models that support it in the non-streaming path.
    const sendReasoningEffort = profileParams?.reasoningEffort;
    if (typeof sendReasoningEffort === 'string' && sendReasoningEffort.length > 0) {
      requestParams.reasoning = { effort: sendReasoningEffort, exclude: false };
    } else {
      requestParams.reasoning = { exclude: false };
    }

    // Non-streaming send: @openrouter/sdk 0.13 types chat.send() as a
    // ChatResult | EventStream union, so narrow to ChatResult here (a
    // request without st:true always resolves to a ChatResult at runtime).
    const response = (await client.chat.send({
      chatRequest: requestParams,
    })) as ChatResult;

    const choice = response.choices[0];
    const content = choice.message.content;
    const contentStr = typeof content === 'string' ? content : '';

    // Extract reasoning from the message if available
    const sendReasoningContent = (choice.message as any)?.reasoning;

    // Extract cache usage if available
    const usageAny = response.usage as any;
    const cacheUsage = usageAny?.cachedTokens || usageAny?.cacheDiscount
      ? {
          cachedTokens: usageAny.cachedTokens,
          cacheDiscount: usageAny.cacheDiscount,
          cacheCreationInputTokens: usageAny.cacheCreationInputTokens,
          cacheReadInputTokens: usageAny.cacheReadInputTokens,
        }
      : undefined;
    return {
      content: contentStr,
      finishReason: choice.finishReason || 'stop',
      usage: {
        // Exclude cache-read tokens from prompt/total so cached input is not
        // charged against budgets or cost; cacheUsage still reports them for
        // display. (OpenRouter normalizes cached tokens into promptTokens.)
        promptTokens: Math.max(0, (response.usage?.promptTokens ?? 0) - (cacheUsage?.cacheReadInputTokens ?? cacheUsage?.cachedTokens ?? 0)),
        completionTokens: response.usage?.completionTokens ?? 0,
        totalTokens: Math.max(0, (response.usage?.totalTokens ?? 0) - (cacheUsage?.cacheReadInputTokens ?? cacheUsage?.cachedTokens ?? 0)),
      },
      raw: response,
      attachmentResults,
      cacheUsage,
      ...(sendReasoningContent && typeof sendReasoningContent === 'string' ? { reasoningContent: sendReasoningContent } : {}),
    };
  }

  /**
   * Build the OpenAI Chat Completions `messages` array: tool results keyed by
   * `tool_call_id`, assistant tool calls, and image attachments formatted
   * inline as content parts (buildMessageContent). Orphan tool messages
   * (no toolCallId) are dropped.
   */
  private buildChatCompletionsMessages(params: LLMParams): Array<Record<string, unknown>> {
    return params.messages
      .filter(m => !(m.role === 'tool' && !m.toolCallId))
      .map((m) => {
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

    // Forward Quilltap's per-character cache identifier as `user`. OpenAI-
    // routed downstreams use it as a sticky-routing hint; others ignore it.
    if (typeof params.cacheKey === 'string' && params.cacheKey.length > 0) {
      body.user = params.cacheKey;
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

    // Exclude cache-read tokens from prompt/total so cached input is not charged
    // against budgets or cost; cacheUsage still reports them for display.
    const cachedTokens = data.usage?.prompt_tokens_details?.cached_tokens;
    const cacheUsage = cachedTokens !== undefined && cachedTokens > 0
      ? { cacheReadInputTokens: cachedTokens, cachedTokens }
      : undefined;
    const cacheRead = cachedTokens ?? 0;

    return {
      content: contentStr,
      finishReason,
      usage: {
        promptTokens: Math.max(0, (data.usage?.prompt_tokens ?? 0) - cacheRead),
        completionTokens: data.usage?.completion_tokens ?? 0,
        totalTokens: Math.max(0, (data.usage?.total_tokens ?? 0) - cacheRead),
      },
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
      let cacheUsage: { cacheReadInputTokens: number; cachedTokens: number } | undefined;
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

          // Usage rides on the final chunk, unconditionally. Exclude cache-read
          // tokens from prompt/total so cached input is not charged against
          // budgets or cost; cacheUsage still reports them for display.
          if (chunk.usage) {
            if (typeof chunk.usage.cost === 'number') reportedCost = chunk.usage.cost;
            const cachedTokens = chunk.usage.prompt_tokens_details?.cached_tokens;
            cacheUsage = cachedTokens !== undefined && cachedTokens > 0
              ? { cacheReadInputTokens: cachedTokens, cachedTokens }
              : undefined;
            const cacheRead = cachedTokens ?? 0;
            usage = {
              promptTokens: Math.max(0, (chunk.usage.prompt_tokens ?? 0) - cacheRead),
              completionTokens: chunk.usage.completion_tokens ?? 0,
              totalTokens: Math.max(0, (chunk.usage.total_tokens ?? 0) - cacheRead),
            };
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
