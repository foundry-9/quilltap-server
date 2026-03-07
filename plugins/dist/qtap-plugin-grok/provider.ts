/**
 * Grok Provider Implementation for Quilltap Plugin
 *
 * Provides chat completion functionality using Grok's Responses API
 * via the OpenAI SDK pointed at https://api.x.ai/v1
 * Supports Grok models with multimodal capabilities (text + images)
 * Uses server-side tools for web search (web_search, x_search)
 */

import OpenAI from 'openai';
import type { LLMProvider, LLMParams, LLMResponse, StreamChunk, LLMMessage, ImageGenParams, ImageGenResponse } from './types';
import { createPluginLogger } from '@quilltap/plugin-utils';

const logger = createPluginLogger('qtap-plugin-grok');

// Grok supports images (text/PDF handled via fallback system)
const GROK_SUPPORTED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
];

// SDK types for the Responses API
type ResponsesInputItem = OpenAI.Responses.ResponseInputItem;
type ResponsesTool = OpenAI.Responses.Tool;
type ResponsesResponse = OpenAI.Responses.Response;
type ResponsesStreamEvent = OpenAI.Responses.ResponseStreamEvent;

export class GrokProvider implements LLMProvider {
  private readonly baseUrl = 'https://api.x.ai/v1';
  readonly supportsFileAttachments = true;
  readonly supportedMimeTypes = GROK_SUPPORTED_MIME_TYPES;
  readonly supportsImageGeneration = true;
  readonly supportsWebSearch = true;

  /**
   * Format messages from LLMMessage format to Responses API format.
   * Grok uses 'system' role directly in the input array — the `instructions`
   * parameter is NOT supported by xAI and will cause an error.
   */
  private formatMessagesForResponsesAPI(
    messages: LLMMessage[]
  ): { input: ResponsesInputItem[]; attachmentResults: { sent: string[]; failed: { id: string; error: string }[] } } {
    const sent: string[] = [];
    const failed: { id: string; error: string }[] = [];

    // Filter out 'tool' role messages as Grok Responses API doesn't support them directly
    const filteredMessages = messages.filter(m => m.role !== 'tool');

    const input: ResponsesInputItem[] = filteredMessages.map((msg) => {
      // System messages stay as 'system' role (xAI doesn't support 'developer' or 'instructions')
      if (msg.role === 'system') {
        return {
          type: 'message' as const,
          role: 'system' as const,
          content: msg.content,
        };
      }

      // Assistant messages are simple strings
      if (msg.role === 'assistant') {
        return {
          type: 'message' as const,
          role: 'assistant' as const,
          content: msg.content,
        };
      }

      // User messages need content array format
      const content: Array<OpenAI.Responses.ResponseInputText | OpenAI.Responses.ResponseInputImage> = [];

      if (msg.content) {
        content.push({ type: 'input_text', text: msg.content });
      }

      // Add file attachments
      if (msg.attachments && msg.attachments.length > 0) {
        for (const attachment of msg.attachments) {
          if (!this.supportedMimeTypes.includes(attachment.mimeType)) {
            failed.push({
              id: attachment.id,
              error: `Unsupported file type: ${attachment.mimeType}. Grok supports: ${this.supportedMimeTypes.join(', ')}`,
            });
            continue;
          }

          if (!attachment.data) {
            failed.push({
              id: attachment.id,
              error: 'File data not loaded',
            });
            continue;
          }

          // For images, use input_image format
          if (attachment.mimeType.startsWith('image/')) {
            content.push({
              type: 'input_image',
              image_url: `data:${attachment.mimeType};base64,${attachment.data}`,
              detail: 'auto',
            });
            sent.push(attachment.id);
          } else if (attachment.mimeType.startsWith('text/')) {
            // For text files, embed as text content
            try {
              const textContent = Buffer.from(attachment.data, 'base64').toString('utf-8');
              content.push({
                type: 'input_text',
                text: `[File: ${attachment.filename}]\n${textContent}`,
              });
              sent.push(attachment.id);
            } catch {
              failed.push({
                id: attachment.id,
                error: 'Failed to decode text file',
              });
            }
          } else {
            failed.push({
              id: attachment.id,
              error: 'PDF and binary document support requires Grok Files API (not yet implemented)',
            });
          }
        }
      }

      // If no content was added, add empty text to avoid empty content array
      if (content.length === 0) {
        content.push({ type: 'input_text', text: '' });
      }

      return {
        type: 'message' as const,
        role: 'user' as const,
        content,
      };
    });

    return { input, attachmentResults: { sent, failed } };
  }

  /**
   * Convert OpenAI-format tools to Responses API function tools
   */
  private formatToolsForResponsesAPI(
    tools: LLMParams['tools']
  ): OpenAI.Responses.FunctionTool[] {
    if (!tools || tools.length === 0) return [];

    return tools.map((tool) => {
      const openAITool = tool as { type: string; function: { name: string; description?: string; parameters: Record<string, unknown> } };
      const fn = openAITool.function;
      return {
        type: 'function' as const,
        name: fn.name,
        description: fn.description ?? undefined,
        parameters: fn.parameters,
        strict: false,
      };
    });
  }

  /**
   * Extract text content from Responses API response.
   * Used as fallback when output_text may not be populated by xAI.
   */
  private extractTextFromResponse(response: ResponsesResponse): string {
    // Prefer the SDK's convenience field if available
    if (response.output_text) {
      return response.output_text;
    }
    // Fallback: manually extract from output items
    let text = '';
    for (const item of response.output) {
      if (item.type === 'message') {
        for (const content of item.content) {
          if (content.type === 'output_text') {
            text += content.text;
          }
        }
      }
    }
    return text;
  }

  /**
   * Build raw response object compatible with Chat Completions format.
   * This ensures the tool call parser, Inspector, and chat log storage
   * all continue to work without changes.
   */
  private buildRawResponse(response: ResponsesResponse): Record<string, unknown> {
    const toolCalls: Array<{
      id: string;
      type: string;
      function: { name: string; arguments: string };
    }> = [];

    for (const item of response.output) {
      if (item.type === 'function_call') {
        toolCalls.push({
          id: item.call_id,
          type: 'function',
          function: {
            name: item.name,
            arguments: item.arguments,
          },
        });
      }
    }

    return {
      id: response.id,
      object: 'chat.completion',
      created: response.created_at,
      model: response.model,
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content: this.extractTextFromResponse(response),
          tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
        },
        finish_reason: toolCalls.length > 0 ? 'tool_calls' : 'stop',
      }],
      usage: {
        prompt_tokens: response.usage?.input_tokens ?? 0,
        completion_tokens: response.usage?.output_tokens ?? 0,
        total_tokens: response.usage?.total_tokens ?? 0,
      },
    };
  }

  /**
   * Determine finish reason from response
   */
  private getFinishReason(response: ResponsesResponse): string {
    for (const item of response.output) {
      if (item.type === 'function_call') {
        return 'tool_calls';
      }
    }

    if (response.status === 'completed') return 'stop';
    if (response.status === 'incomplete') return response.incomplete_details?.reason || 'length';
    if (response.status === 'failed') return 'error';

    return 'stop';
  }

  async sendMessage(params: LLMParams, apiKey: string): Promise<LLMResponse> {
    if (!apiKey) {
      throw new Error('Grok provider requires an API key');
    }

    const client = new OpenAI({
      apiKey,
      baseURL: this.baseUrl,
    });
    const { input, attachmentResults } = this.formatMessagesForResponsesAPI(params.messages);

    logger.debug('Preparing Responses API request', {
      context: 'GrokProvider.sendMessage',
      model: params.model,
      messageCount: input.length,
    });

    const requestParams: OpenAI.Responses.ResponseCreateParamsNonStreaming = {
      model: params.model,
      input,
      store: false, // Stateless operation - Quilltap manages history locally
      temperature: params.temperature ?? 0.7,
      max_output_tokens: params.maxTokens ?? 4096,
      top_p: params.topP ?? 1,
      stream: false,
    };

    if (params.stop) {
      requestParams.stop = Array.isArray(params.stop) ? params.stop : [params.stop];
    }

    // Build tools - server-side (web search) + client-side (function calling)
    const tools: ResponsesTool[] = [];

    if (params.webSearchEnabled) {
      // Grok uses web_search and x_search (not web_search_preview)
      tools.push({ type: 'web_search' } as ResponsesTool);
      tools.push({ type: 'x_search' } as ResponsesTool);
      requestParams.include = ['citations'] as OpenAI.Responses.ResponseIncludable[];
    }

    if (params.tools && params.tools.length > 0) {
      const functionTools = this.formatToolsForResponsesAPI(params.tools);
      tools.push(...functionTools);
    }

    if (tools.length > 0) {
      requestParams.tools = tools;
    }

    logger.debug('Sending Responses API request', {
      context: 'GrokProvider.sendMessage',
      model: params.model,
      toolCount: tools.length,
    });

    const response = await client.responses.create(requestParams);

    if (response.error) {
      logger.error('Responses API returned error', {
        context: 'GrokProvider.sendMessage',
        code: response.error.code,
        message: response.error.message,
      });
      throw new Error(`Grok API error: ${response.error.message}`);
    }

    const text = this.extractTextFromResponse(response);
    const finishReason = this.getFinishReason(response);
    const raw = this.buildRawResponse(response);

    logger.debug('Responses API request completed', {
      context: 'GrokProvider.sendMessage',
      model: response.model,
      status: response.status,
      finishReason,
      inputTokens: response.usage?.input_tokens,
      outputTokens: response.usage?.output_tokens,
      cachedTokens: response.usage?.input_tokens_details?.cached_tokens,
    });

    return {
      content: text,
      finishReason,
      usage: {
        promptTokens: response.usage?.input_tokens ?? 0,
        completionTokens: response.usage?.output_tokens ?? 0,
        totalTokens: response.usage?.total_tokens ?? 0,
      },
      raw,
      attachmentResults,
    };
  }

  async *streamMessage(params: LLMParams, apiKey: string): AsyncGenerator<StreamChunk> {
    if (!apiKey) {
      throw new Error('Grok provider requires an API key');
    }

    const client = new OpenAI({
      apiKey,
      baseURL: this.baseUrl,
    });
    const { input, attachmentResults } = this.formatMessagesForResponsesAPI(params.messages);

    logger.debug('Preparing streaming Responses API request', {
      context: 'GrokProvider.streamMessage',
      model: params.model,
      messageCount: input.length,
    });

    const requestParams: OpenAI.Responses.ResponseCreateParamsStreaming = {
      model: params.model,
      input,
      store: false,
      temperature: params.temperature ?? 0.7,
      max_output_tokens: params.maxTokens ?? 4096,
      top_p: params.topP ?? 1,
      stream: true,
    };

    if (params.stop) {
      requestParams.stop = Array.isArray(params.stop) ? params.stop : [params.stop];
    }

    const tools: ResponsesTool[] = [];

    if (params.webSearchEnabled) {
      tools.push({ type: 'web_search' } as ResponsesTool);
      tools.push({ type: 'x_search' } as ResponsesTool);
      requestParams.include = ['citations'] as OpenAI.Responses.ResponseIncludable[];
    }

    if (params.tools && params.tools.length > 0) {
      const functionTools = this.formatToolsForResponsesAPI(params.tools);
      tools.push(...functionTools);
    }

    if (tools.length > 0) {
      requestParams.tools = tools;
    }

    logger.debug('Sending streaming Responses API request', {
      context: 'GrokProvider.streamMessage',
      model: params.model,
    });

    const stream = await client.responses.create(requestParams);

    let finalResponse: ResponsesResponse | null = null;

    for await (const event of stream as AsyncIterable<ResponsesStreamEvent>) {
      if (event.type === 'response.output_text.delta') {
        yield {
          content: event.delta,
          done: false,
        };
      } else if (event.type === 'response.output_item.added') {
        if (event.item.type === 'function_call') {
          logger.debug('Function call started', {
            context: 'GrokProvider.streamMessage',
            itemId: event.item.id,
            name: event.item.name,
          });
        }
      } else if (event.type === 'response.completed') {
        finalResponse = event.response;
        logger.debug('Stream completed', {
          context: 'GrokProvider.streamMessage',
          status: finalResponse.status,
          inputTokens: finalResponse.usage?.input_tokens,
          outputTokens: finalResponse.usage?.output_tokens,
          cachedTokens: finalResponse.usage?.input_tokens_details?.cached_tokens,
        });
      }
    }

    // Build final response
    if (finalResponse) {
      const raw = this.buildRawResponse(finalResponse);

      yield {
        content: '',
        done: true,
        usage: {
          promptTokens: finalResponse.usage?.input_tokens ?? 0,
          completionTokens: finalResponse.usage?.output_tokens ?? 0,
          totalTokens: finalResponse.usage?.total_tokens ?? 0,
        },
        attachmentResults,
        rawResponse: raw,
      };
    } else {
      logger.warn('Stream ended without response.completed event', {
        context: 'GrokProvider.streamMessage',
      });
      yield {
        content: '',
        done: true,
        usage: {
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
        },
        attachmentResults,
      };
    }
  }

  async validateApiKey(apiKey: string): Promise<boolean> {
    try {
      const client = new OpenAI({
        apiKey,
        baseURL: this.baseUrl,
      });
      await client.models.list();
      return true;
    } catch (error) {
      logger.error('Grok API key validation failed', { context: 'GrokProvider.validateApiKey' }, error instanceof Error ? error : undefined);
      return false;
    }
  }

  async getAvailableModels(apiKey: string): Promise<string[]> {
    try {
      const client = new OpenAI({
        apiKey,
        baseURL: this.baseUrl,
      });
      const models = await client.models.list();
      const grokModels = models.data
        .map((m) => m.id)
        .sort();
      return grokModels;
    } catch (error) {
      logger.error('Failed to fetch Grok models', { context: 'GrokProvider.getAvailableModels' }, error instanceof Error ? error : undefined);
      return [];
    }
  }

  async generateImage(params: ImageGenParams, apiKey: string): Promise<ImageGenResponse> {
    if (!apiKey) {
      throw new Error('Grok provider requires an API key');
    }

    const client = new OpenAI({
      apiKey,
      baseURL: this.baseUrl,
    });

    const response = await client.images.generate({
      model: params.model ?? 'grok-2-image',
      prompt: params.prompt,
      n: params.n ?? 1,
      response_format: 'b64_json',
    });

    const images = await Promise.all(
      (response.data || []).map(async (image) => {
        if (!image.b64_json) {
          throw new Error('No base64 image data in response');
        }

        return {
          data: image.b64_json,
          mimeType: 'image/jpeg',
          revisedPrompt: image.revised_prompt,
        };
      })
    );
    return {
      images,
      raw: response,
    };
  }
}
