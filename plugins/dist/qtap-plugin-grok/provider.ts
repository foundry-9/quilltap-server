/**
 * Grok Provider Implementation for Quilltap Plugin
 *
 * Provides chat completion functionality using Grok's Responses API
 * Supports Grok models with multimodal capabilities (text + images)
 * Uses server-side tools for web search (web_search, x_search)
 * Grok API endpoint: https://api.x.ai/v1
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

// ============================================================================
// Responses API Types
// ============================================================================

/**
 * Input types for the Responses API
 * Messages can be system instructions, user input, or assistant responses
 */
type ResponsesInput =
  | ResponsesSystemInput
  | ResponsesUserInput
  | ResponsesAssistantInput;

interface ResponsesSystemInput {
  type: 'message';
  role: 'system';
  content: string;
}

interface ResponsesUserInput {
  type: 'message';
  role: 'user';
  content: ResponsesUserContent[];
}

interface ResponsesAssistantInput {
  type: 'message';
  role: 'assistant';
  content: string;
}

/**
 * Content types for user messages
 */
type ResponsesUserContent =
  | { type: 'input_text'; text: string }
  | { type: 'input_image'; image_url: string; detail?: 'auto' | 'low' | 'high' };

/**
 * Server-side tools for the Responses API
 * web_search: Searches the web
 * x_search: Searches X/Twitter
 */
interface ResponsesServerTool {
  type: 'web_search' | 'x_search';
}

/**
 * Client-side function tool for the Responses API
 */
interface ResponsesFunctionTool {
  type: 'function';
  name: string;
  description?: string;
  parameters: Record<string, unknown>;
  strict?: boolean;
}

/**
 * Request body for the Responses API
 */
interface ResponsesAPIRequest {
  model: string;
  input: ResponsesInput[];
  store?: boolean;
  temperature?: number;
  max_output_tokens?: number;
  top_p?: number;
  stop?: string[];
  tools?: (ResponsesServerTool | ResponsesFunctionTool)[];
  include?: string[];
  stream?: boolean;
}

/**
 * Response output item types
 */
interface ResponsesOutputMessage {
  type: 'message';
  id: string;
  status: string;
  role: 'assistant';
  content: ResponsesOutputContent[];
}

interface ResponsesOutputContent {
  type: 'output_text';
  text: string;
  annotations?: ResponsesAnnotation[];
}

interface ResponsesAnnotation {
  type: 'url_citation';
  url: string;
  title?: string;
  start_index: number;
  end_index: number;
}

interface ResponsesFunctionCall {
  type: 'function_call';
  id: string;
  call_id: string;
  name: string;
  arguments: string;
  status: string;
}

interface ResponsesWebSearchCall {
  type: 'web_search_call';
  id: string;
  status: string;
}

type ResponsesOutputItem = ResponsesOutputMessage | ResponsesFunctionCall | ResponsesWebSearchCall;

/**
 * Full response from the Responses API
 */
interface ResponsesAPIResponse {
  id: string;
  object: string;
  created_at: number;
  status: string;
  error?: { code: string; message: string };
  incomplete_details?: { reason: string };
  model: string;
  output: ResponsesOutputItem[];
  usage: {
    input_tokens: number;
    input_tokens_details?: { cached_tokens: number };
    output_tokens: number;
    output_tokens_details?: { reasoning_tokens: number };
    total_tokens: number;
  };
}

/**
 * SSE stream event types
 */
interface StreamEventDelta {
  type: 'response.output_text.delta';
  item_id: string;
  output_index: number;
  content_index: number;
  delta: string;
}

interface StreamEventDone {
  type: 'response.output_text.done';
  item_id: string;
  output_index: number;
  content_index: number;
  text: string;
}

interface StreamEventCompleted {
  type: 'response.completed';
  response: ResponsesAPIResponse;
}

interface StreamEventFunctionCallDelta {
  type: 'response.function_call_arguments.delta';
  item_id: string;
  output_index: number;
  delta: string;
}

interface StreamEventFunctionCallDone {
  type: 'response.function_call_arguments.done';
  item_id: string;
  output_index: number;
  arguments: string;
}

interface StreamEventOutputItemAdded {
  type: 'response.output_item.added';
  output_index: number;
  item: ResponsesOutputItem;
}

type StreamEvent =
  | StreamEventDelta
  | StreamEventDone
  | StreamEventCompleted
  | StreamEventFunctionCallDelta
  | StreamEventFunctionCallDone
  | StreamEventOutputItemAdded
  | { type: string; [key: string]: unknown };

// ============================================================================
// Provider Implementation
// ============================================================================

export class GrokProvider implements LLMProvider {
  private readonly baseUrl = 'https://api.x.ai/v1';
  readonly supportsFileAttachments = true;
  readonly supportedMimeTypes = GROK_SUPPORTED_MIME_TYPES;
  readonly supportsImageGeneration = true;
  readonly supportsWebSearch = true;

  /**
   * Format messages from LLMMessage format to Responses API format
   * Handles text, image attachments, and role conversion
   */
  private formatMessagesForResponsesAPI(
    messages: LLMMessage[]
  ): { input: ResponsesInput[]; attachmentResults: { sent: string[]; failed: { id: string; error: string }[] } } {
    const sent: string[] = [];
    const failed: { id: string; error: string }[] = [];

    // Filter out 'tool' role messages as Grok Responses API doesn't support them directly
    const filteredMessages = messages.filter(m => m.role !== 'tool');

    const input: ResponsesInput[] = filteredMessages.map((msg) => {
      // System messages are simple strings
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
      const content: ResponsesUserContent[] = [];

      // Add text content first
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

          // For images, use input_image format (Responses API format)
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
            // PDFs and other binary documents - mark as failed
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
  ): ResponsesFunctionTool[] {
    if (!tools || tools.length === 0) return [];

    return tools.map((tool) => {
      // Cast to expected OpenAI tool format
      const openAITool = tool as { type: string; function: { name: string; description?: string; parameters: Record<string, unknown> } };
      const fn = openAITool.function;
      return {
        type: 'function' as const,
        name: fn.name,
        description: fn.description,
        parameters: fn.parameters,
        strict: false,
      };
    });
  }

  /**
   * Extract text content from Responses API response
   */
  private extractTextFromResponse(response: ResponsesAPIResponse): string {
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
   * Build raw response object compatible with OpenAI format for tool parsing
   */
  private buildRawResponse(response: ResponsesAPIResponse): Record<string, unknown> {
    // Extract function calls from output
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

    // Build OpenAI-compatible response structure
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
        prompt_tokens: response.usage.input_tokens,
        completion_tokens: response.usage.output_tokens,
        total_tokens: response.usage.total_tokens,
      },
    };
  }

  /**
   * Determine finish reason from response
   */
  private getFinishReason(response: ResponsesAPIResponse): string {
    // Check if there are function calls
    for (const item of response.output) {
      if (item.type === 'function_call') {
        return 'tool_calls';
      }
    }

    // Check response status
    if (response.status === 'completed') {
      return 'stop';
    }
    if (response.status === 'incomplete') {
      return response.incomplete_details?.reason || 'length';
    }
    if (response.status === 'failed') {
      return 'error';
    }

    return 'stop';
  }

  async sendMessage(params: LLMParams, apiKey: string): Promise<LLMResponse> {
    if (!apiKey) {
      throw new Error('Grok provider requires an API key');
    }

    const { input, attachmentResults } = this.formatMessagesForResponsesAPI(params.messages);

    const requestBody: ResponsesAPIRequest = {
      model: params.model,
      input,
      store: false, // Stateless operation - Quilltap manages history locally
      temperature: params.temperature ?? 0.7,
      max_output_tokens: params.maxTokens ?? 4096,
      top_p: params.topP ?? 1,
    };

    if (params.stop) {
      // Normalize stop to always be an array
      requestBody.stop = Array.isArray(params.stop) ? params.stop : [params.stop];
    }

    // Add tools - either server-side (web search) or client-side (function calling)
    // Note: Server-side tools and client-side function calling can coexist
    const tools: (ResponsesServerTool | ResponsesFunctionTool)[] = [];

    // Add web search tools if enabled
    if (params.webSearchEnabled) {
      tools.push({ type: 'web_search' });
      tools.push({ type: 'x_search' });
      // Request inline citations for web search results
      requestBody.include = ['citations'];
    }

    // Add function calling tools if provided
    if (params.tools && params.tools.length > 0) {
      const functionTools = this.formatToolsForResponsesAPI(params.tools);
      tools.push(...functionTools);
    }

    if (tools.length > 0) {
      requestBody.tools = tools;
    }

    const response = await fetch(`${this.baseUrl}/responses`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error('Responses API request failed', {
        context: 'GrokProvider.sendMessage',
        status: response.status,
        error: errorText,
      });
      throw new Error(`Grok API error (${response.status}): ${errorText}`);
    }

    const data = await response.json() as ResponsesAPIResponse;

    const text = this.extractTextFromResponse(data);
    const finishReason = this.getFinishReason(data);
    const raw = this.buildRawResponse(data);

    return {
      content: text,
      finishReason,
      usage: {
        promptTokens: data.usage.input_tokens,
        completionTokens: data.usage.output_tokens,
        totalTokens: data.usage.total_tokens,
      },
      raw,
      attachmentResults,
    };
  }

  async *streamMessage(params: LLMParams, apiKey: string): AsyncGenerator<StreamChunk> {
    if (!apiKey) {
      throw new Error('Grok provider requires an API key');
    }

    const { input, attachmentResults } = this.formatMessagesForResponsesAPI(params.messages);

    const requestBody: ResponsesAPIRequest = {
      model: params.model,
      input,
      store: false,
      temperature: params.temperature ?? 0.7,
      max_output_tokens: params.maxTokens ?? 4096,
      top_p: params.topP ?? 1,
      stream: true,
    };

    if (params.stop) {
      // Normalize stop to always be an array
      requestBody.stop = Array.isArray(params.stop) ? params.stop : [params.stop];
    }

    // Add tools
    const tools: (ResponsesServerTool | ResponsesFunctionTool)[] = [];

    if (params.webSearchEnabled) {
      tools.push({ type: 'web_search' });
      tools.push({ type: 'x_search' });
      requestBody.include = ['citations'];
    }

    if (params.tools && params.tools.length > 0) {
      const functionTools = this.formatToolsForResponsesAPI(params.tools);
      tools.push(...functionTools);
    }

    if (tools.length > 0) {
      requestBody.tools = tools;
    }

    const response = await fetch(`${this.baseUrl}/responses`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error('Streaming Responses API request failed', {
        context: 'GrokProvider.streamMessage',
        status: response.status,
        error: errorText,
      });
      throw new Error(`Grok API error (${response.status}): ${errorText}`);
    }

    if (!response.body) {
      throw new Error('No response body received from Grok API');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let accumulatedContent = '';
    let finalResponse: ResponsesAPIResponse | null = null;

    // Track function call arguments being built
    const functionCallArgs: Map<string, string> = new Map();
    const functionCallItems: Map<string, ResponsesFunctionCall> = new Map();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Process SSE events from buffer
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // Keep incomplete line in buffer

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6).trim();
            if (data === '[DONE]') {
              continue;
            }

            try {
              const event = JSON.parse(data) as StreamEvent;

              if (event.type === 'response.output_text.delta') {
                const delta = (event as StreamEventDelta).delta;
                accumulatedContent += delta;
                yield {
                  content: delta,
                  done: false,
                };
              } else if (event.type === 'response.output_item.added') {
                const addedEvent = event as StreamEventOutputItemAdded;
                if (addedEvent.item.type === 'function_call') {
                  // Store function call item for later
                  functionCallItems.set(addedEvent.item.id, addedEvent.item);
                  functionCallArgs.set(addedEvent.item.id, '');
                }
              } else if (event.type === 'response.function_call_arguments.delta') {
                const fcDelta = event as StreamEventFunctionCallDelta;
                const existing = functionCallArgs.get(fcDelta.item_id) || '';
                functionCallArgs.set(fcDelta.item_id, existing + fcDelta.delta);
              } else if (event.type === 'response.completed') {
                finalResponse = (event as StreamEventCompleted).response;
              }
            } catch (parseError) {
              // Failed to parse SSE event - continue processing
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    // Build final response
    if (finalResponse) {
      const raw = this.buildRawResponse(finalResponse);
      const finishReason = this.getFinishReason(finalResponse);

      yield {
        content: '',
        done: true,
        usage: {
          promptTokens: finalResponse.usage.input_tokens,
          completionTokens: finalResponse.usage.output_tokens,
          totalTokens: finalResponse.usage.total_tokens,
        },
        attachmentResults,
        rawResponse: raw,
      };
    } else {
      // No final response received, yield with accumulated content
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
      // Use models endpoint for validation (still works)
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
