/**
 * OpenAI-Compatible Provider Base Class
 *
 * A reusable base class for building LLM providers that use OpenAI-compatible APIs.
 * This includes services like:
 * - Local LLM servers (LM Studio, vLLM, Text Generation Web UI, Ollama with OpenAI compat)
 * - Cloud services with OpenAI-compatible APIs (Gab AI, Together AI, Fireworks, etc.)
 *
 * External plugins can extend this class to create custom providers with minimal code:
 *
 * @example
 * ```typescript
 * import { OpenAICompatibleProvider } from '@quilltap/plugin-utils';
 *
 * export class MyCustomProvider extends OpenAICompatibleProvider {
 *   constructor() {
 *     super({
 *       baseUrl: 'https://api.my-service.com/v1',
 *       providerName: 'MyService',
 *       requireApiKey: true,
 *       attachmentErrorMessage: 'MyService does not support file attachments',
 *     });
 *   }
 * }
 * ```
 *
 * @packageDocumentation
 */

import OpenAI from 'openai';
import type {
  LLMProvider,
  LLMParams,
  LLMResponse,
  StreamChunk,
  ImageGenParams,
  ImageGenResponse,
  PluginLogger,
} from '@quilltap/plugin-types';
import { createPluginLogger } from '../logging';

/**
 * Configuration options for OpenAI-compatible providers.
 *
 * Use this interface when extending OpenAICompatibleProvider to customize
 * the provider's behavior for your specific service.
 */
export interface OpenAICompatibleProviderConfig {
  /**
   * Base URL for the API endpoint.
   * Should include the version path (e.g., 'https://api.example.com/v1')
   */
  baseUrl: string;

  /**
   * Provider name used for logging context.
   * This appears in log messages to identify which provider generated them.
   * @default 'OpenAICompatible'
   */
  providerName?: string;

  /**
   * Whether an API key is required for this provider.
   * If true, requests will fail with an error when no API key is provided.
   * If false, requests will use 'not-needed' as the API key (for local servers).
   * @default false
   */
  requireApiKey?: boolean;

  /**
   * Custom error message shown when file attachments are attempted.
   * @default 'OpenAI-compatible provider file attachment support varies by implementation (not yet implemented)'
   */
  attachmentErrorMessage?: string;
}

/**
 * Base provider class for OpenAI-compatible APIs.
 *
 * This class implements the full LLMProvider interface using the OpenAI SDK,
 * allowing subclasses to create custom providers with just configuration.
 *
 * Features:
 * - Streaming and non-streaming chat completions
 * - API key validation
 * - Model listing
 * - Configurable API key requirements
 * - Dynamic logging with provider name context
 *
 * @remarks
 * File attachments and image generation are not supported by default,
 * as support varies across OpenAI-compatible implementations.
 */
export class OpenAICompatibleProvider implements LLMProvider {
  /** File attachments are not supported by default */
  readonly supportsFileAttachments = false;
  /** No MIME types are supported for attachments */
  readonly supportedMimeTypes: string[] = [];
  /** Image generation is not supported by default */
  readonly supportsImageGeneration = false;
  /** Web search is not supported */
  readonly supportsWebSearch = false;

  /** Base URL for the API endpoint */
  protected readonly baseUrl: string;
  /** Provider name for logging */
  protected readonly providerName: string;
  /** Whether API key is required */
  protected readonly requireApiKey: boolean;
  /** Error message for attachment failures */
  protected readonly attachmentErrorMessage: string;
  /** Logger instance */
  protected readonly logger: PluginLogger;

  /**
   * Creates a new OpenAI-compatible provider instance.
   *
   * @param config - Configuration object or base URL string (for backward compatibility)
   */
  constructor(config: string | OpenAICompatibleProviderConfig) {
    // Support both legacy string baseUrl and new config object
    if (typeof config === 'string') {
      this.baseUrl = config;
      this.providerName = 'OpenAICompatible';
      this.requireApiKey = false;
      this.attachmentErrorMessage =
        'OpenAI-compatible provider file attachment support varies by implementation (not yet implemented)';
    } else {
      this.baseUrl = config.baseUrl;
      this.providerName = config.providerName ?? 'OpenAICompatible';
      this.requireApiKey = config.requireApiKey ?? false;
      this.attachmentErrorMessage =
        config.attachmentErrorMessage ??
        'OpenAI-compatible provider file attachment support varies by implementation (not yet implemented)';
    }

    this.logger = createPluginLogger(`${this.providerName}Provider`);
  }

  /**
   * Collects attachment failures for messages with attachments.
   * Since attachments are not supported, all attachments are marked as failed.
   *
   * @param params - LLM parameters containing messages
   * @returns Object with empty sent array and failed attachments
   */
  protected collectAttachmentFailures(
    params: LLMParams
  ): { sent: string[]; failed: { id: string; error: string }[] } {
    const failed: { id: string; error: string }[] = [];
    for (const msg of params.messages) {
      if (msg.attachments) {
        for (const attachment of msg.attachments) {
          failed.push({
            id: attachment.id,
            error: this.attachmentErrorMessage,
          });
        }
      }
    }
    return { sent: [], failed };
  }

  /**
   * Validates that an API key is provided when required.
   * @throws Error if API key is required but not provided
   */
  protected validateApiKeyRequirement(apiKey: string): void {
    if (this.requireApiKey && !apiKey) {
      throw new Error(`${this.providerName} provider requires an API key`);
    }
  }

  /**
   * Gets the effective API key to use for requests.
   * Returns 'not-needed' for providers that don't require keys.
   */
  protected getEffectiveApiKey(apiKey: string): string {
    return this.requireApiKey ? apiKey : apiKey || 'not-needed';
  }

  /**
   * Sends a message and returns the complete response.
   *
   * @param params - LLM parameters including messages, model, and settings
   * @param apiKey - API key for authentication
   * @returns Complete LLM response with content and usage statistics
   */
  async sendMessage(params: LLMParams, apiKey: string): Promise<LLMResponse> {
    this.validateApiKeyRequirement(apiKey);
    const attachmentResults = this.collectAttachmentFailures(params);

    const client = new OpenAI({
      apiKey: this.getEffectiveApiKey(apiKey),
      baseURL: this.baseUrl,
    });

    // Strip attachments from messages and filter out 'tool' role
    const messages = params.messages
      .filter((m) => m.role !== 'tool')
      .map((m) => ({
        role: m.role as 'system' | 'user' | 'assistant',
        content: m.content,
      }));

    try {
      const response = await client.chat.completions.create({
        model: params.model,
        messages,
        temperature: params.temperature ?? 0.7,
        max_tokens: params.maxTokens ?? 4096,
        top_p: params.topP ?? 1,
        stop: params.stop,
      });

      const choice = response.choices[0];
      return {
        content: choice.message.content ?? '',
        finishReason: choice.finish_reason,
        usage: {
          promptTokens: response.usage?.prompt_tokens ?? 0,
          completionTokens: response.usage?.completion_tokens ?? 0,
          totalTokens: response.usage?.total_tokens ?? 0,
        },
        raw: response,
        attachmentResults,
      };
    } catch (error) {
      this.logger.error(
        `${this.providerName} API error in sendMessage`,
        { context: `${this.providerName}Provider.sendMessage`, baseUrl: this.baseUrl },
        error instanceof Error ? error : undefined
      );
      throw error;
    }
  }

  /**
   * Sends a message and streams the response.
   *
   * @param params - LLM parameters including messages, model, and settings
   * @param apiKey - API key for authentication
   * @yields Stream chunks with content and final usage statistics
   */
  async *streamMessage(params: LLMParams, apiKey: string): AsyncGenerator<StreamChunk> {
    this.validateApiKeyRequirement(apiKey);
    const attachmentResults = this.collectAttachmentFailures(params);

    const client = new OpenAI({
      apiKey: this.getEffectiveApiKey(apiKey),
      baseURL: this.baseUrl,
    });

    // Strip attachments from messages and filter out 'tool' role
    const messages = params.messages
      .filter((m) => m.role !== 'tool')
      .map((m) => ({
        role: m.role as 'system' | 'user' | 'assistant',
        content: m.content,
      }));

    try {
      const stream = await client.chat.completions.create({
        model: params.model,
        messages,
        temperature: params.temperature ?? 0.7,
        max_tokens: params.maxTokens ?? 4096,
        top_p: params.topP ?? 1,
        stream: true,
        stream_options: { include_usage: true },
      });

      let chunkCount = 0;

      // Track usage - it may come in a separate final chunk
      let accumulatedUsage: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | null = null;

      for await (const chunk of stream) {
        chunkCount++;
        const content = chunk.choices[0]?.delta?.content;
        const hasUsage = chunk.usage;

        // Track usage when we get it (may come in a separate final chunk)
        if (hasUsage) {
          accumulatedUsage = {
            prompt_tokens: chunk.usage?.prompt_tokens,
            completion_tokens: chunk.usage?.completion_tokens,
            total_tokens: chunk.usage?.total_tokens,
          };
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
      yield {
        content: '',
        done: true,
        usage: accumulatedUsage ? {
          promptTokens: accumulatedUsage.prompt_tokens ?? 0,
          completionTokens: accumulatedUsage.completion_tokens ?? 0,
          totalTokens: accumulatedUsage.total_tokens ?? 0,
        } : undefined,
        attachmentResults,
      };
    } catch (error) {
      this.logger.error(
        `${this.providerName} API error in streamMessage`,
        { context: `${this.providerName}Provider.streamMessage`, baseUrl: this.baseUrl },
        error instanceof Error ? error : undefined
      );
      throw error;
    }
  }

  /**
   * Validates an API key by attempting to list models.
   *
   * @param apiKey - API key to validate
   * @returns true if the API key is valid, false otherwise
   */
  async validateApiKey(apiKey: string): Promise<boolean> {
    // For providers that require API key, return false if not provided
    if (this.requireApiKey && !apiKey) {
      return false;
    }

    try {
      const client = new OpenAI({
        apiKey: this.getEffectiveApiKey(apiKey),
        baseURL: this.baseUrl,
      });
      await client.models.list();
      return true;
    } catch (error) {
      this.logger.error(
        `${this.providerName} API validation failed`,
        { context: `${this.providerName}Provider.validateApiKey`, baseUrl: this.baseUrl },
        error instanceof Error ? error : undefined
      );
      return false;
    }
  }

  /**
   * Fetches available models from the API.
   *
   * @param apiKey - API key for authentication
   * @returns Sorted array of model IDs, or empty array on failure
   */
  async getAvailableModels(apiKey: string): Promise<string[]> {
    // For providers that require API key, return empty if not provided
    if (this.requireApiKey && !apiKey) {
      this.logger.error(`${this.providerName} provider requires an API key to fetch models`, {
        context: `${this.providerName}Provider.getAvailableModels`,
      });
      return [];
    }

    try {
      const client = new OpenAI({
        apiKey: this.getEffectiveApiKey(apiKey),
        baseURL: this.baseUrl,
      });
      const models = await client.models.list();
      const modelList = models.data.map((m) => m.id).sort();
      return modelList;
    } catch (error) {
      this.logger.error(
        `Failed to fetch ${this.providerName} models`,
        { context: `${this.providerName}Provider.getAvailableModels`, baseUrl: this.baseUrl },
        error instanceof Error ? error : undefined
      );
      return [];
    }
  }

  /**
   * Image generation is not supported by default.
   * @throws Error indicating image generation is not supported
   */
  async generateImage(_params: ImageGenParams, _apiKey: string): Promise<ImageGenResponse> {
    throw new Error(
      `${this.providerName} image generation support varies by implementation (not yet implemented)`
    );
  }
}
