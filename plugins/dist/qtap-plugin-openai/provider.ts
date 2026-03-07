/**
 * OpenAI Provider Implementation for Quilltap Plugin
 *
 * Provides chat completion functionality using OpenAI's Responses API
 * Supports GPT models with multimodal capabilities (text + images)
 * Uses server-side tools for web search (web_search_preview)
 * Migrated from Chat Completions API to Responses API for better
 * cache utilization, reasoning model support, and future-proofing.
 */

import OpenAI from 'openai';
import type { LLMProvider, LLMParams, LLMResponse, StreamChunk, LLMMessage, ImageGenParams, ImageGenResponse } from './types';
import { createPluginLogger } from '@quilltap/plugin-utils';

const logger = createPluginLogger('qtap-plugin-openai');

// OpenAI supports images in vision-capable models
const OPENAI_SUPPORTED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
];

// Reasoning models don't support temperature, top_p, and other sampling parameters
// See: https://platform.openai.com/docs/guides/reasoning
const REASONING_MODEL_PREFIXES = ['o1', 'o3', 'o4', 'gpt-5'];

function isReasoningModel(model: string): boolean {
  const modelLower = model.toLowerCase();
  return REASONING_MODEL_PREFIXES.some(prefix => modelLower.startsWith(prefix));
}

// SDK types for the Responses API
type ResponsesInputItem = OpenAI.Responses.ResponseInputItem;
type ResponsesTool = OpenAI.Responses.Tool;
type ResponsesResponse = OpenAI.Responses.Response;
type ResponsesStreamEvent = OpenAI.Responses.ResponseStreamEvent;

export class OpenAIProvider implements LLMProvider {
  readonly supportsFileAttachments = true;
  readonly supportedMimeTypes = OPENAI_SUPPORTED_MIME_TYPES;
  readonly supportsImageGeneration = true;
  readonly supportsWebSearch = true;

  /**
   * Format messages from LLMMessage format to Responses API input format.
   * The first system message is extracted as top-level instructions.
   * Additional system messages become 'developer' role messages.
   */
  private formatMessagesForResponsesAPI(
    messages: LLMMessage[]
  ): { input: ResponsesInputItem[]; instructions: string | undefined; attachmentResults: { sent: string[]; failed: { id: string; error: string }[] } } {
    const sent: string[] = [];
    const failed: { id: string; error: string }[] = [];

    // Filter out 'tool' role messages as Responses API doesn't support them directly
    const filteredMessages = messages.filter(m => m.role !== 'tool');

    // Extract the first system message as top-level instructions
    let instructions: string | undefined;
    const inputMessages: LLMMessage[] = [];

    for (const msg of filteredMessages) {
      if (msg.role === 'system' && instructions === undefined) {
        instructions = msg.content;
      } else {
        inputMessages.push(msg);
      }
    }

    const input: ResponsesInputItem[] = inputMessages.map((msg) => {
      // Additional system messages become 'developer' role in Responses API
      if (msg.role === 'system') {
        return {
          type: 'message' as const,
          role: 'developer' as const,
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

      // User messages need content array format for image support
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
              error: `Unsupported file type: ${attachment.mimeType}. OpenAI supports: ${this.supportedMimeTypes.join(', ')}`,
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

          content.push({
            type: 'input_image',
            image_url: `data:${attachment.mimeType};base64,${attachment.data}`,
            detail: 'auto',
          });
          sent.push(attachment.id);
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

    return { input, instructions, attachmentResults: { sent, failed } };
  }

  /**
   * Convert Chat Completions-format tools to Responses API function tools
   */
  private formatToolsForResponsesAPI(
    tools: LLMParams['tools']
  ): OpenAI.Responses.FunctionTool[] {
    if (!tools || tools.length === 0) return [];

    return tools.map((tool) => {
      const chatTool = tool as { type: string; function: { name: string; description?: string; parameters: Record<string, unknown> } };
      const fn = chatTool.function;
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
   * Build raw response object compatible with Chat Completions format.
   * This ensures the streaming service, tool call parser, Inspector,
   * and chat log storage all continue to work without changes.
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
          content: response.output_text,
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

  /**
   * Build the text format configuration for structured output
   */
  private buildTextConfig(responseFormat?: LLMParams['responseFormat']): OpenAI.Responses.ResponseTextConfig | undefined {
    if (!responseFormat) return undefined;

    if (responseFormat.type === 'json_object') {
      return { format: { type: 'json_object' } };
    }

    if (responseFormat.type === 'json_schema' && responseFormat.jsonSchema) {
      return {
        format: {
          type: 'json_schema',
          name: responseFormat.jsonSchema.name || 'response',
          schema: responseFormat.jsonSchema.schema as Record<string, unknown>,
          strict: responseFormat.jsonSchema.strict ?? true,
        },
      };
    }

    return undefined;
  }

  async sendMessage(params: LLMParams, apiKey: string): Promise<LLMResponse> {
    const isReasoning = isReasoningModel(params.model);
    const client = new OpenAI({
      apiKey,
      dangerouslyAllowBrowser: process.env.NODE_ENV === 'test',
    });
    const { input, instructions, attachmentResults } = this.formatMessagesForResponsesAPI(params.messages);

    logger.debug('Preparing Responses API request', {
      context: 'OpenAIProvider.sendMessage',
      model: params.model,
      isReasoning,
      messageCount: input.length,
      hasInstructions: !!instructions,
      hasTools: !!(params.tools && params.tools.length > 0),
      webSearchEnabled: !!params.webSearchEnabled,
    });

    const requestParams: OpenAI.Responses.ResponseCreateParamsNonStreaming = {
      model: params.model,
      input,
      store: false, // Stateless operation - Quilltap manages history locally
      max_output_tokens: params.maxTokens ?? 4096,
      stream: false,
    };

    if (instructions) {
      requestParams.instructions = instructions;
    }

    // Reasoning models don't support temperature, top_p, or other sampling parameters
    if (!isReasoning) {
      requestParams.top_p = params.topP ?? 1;

      if (params.temperature !== undefined) {
        requestParams.temperature = params.temperature;
      }
    } else {
      // Reasoning models use internal reasoning tokens before generating output
      const minTokensForReasoning = 4096;
      if ((params.maxTokens ?? 0) < minTokensForReasoning) {
        requestParams.max_output_tokens = minTokensForReasoning;
      }
    }

    // Build tools array - server-side web search + client-side function tools
    const tools: ResponsesTool[] = [];

    if (params.webSearchEnabled) {
      tools.push({ type: 'web_search_preview' });
      requestParams.include = ['web_search_call.action.sources'];
    }

    if (params.tools && params.tools.length > 0) {
      const functionTools = this.formatToolsForResponsesAPI(params.tools);
      tools.push(...functionTools);
    }

    if (tools.length > 0) {
      requestParams.tools = tools;
    }

    // Add structured output format
    const textConfig = this.buildTextConfig(params.responseFormat);
    if (textConfig) {
      requestParams.text = textConfig;
    }

    logger.debug('Sending Responses API request', {
      context: 'OpenAIProvider.sendMessage',
      model: params.model,
      toolCount: tools.length,
    });

    const response = await client.responses.create(requestParams);

    if (response.error) {
      logger.error('Responses API returned error', {
        context: 'OpenAIProvider.sendMessage',
        code: response.error.code,
        message: response.error.message,
      });
      throw new Error(`OpenAI API error: ${response.error.message}`);
    }

    const finishReason = this.getFinishReason(response);
    const raw = this.buildRawResponse(response);

    logger.debug('Responses API request completed', {
      context: 'OpenAIProvider.sendMessage',
      model: response.model,
      status: response.status,
      finishReason,
      inputTokens: response.usage?.input_tokens,
      outputTokens: response.usage?.output_tokens,
      cachedTokens: response.usage?.input_tokens_details?.cached_tokens,
      reasoningTokens: response.usage?.output_tokens_details?.reasoning_tokens,
    });

    return {
      content: response.output_text,
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
    const isReasoning = isReasoningModel(params.model);
    const client = new OpenAI({
      apiKey,
      dangerouslyAllowBrowser: process.env.NODE_ENV === 'test',
    });
    const { input, instructions, attachmentResults } = this.formatMessagesForResponsesAPI(params.messages);

    logger.debug('Preparing streaming Responses API request', {
      context: 'OpenAIProvider.streamMessage',
      model: params.model,
      isReasoning,
      messageCount: input.length,
      hasInstructions: !!instructions,
    });

    const requestParams: OpenAI.Responses.ResponseCreateParamsStreaming = {
      model: params.model,
      input,
      store: false,
      max_output_tokens: params.maxTokens ?? 4096,
      stream: true,
    };

    if (instructions) {
      requestParams.instructions = instructions;
    }

    if (!isReasoning) {
      requestParams.top_p = params.topP ?? 1;

      if (params.temperature !== undefined) {
        requestParams.temperature = params.temperature;
      }
    } else {
      const minTokensForReasoning = 4096;
      if ((params.maxTokens ?? 0) < minTokensForReasoning) {
        requestParams.max_output_tokens = minTokensForReasoning;
      }
    }

    const tools: ResponsesTool[] = [];

    if (params.webSearchEnabled) {
      tools.push({ type: 'web_search_preview' });
      requestParams.include = ['web_search_call.action.sources'];
    }

    if (params.tools && params.tools.length > 0) {
      const functionTools = this.formatToolsForResponsesAPI(params.tools);
      tools.push(...functionTools);
    }

    if (tools.length > 0) {
      requestParams.tools = tools;
    }

    const textConfig = this.buildTextConfig(params.responseFormat);
    if (textConfig) {
      requestParams.text = textConfig;
    }

    logger.debug('Sending streaming Responses API request', {
      context: 'OpenAIProvider.streamMessage',
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
            context: 'OpenAIProvider.streamMessage',
            itemId: event.item.id,
            name: event.item.name,
          });
        }
      } else if (event.type === 'response.completed') {
        finalResponse = event.response;
        logger.debug('Stream completed', {
          context: 'OpenAIProvider.streamMessage',
          status: finalResponse.status,
          inputTokens: finalResponse.usage?.input_tokens,
          outputTokens: finalResponse.usage?.output_tokens,
          cachedTokens: finalResponse.usage?.input_tokens_details?.cached_tokens,
          reasoningTokens: finalResponse.usage?.output_tokens_details?.reasoning_tokens,
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
        context: 'OpenAIProvider.streamMessage',
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
      const client = new OpenAI({ apiKey });
      await client.models.list();
      return true;
    } catch (error) {
      logger.error('OpenAI API key validation failed', { context: 'OpenAIProvider.validateApiKey' }, error instanceof Error ? error : undefined);
      return false;
    }
  }

  async getAvailableModels(apiKey: string): Promise<string[]> {
    try {
      const client = new OpenAI({ apiKey });
      const models = await client.models.list();
      // Filter for Responses API-compatible chat models
      const chatModelPrefixes = ['gpt-4', 'gpt-5', 'o1', 'o3', 'o4'];
      const chatModels = models.data
        .filter((m) => chatModelPrefixes.some(prefix => m.id.startsWith(prefix)))
        .map((m) => m.id)
        .sort();
      return chatModels;
    } catch (error) {
      logger.error('Failed to fetch OpenAI models', { context: 'OpenAIProvider.getAvailableModels' }, error instanceof Error ? error : undefined);
      return [];
    }
  }

  async generateImage(params: ImageGenParams, apiKey: string): Promise<ImageGenResponse> {
    const client = new OpenAI({ apiKey });

    const response = await client.images.generate({
      model: params.model ?? 'dall-e-3',
      prompt: params.prompt,
      n: params.n ?? 1,
      size: (params.size ?? '1024x1024') as '256x256' | '512x512' | '1024x1024' | '1792x1024' | '1024x1792',
      quality: params.quality ?? 'standard',
      style: params.style ?? 'vivid',
      response_format: 'b64_json',
    });

    const images = await Promise.all(
      (response.data || []).map(async (image) => {
        if (!image.b64_json) {
          throw new Error('No base64 image data in response');
        }

        return {
          data: image.b64_json,
          mimeType: 'image/png',
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
