/**
 * OpenRouter Provider Implementation for Quilltap Plugin
 *
 * Provides chat completion functionality using OpenRouter's API
 * Supports 100+ models including GPT-4, Claude, Gemini, Llama and more
 *
 * Updated to use SDK v0.8.0 with callModel() and getTextStream() for improved streaming
 */

import { OpenRouter } from '@openrouter/sdk';
import { fromChatMessages } from '@openrouter/sdk/lib/chat-compat';
import type { ChatMessages, OpenResponsesResult } from '@openrouter/sdk/models';
import type {
  TextProvider,
  LLMMessage,
  LLMParams,
  LLMResponse,
  StreamChunk,
} from './types';
import { createPluginLogger, getQuilltapUserAgent } from '@quilltap/plugin-utils';

const logger = createPluginLogger('qtap-plugin-openrouter');

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
 */
interface OpenRouterProfileParams {
  fallbackModels?: string[];
  providerPreferences?: OpenRouterProviderPreferences;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
}

type OpenAIContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

const SUPPORTED_IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

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

    const client = new OpenRouter({
      apiKey,
      httpReferer: process.env.BASE_URL || 'http://localhost:3000',
      appTitle: getQuilltapUserAgent(),
    });

    // Convert messages to OpenRouter format, formatting image attachments
    // as inline content parts when present (OpenAI Chat Completions vision
    // schema). Non-image attachments are surfaced via attachmentResults.failed.
    const messages = params.messages
      .filter(m => !(m.role === 'tool' && !m.toolCallId))
      .map((m) => {
        if (m.role === 'tool' && m.toolCallId) {
          return { role: 'tool' as const, tool_call_id: m.toolCallId, content: m.content };
        }
        if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0) {
          return {
            role: 'assistant' as const,
            content: m.content || null,
            tool_calls: m.toolCalls.map(tc => ({ id: tc.id, type: tc.type, function: tc.function })),
          };
        }
        return {
          role: m.role as 'system' | 'user' | 'assistant',
          content: this.buildMessageContent(m) as any,
        };
      });

    const requestParams: any = {
      model: params.model,
      messages,
      temperature: params.temperature ?? 0.7,
      maxTokens: params.maxTokens ?? 4096,
      topP: params.topP ?? 1,
      stop: params.stop,
      stream: false,
    };

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
    const providerPrefs = profileParams?.providerPreferences;
    if (providerPrefs) {
      requestParams.provider = {};
      if (providerPrefs.order) requestParams.provider.order = providerPrefs.order;
      if (providerPrefs.allowFallbacks !== undefined) requestParams.provider.allowFallbacks = providerPrefs.allowFallbacks;
      if (providerPrefs.requireParameters) requestParams.provider.requireParameters = providerPrefs.requireParameters;
      if (providerPrefs.dataCollection) requestParams.provider.dataCollection = providerPrefs.dataCollection;
      if (providerPrefs.ignore) requestParams.provider.ignore = providerPrefs.ignore;
      if (providerPrefs.only) requestParams.provider.only = providerPrefs.only;
    }

    const response = await client.chat.send({
      chatRequest: requestParams,
    });

    const choice = response.choices[0];
    const content = choice.message.content;
    const contentStr = typeof content === 'string' ? content : '';

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
        promptTokens: response.usage?.promptTokens ?? 0,
        completionTokens: response.usage?.completionTokens ?? 0,
        totalTokens: response.usage?.totalTokens ?? 0,
      },
      raw: response,
      attachmentResults,
      cacheUsage,
    };
  }

  async *streamMessage(
    params: LLMParams,
    apiKey: string
  ): AsyncGenerator<StreamChunk> {
    const attachmentResults = this.collectAttachmentResults(params);

    // Tool-enabled and vision (image attachment) requests go through the
    // direct Chat Completions fetch path, which matches the OpenAI schema
    // OpenRouter expects for function calls and multimodal content parts.
    // The SDK's callModel/OpenResponses path doesn't round-trip image_url
    // parts reliably, so route those requests around it.
    const hasTools = params.tools && params.tools.length > 0;
    const hasImages = this.hasImageAttachments(params);
    if (hasTools || hasImages) {
      yield* this.streamViaChatCompletions(params, apiKey, attachmentResults);
      return;
    }

    const client = new OpenRouter({
      apiKey,
      httpReferer: process.env.BASE_URL || 'http://localhost:3000',
      appTitle: getQuilltapUserAgent(),
    });

    // Convert messages to SDK format for the no-tools, no-images path.
    const messages: ChatMessages[] = params.messages
      .filter(m => !(m.role === 'tool' && !m.toolCallId))
      .map((m) => {
        if (m.role === 'tool' && m.toolCallId) {
          return { role: 'tool' as any, tool_call_id: m.toolCallId, content: m.content } as any;
        }
        if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0) {
          return {
            role: 'assistant' as const,
            content: m.content || null,
            tool_calls: m.toolCalls.map(tc => ({ id: tc.id, type: tc.type, function: tc.function })),
          } as any;
        }
        return {
          role: m.role as 'system' | 'user' | 'assistant',
          content: m.content,
        };
      });

    // Convert chat messages to OpenResponses input format for callModel()
    const input = fromChatMessages(messages);

    // Build the request for callModel()
    const requestParams: any = {
      model: params.model,
      input,
      temperature: params.temperature ?? 0.7,
      maxOutputTokens: params.maxTokens ?? 4096,
      topP: params.topP ?? 1,
    };

    // Add web search tool if enabled
    if (params.webSearchEnabled) {
      requestParams.tools = requestParams.tools || [];
      requestParams.tools.push({ type: 'web_search_preview' });
    }

    // Add structured output format if specified
    if (params.responseFormat) {
      if (params.responseFormat.type === 'json_schema' && params.responseFormat.jsonSchema) {
        requestParams.text = {
          format: {
            type: 'json_schema',
            jsonSchema: {
              name: params.responseFormat.jsonSchema.name,
              strict: params.responseFormat.jsonSchema.strict ?? true,
              schema: params.responseFormat.jsonSchema.schema,
            },
          },
        };
      } else if (params.responseFormat.type === 'json_object') {
        requestParams.text = { format: { type: 'json_object' } };
      }
    }

    // Handle OpenRouter-specific profile parameters
    const profileParams = params.profileParameters as OpenRouterProfileParams | undefined;

    // Add model fallbacks if configured
    if (profileParams?.fallbackModels?.length) {
      requestParams.models = [params.model, ...profileParams.fallbackModels];
      delete requestParams.model; // Can't have both model and models
    }

    // Add provider preferences if configured
    const providerPrefs = profileParams?.providerPreferences;
    if (providerPrefs) {
      requestParams.provider = {};
      if (providerPrefs.order) requestParams.provider.order = providerPrefs.order;
      if (providerPrefs.allowFallbacks !== undefined) requestParams.provider.allowFallbacks = providerPrefs.allowFallbacks;
      if (providerPrefs.requireParameters) requestParams.provider.requireParameters = providerPrefs.requireParameters;
      if (providerPrefs.dataCollection) requestParams.provider.dataCollection = providerPrefs.dataCollection;
      if (providerPrefs.ignore) requestParams.provider.ignore = providerPrefs.ignore;
      if (providerPrefs.only) requestParams.provider.only = providerPrefs.only;
    }

    // Use callModel() which returns ModelResult with streaming capabilities
    // SDK v0.4.0 provides getTextStream() for cleaner text delta streaming
    const result = client.callModel(requestParams);

    // Stream text deltas using the new getTextStream() API
    // This is cleaner than manually extracting from chunk.choices[0].delta.content
    for await (const textDelta of result.getTextStream()) {
      if (textDelta) {
        yield {
          content: textDelta,
          done: false,
        };
      }
    }

    // After text stream ends, get the complete response with usage data
    // The ReusableReadableStream allows concurrent consumption patterns
    let response: OpenResponsesResult;
    try {
      response = await result.getResponse();
    } catch (error) {
      logger.error('Failed to get response after stream', {
        context: 'OpenRouterProvider.streamMessage',
      }, error instanceof Error ? error : undefined);
      // Yield final chunk without usage data
      yield {
        content: '',
        done: true,
        attachmentResults,
      };
      return;
    }

    // Extract usage from response
    const usage = response.usage ? {
      promptTokens: response.usage.inputTokens ?? 0,
      completionTokens: response.usage.outputTokens ?? 0,
      totalTokens: (response.usage.inputTokens ?? 0) + (response.usage.outputTokens ?? 0),
    } : undefined;

    // Extract cache usage if available
    const responseUsage = response.usage as any;
    const cacheUsage = responseUsage?.cachedTokens || responseUsage?.cacheDiscount
      ? {
          cachedTokens: responseUsage.cachedTokens,
          cacheDiscount: responseUsage.cacheDiscount,
          cacheCreationInputTokens: responseUsage.cacheCreationInputTokens,
          cacheReadInputTokens: responseUsage.cacheReadInputTokens,
        }
      : undefined;
    // Build raw response in a format compatible with our existing code
    // Include tool calls if present in the response output
    const toolCalls = response.output
      ?.filter((item: any) => item.type === 'function_call')
      .map((item: any) => ({
        id: item.callId || item.id,
        type: 'function',
        function: {
          name: item.name,
          arguments: typeof item.arguments === 'string'
            ? item.arguments
            : JSON.stringify(item.arguments),
        },
      }));

    const rawResponse = {
      choices: [{
        finishReason: response.status === 'completed' ? 'stop' : response.status,
        delta: {
          toolCalls: toolCalls?.length ? toolCalls : undefined,
        },
      }],
      usage: response.usage,
      // Include full response for debugging
      _openResponsesResponse: response,
    };

    yield {
      content: '',
      done: true,
      usage,
      attachmentResults,
      rawResponse,
      cacheUsage,
    };
  }

  /**
   * Stream via the OpenAI Chat Completions endpoint using a direct fetch.
   *
   * The OpenRouter SDK's callModel expects Zod schemas for tool inputSchema
   * (Quilltap provides JSON Schema) and the OpenResponses input format
   * doesn't round-trip multimodal image_url parts reliably, so any request
   * with tools or image attachments routes through here instead.
   */
  private async *streamViaChatCompletions(
    params: LLMParams,
    apiKey: string,
    attachmentResults: { sent: string[]; failed: { id: string; error: string }[] }
  ): AsyncGenerator<StreamChunk> {
    // Build messages in OpenAI Chat Completions format, formatting image
    // attachments inline as content parts when present.
    const messages = params.messages
      .filter(m => !(m.role === 'tool' && !m.toolCallId))
      .map((m) => {
        if (m.role === 'tool' && m.toolCallId) {
          return { role: 'tool' as const, tool_call_id: m.toolCallId, content: m.content };
        }
        if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0) {
          return {
            role: 'assistant' as const,
            content: m.content || null,
            tool_calls: m.toolCalls.map(tc => ({ id: tc.id, type: tc.type, function: tc.function })),
          };
        }
        return {
          role: m.role,
          content: this.buildMessageContent(m) as any,
        };
      });

    // Build request body
    const body: any = {
      model: params.model,
      messages,
      stream: true,
      temperature: params.temperature ?? 0.7,
      max_tokens: params.maxTokens ?? 4096,
      top_p: params.topP ?? 1,
    };

    // Convert tools to OpenAI format and attach if present
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

    // Add web search if enabled
    if (params.webSearchEnabled) {
      body.tools = body.tools || [];
      body.tools.push({ type: 'web_search_preview' });
    }

    // Handle profile parameters
    const profileParams = params.profileParameters as OpenRouterProfileParams | undefined;
    if (profileParams?.fallbackModels?.length) {
      body.route = 'fallback';
    }

    try {
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
          'HTTP-Referer': process.env.BASE_URL || 'http://localhost:3000',
          'X-Title': 'Quilltap',
          'User-Agent': getQuilltapUserAgent(),
        },
        body: JSON.stringify(body),
      });

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
      let toolCalls: any[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6);
          if (data === '[DONE]') continue;

          try {
            const chunk = JSON.parse(data);
            const choice = chunk.choices?.[0];

            if (choice?.delta?.content) {
              yield {
                content: choice.delta.content,
                done: false,
              };
            }

            // Accumulate tool calls
            if (choice?.delta?.tool_calls) {
              for (const tc of choice.delta.tool_calls) {
                const idx = tc.index;
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

            // Extract usage from final chunk
            if (chunk.usage) {
              usage = {
                promptTokens: chunk.usage.prompt_tokens ?? 0,
                completionTokens: chunk.usage.completion_tokens ?? 0,
                totalTokens: chunk.usage.total_tokens ?? 0,
              };
            }
          } catch (e) {
            // Skip malformed JSON chunks
          }
        }
      }

      // Build raw response with tool calls
      const rawResponse = {
        choices: [{
          finishReason: toolCalls.length > 0 ? 'tool_calls' : 'stop',
          delta: {
            toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
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

      const response = await client.models.list();
      const models = response.data?.map((m: any) => m.id) ?? [];
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
