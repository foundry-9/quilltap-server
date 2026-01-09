/**
 * OpenRouter Provider Implementation for Quilltap Plugin
 *
 * Provides chat completion functionality using OpenRouter's API
 * Supports 100+ models including GPT-4, Claude, Gemini, Llama and more
 */

import { OpenRouter } from '@openrouter/sdk';
import type { ChatGenerationParams, ChatStreamingResponseChunkData } from '@openrouter/sdk/models';
import type {
  LLMProvider,
  LLMParams,
  LLMResponse,
  StreamChunk,
  ImageGenParams,
  ImageGenResponse,
} from './types';
import { logger } from '../../../lib/logger';

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

export class OpenRouterProvider implements LLMProvider {
  readonly supportsFileAttachments = false; // Model-dependent, conservative default
  readonly supportedMimeTypes: string[] = [];
  readonly supportsImageGeneration = true;
  readonly supportsWebSearch = true;

  /**
   * Helper to collect attachment failures
   * OpenRouter proxies to many models, file support is model-dependent
   */
  private collectAttachmentFailures(params: LLMParams): {
    sent: string[];
    failed: { id: string; error: string }[];
  } {
    const failed: { id: string; error: string }[] = [];
    for (const msg of params.messages) {
      if (msg.attachments) {
        for (const attachment of msg.attachments) {
          failed.push({
            id: attachment.id,
            error:
              'OpenRouter file attachment support depends on model (not yet implemented)',
          });
        }
      }
    }
    return { sent: [], failed };
  }

  async sendMessage(params: LLMParams, apiKey: string): Promise<LLMResponse> {
    logger.debug('OpenRouter sendMessage called', {
      context: 'OpenRouterProvider.sendMessage',
      model: params.model,
    });

    const attachmentResults = this.collectAttachmentFailures(params);

    const client = new OpenRouter({
      apiKey,
      httpReferer: process.env.BASE_URL || 'http://localhost:3000',
      xTitle: 'Quilltap',
    });

    // Strip attachments from messages and convert to OpenRouter format
    // Filter out 'tool' role messages as they require special handling
    const messages = params.messages
      .filter(m => m.role !== 'tool')
      .map((m) => ({
        role: m.role as 'system' | 'user' | 'assistant',
        content: m.content,
      }));

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
      logger.debug('Adding tools to request', {
        context: 'OpenRouterProvider.sendMessage',
        toolCount: params.tools.length,
      });
      requestParams.tools = params.tools;
      // Explicitly enable tool use with "auto" - let the model decide when to use tools
      requestParams.toolChoice = 'auto';
    }

    // Add web search plugin if enabled
    if (params.webSearchEnabled) {
      logger.debug('Enabling web search plugin', {
        context: 'OpenRouterProvider.sendMessage',
      });
      requestParams.plugins = [{ id: 'web', maxResults: 5 }];
    }

    // Add structured output format if specified
    if (params.responseFormat) {
      if (params.responseFormat.type === 'json_schema' && params.responseFormat.jsonSchema) {
        logger.debug('Adding JSON schema response format', {
          context: 'OpenRouterProvider.sendMessage',
          schemaName: params.responseFormat.jsonSchema.name,
        });
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
      logger.debug('Adding fallback models', {
        context: 'OpenRouterProvider.sendMessage',
        fallbackCount: profileParams.fallbackModels.length,
      });
      requestParams.models = [params.model, ...profileParams.fallbackModels];
      requestParams.route = 'fallback';
      delete requestParams.model; // Can't have both model and models
    }

    // Add provider preferences if configured
    const providerPrefs = profileParams?.providerPreferences;
    if (providerPrefs) {
      logger.debug('Adding provider preferences', {
        context: 'OpenRouterProvider.sendMessage',
        hasOrder: !!providerPrefs.order,
        dataCollection: providerPrefs.dataCollection,
      });
      requestParams.provider = {};
      if (providerPrefs.order) requestParams.provider.order = providerPrefs.order;
      if (providerPrefs.allowFallbacks !== undefined) requestParams.provider.allowFallbacks = providerPrefs.allowFallbacks;
      if (providerPrefs.requireParameters) requestParams.provider.requireParameters = providerPrefs.requireParameters;
      if (providerPrefs.dataCollection) requestParams.provider.dataCollection = providerPrefs.dataCollection;
      if (providerPrefs.ignore) requestParams.provider.ignore = providerPrefs.ignore;
      if (providerPrefs.only) requestParams.provider.only = providerPrefs.only;
    }

    const response = await client.chat.send(requestParams);

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

    logger.debug('Received OpenRouter response', {
      context: 'OpenRouterProvider.sendMessage',
      finishReason: choice.finishReason,
      promptTokens: response.usage?.promptTokens,
      completionTokens: response.usage?.completionTokens,
      cachedTokens: cacheUsage?.cachedTokens,
    });

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
    logger.debug('OpenRouter streamMessage called', {
      context: 'OpenRouterProvider.streamMessage',
      model: params.model,
    });

    const attachmentResults = this.collectAttachmentFailures(params);

    const client = new OpenRouter({
      apiKey,
      httpReferer: process.env.BASE_URL || 'http://localhost:3000',
      xTitle: 'Quilltap',
    });

    // Strip attachments from messages and convert to OpenRouter format
    // Filter out 'tool' role messages as they require special handling
    const messages = params.messages
      .filter(m => m.role !== 'tool')
      .map((m) => ({
        role: m.role as 'system' | 'user' | 'assistant',
        content: m.content,
      }));

    const requestParams: ChatGenerationParams & { stream: true } = {
      model: params.model,
      messages: messages as any,
      temperature: params.temperature ?? 0.7,
      maxTokens: params.maxTokens ?? 4096,
      topP: params.topP ?? 1,
      stream: true,
      streamOptions: { includeUsage: true },
    };

    // Add tools if provided
    if (params.tools && params.tools.length > 0) {
      logger.debug('Adding tools to stream request', {
        context: 'OpenRouterProvider.streamMessage',
        toolCount: params.tools.length,
      });
      (requestParams as any).tools = params.tools;
      // Explicitly enable tool use with "auto" - let the model decide when to use tools
      requestParams.toolChoice = 'auto';
    }

    // Add web search plugin if enabled
    if (params.webSearchEnabled) {
      logger.debug('Enabling web search plugin for streaming', {
        context: 'OpenRouterProvider.streamMessage',
      });
      (requestParams as any).plugins = [{ id: 'web', maxResults: 5 }];
    }

    // Add structured output format if specified
    if (params.responseFormat) {
      if (params.responseFormat.type === 'json_schema' && params.responseFormat.jsonSchema) {
        logger.debug('Adding JSON schema response format for streaming', {
          context: 'OpenRouterProvider.streamMessage',
          schemaName: params.responseFormat.jsonSchema.name,
        });
        (requestParams as any).responseFormat = {
          type: 'json_schema',
          jsonSchema: {
            name: params.responseFormat.jsonSchema.name,
            strict: params.responseFormat.jsonSchema.strict ?? true,
            schema: params.responseFormat.jsonSchema.schema,
          },
        };
      } else if (params.responseFormat.type !== 'text') {
        (requestParams as any).responseFormat = { type: params.responseFormat.type };
      }
    }

    // Handle OpenRouter-specific profile parameters
    const profileParams = params.profileParameters as OpenRouterProfileParams | undefined;

    // Add model fallbacks if configured
    if (profileParams?.fallbackModels?.length) {
      logger.debug('Adding fallback models for streaming', {
        context: 'OpenRouterProvider.streamMessage',
        fallbackCount: profileParams.fallbackModels.length,
      });
      (requestParams as any).models = [params.model, ...profileParams.fallbackModels];
      (requestParams as any).route = 'fallback';
      delete (requestParams as any).model; // Can't have both model and models
    }

    // Add provider preferences if configured
    const providerPrefs = profileParams?.providerPreferences;
    if (providerPrefs) {
      logger.debug('Adding provider preferences for streaming', {
        context: 'OpenRouterProvider.streamMessage',
        hasOrder: !!providerPrefs.order,
        dataCollection: providerPrefs.dataCollection,
      });
      (requestParams as any).provider = {};
      if (providerPrefs.order) (requestParams as any).provider.order = providerPrefs.order;
      if (providerPrefs.allowFallbacks !== undefined) (requestParams as any).provider.allowFallbacks = providerPrefs.allowFallbacks;
      if (providerPrefs.requireParameters) (requestParams as any).provider.requireParameters = providerPrefs.requireParameters;
      if (providerPrefs.dataCollection) (requestParams as any).provider.dataCollection = providerPrefs.dataCollection;
      if (providerPrefs.ignore) (requestParams as any).provider.ignore = providerPrefs.ignore;
      if (providerPrefs.only) (requestParams as any).provider.only = providerPrefs.only;
    }

    // SDK 0.2.x returns properly typed EventStream<ChatStreamingResponseChunkData>
    const stream = await client.chat.send(requestParams);
    let fullMessage: ChatStreamingResponseChunkData | null = null;

    // Track usage and finish reason separately - they may come in different chunks
    let accumulatedUsage: { promptTokens?: number; completionTokens?: number; totalTokens?: number } | null = null;
    let finalFinishReason: string | null = null;

    for await (const chunk of stream) {
      const content = chunk.choices?.[0]?.delta?.content;
      const finishReason = chunk.choices?.[0]?.finishReason;
      const hasUsage = chunk.usage;

      // Store the most recent chunk (needed for tool calls)
      if (!fullMessage) {
        fullMessage = chunk;
      } else {
        // Merge tool calls if present
        const toolCalls = chunk.choices?.[0]?.delta?.toolCalls;
        if (toolCalls) {
          fullMessage.choices[0].delta.toolCalls ??= [];
          fullMessage.choices[0].delta.toolCalls = toolCalls;
        }
        // Update finish reason
        if (finishReason) {
          fullMessage.choices[0].finishReason = finishReason;
        }
        // Update usage
        if (hasUsage) {
          fullMessage.usage = chunk.usage;
        }
      }

      // Track finish reason when we get it
      if (finishReason) {
        finalFinishReason = finishReason;
      }

      // Track usage when we get it (may come in a separate final chunk)
      if (hasUsage) {
        accumulatedUsage = {
          promptTokens: chunk.usage?.promptTokens,
          completionTokens: chunk.usage?.completionTokens,
          totalTokens: chunk.usage?.totalTokens,
        };
        logger.debug('Received usage data in stream', {
          context: 'OpenRouterProvider.streamMessage',
          promptTokens: chunk.usage?.promptTokens,
          completionTokens: chunk.usage?.completionTokens,
        });
      }

      // Yield content chunks
      if (content) {
        yield {
          content,
          done: false,
        };
      }
    }

    // After stream ends, yield final chunk with accumulated usage
    // Extract cache usage if available
    const usageAny = accumulatedUsage as any;
    const cacheUsage = usageAny?.cachedTokens || usageAny?.cacheDiscount
      ? {
          cachedTokens: usageAny.cachedTokens,
          cacheDiscount: usageAny.cacheDiscount,
          cacheCreationInputTokens: usageAny.cacheCreationInputTokens,
          cacheReadInputTokens: usageAny.cacheReadInputTokens,
        }
      : undefined;

    logger.debug('Stream completed', {
      context: 'OpenRouterProvider.streamMessage',
      finishReason: finalFinishReason,
      promptTokens: accumulatedUsage?.promptTokens,
      completionTokens: accumulatedUsage?.completionTokens,
      hasUsage: !!accumulatedUsage,
      cachedTokens: cacheUsage?.cachedTokens,
    });

    yield {
      content: '',
      done: true,
      usage: accumulatedUsage ? {
        promptTokens: accumulatedUsage.promptTokens ?? 0,
        completionTokens: accumulatedUsage.completionTokens ?? 0,
        totalTokens: accumulatedUsage.totalTokens ?? 0,
      } : undefined,
      attachmentResults,
      rawResponse: fullMessage,
      cacheUsage,
    };
  }

  async validateApiKey(apiKey: string): Promise<boolean> {
    try {
      logger.debug('Validating OpenRouter API key', {
        context: 'OpenRouterProvider.validateApiKey',
      });
      const client = new OpenRouter({
        apiKey,
        httpReferer: process.env.BASE_URL || 'http://localhost:3000',
        xTitle: 'Quilltap',
      });
      await client.models.list();
      logger.debug('OpenRouter API key validation successful', {
        context: 'OpenRouterProvider.validateApiKey',
      });
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
      logger.debug('Fetching OpenRouter models', {
        context: 'OpenRouterProvider.getAvailableModels',
      });
      const client = new OpenRouter({
        apiKey,
        httpReferer: process.env.BASE_URL || 'http://localhost:3000',
        xTitle: 'Quilltap',
      });

      const response = await client.models.list();
      const models = response.data?.map((m: any) => m.id) ?? [];
      logger.debug('Retrieved OpenRouter models', {
        context: 'OpenRouterProvider.getAvailableModels',
        modelCount: models.length,
      });
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

  async generateImage(
    params: ImageGenParams,
    apiKey: string
  ): Promise<ImageGenResponse> {
    logger.debug('Generating image with OpenRouter', {
      context: 'OpenRouterProvider.generateImage',
      model: params.model,
      prompt: params.prompt.substring(0, 100),
    });

    const client = new OpenRouter({
      apiKey,
      httpReferer: process.env.BASE_URL || 'http://localhost:3000',
      xTitle: 'Quilltap',
    });

    const requestBody: any = {
      model: params.model ?? 'google/gemini-2.5-flash-image-preview',
      messages: [{ role: 'user', content: params.prompt }],
      modalities: ['image', 'text'], // Required for image generation
      stream: false,
    };

    // Add image configuration if aspect ratio is specified
    if (params.aspectRatio) {
      requestBody.imageConfig = { aspectRatio: params.aspectRatio };
    }

    const response = (await client.chat.send(requestBody)) as any;

    const choice = response.choices?.[0];
    if (!choice) {
      throw new Error('No choices in OpenRouter response');
    }

    const images = [];

    // Check if response includes images
    if (
      (choice.message as any).images &&
      Array.isArray((choice.message as any).images)
    ) {
      for (const image of (choice.message as any).images) {
        if (image.imageUrl?.url || image.image_url?.url) {
          // Extract base64 data from data URL
          const dataUrl = image.imageUrl?.url || image.image_url?.url;
          if (dataUrl.startsWith('data:image/')) {
            const [, base64] = dataUrl.split(',');
            const mimeType =
              dataUrl.match(/data:(image\/[^;]+)/)?.[1] || 'image/png';
            images.push({
              data: base64,
              mimeType,
            });
          }
        }
      }
    }

    if (images.length === 0) {
      throw new Error('No images returned from OpenRouter');
    }

    logger.debug('Image generation completed', {
      context: 'OpenRouterProvider.generateImage',
      imageCount: images.length,
    });

    return {
      images,
      raw: response,
    };
  }
}
