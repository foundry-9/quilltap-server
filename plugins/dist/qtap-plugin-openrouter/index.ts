/**
 * OpenRouter Provider Plugin for Quilltap
 * Main entry point that exports the plugin configuration
 *
 * This plugin provides:
 * - Chat completion using 100+ models including GPT-4, Claude, Gemini, Llama, Mistral and more
 * - Image generation using various available models
 * - Text embeddings using multiple embedding models
 * - Function calling / tool use (model-dependent)
 * - Cost-aware model selection with real-time pricing
 * - Access to cutting-edge and open-source models
 */

import type {
  LLMProviderPlugin,
  EmbeddingModelInfo,
  ImageGenerationModelInfo,
} from './types';
import { OpenRouterProvider } from './provider';
import { OpenRouterEmbeddingProvider } from './embedding-provider';
import {
  createPluginLogger,
  parseOpenAIToolCalls,
  type OpenAIToolDefinition,
  type ToolCallRequest,
} from '@quilltap/plugin-utils';

const logger = createPluginLogger('qtap-plugin-openrouter');

/**
 * Plugin metadata configuration
 */
const metadata = {
  providerName: 'OPENROUTER',
  displayName: 'OpenRouter',
  description:
    'OpenRouter provides access to 100+ models including GPT-4, Claude, Gemini, Llama and more with unified pricing',
  colors: {
    bg: 'bg-orange-100',
    text: 'text-orange-800',
    icon: 'text-orange-600',
  },
  abbreviation: 'ORT',
} as const;

/**
 * Configuration requirements
 */
const config = {
  requiresApiKey: true,
  requiresBaseUrl: false,
  apiKeyLabel: 'OpenRouter API Key',
} as const;

/**
 * Supported capabilities
 */
const capabilities = {
  chat: true,
  imageGeneration: true,
  embeddings: true,
  webSearch: true,
  toolUse: false,
} as const;

/**
 * File attachment support
 * Model-dependent, so we report conservative defaults
 */
const attachmentSupport = {
  supportsAttachments: false as const,
  supportedMimeTypes: [] as string[],
  description: 'File attachment support depends on the underlying model',
  notes:
    'OpenRouter proxies to 100+ models with varying capabilities. Some models may support image/file attachments.',
};

/**
 * Message format support for multi-character chats
 * OpenRouter is conservative - name support varies by underlying model
 */
const messageFormat = {
  supportsNameField: false,
  supportedRoles: [] as ('user' | 'assistant')[],
};

/**
 * Cheap model configuration for background tasks
 */
const cheapModels = {
  defaultModel: 'openai/gpt-4o-mini',
  recommendedModels: [
    'openai/gpt-4o-mini',
    'anthropic/claude-3-haiku',
    'google/gemini-2.0-flash',
    'mistralai/mistral-7b-instruct',
  ],
};

/**
 * The OpenRouter Provider Plugin
 * Implements the LLMProviderPlugin interface for Quilltap
 * Provides access to cutting-edge and open-source models via unified API
 */
export const plugin: LLMProviderPlugin = {
  metadata,

  config,

  capabilities,

  attachmentSupport,

  // Runtime configuration
  messageFormat,
  charsPerToken: 3.5,
  toolFormat: 'openai', // OpenRouter uses OpenAI format
  cheapModels,
  defaultContextWindow: 128000,

  /**
   * Factory method to create an OpenRouter LLM provider instance
   */
  createProvider: (baseUrl?: string) => {
    return new OpenRouterProvider();
  },

  /**
   * Factory method to create an OpenRouter embedding provider instance
   */
  createEmbeddingProvider: (baseUrl?: string) => {
    return new OpenRouterEmbeddingProvider();
  },

  /**
   * Get list of available models from OpenRouter API
   * Requires a valid API key
   * Returns 100+ models from various providers
   */
  getAvailableModels: async (apiKey: string, baseUrl?: string) => {
    try {
      const provider = new OpenRouterProvider();
      const models = await provider.getAvailableModels(apiKey);
      return models;
    } catch (error) {
      logger.error(
        'Failed to fetch OpenRouter models',
        { context: 'plugin.getAvailableModels' },
        error instanceof Error ? error : undefined
      );
      return [];
    }
  },

  /**
   * Validate an OpenRouter API key
   */
  validateApiKey: async (apiKey: string, baseUrl?: string) => {
    try {
      const provider = new OpenRouterProvider();
      const isValid = await provider.validateApiKey(apiKey);
      return isValid;
    } catch (error) {
      logger.error(
        'Error validating OpenRouter API key',
        { context: 'plugin.validateApiKey' },
        error instanceof Error ? error : undefined
      );
      return false;
    }
  },

  /**
   * Get static model information
   * Returns cached information about popular OpenRouter models
   */
  getModelInfo: () => {
    return [
      {
        id: 'openai/gpt-4-turbo',
        name: 'OpenAI GPT-4 Turbo',
        contextWindow: 128000,
        maxOutputTokens: 4096,
        supportsImages: true,
        supportsTools: true,
      },
      {
        id: 'anthropic/claude-3-opus',
        name: 'Anthropic Claude 3 Opus',
        contextWindow: 200000,
        maxOutputTokens: 4096,
        supportsImages: true,
        supportsTools: true,
      },
      {
        id: 'anthropic/claude-3-sonnet',
        name: 'Anthropic Claude 3 Sonnet',
        contextWindow: 200000,
        maxOutputTokens: 4096,
        supportsImages: true,
        supportsTools: true,
      },
      {
        id: 'google/gemini-pro-1.5',
        name: 'Google Gemini 1.5 Pro',
        contextWindow: 1000000,
        maxOutputTokens: 8192,
        supportsImages: true,
        supportsTools: true,
      },
      {
        id: 'meta-llama/llama-2-70b-chat',
        name: 'Meta Llama 2 70B Chat',
        contextWindow: 4096,
        maxOutputTokens: 2048,
        supportsImages: false,
        supportsTools: false,
      },
      {
        id: 'mistralai/mistral-7b-instruct',
        name: 'Mistral 7B Instruct',
        contextWindow: 8192,
        maxOutputTokens: 4096,
        supportsImages: false,
        supportsTools: false,
      },
    ];
  },

  /**
   * Get static embedding model information
   * Returns cached information about popular OpenRouter embedding models
   */
  getEmbeddingModels: (): EmbeddingModelInfo[] => {
    return [
      {
        id: 'openai/text-embedding-3-small',
        name: 'OpenAI Text Embedding 3 Small',
        dimensions: 1536,
        description: 'OpenAI small embedding model, efficient for most use cases',
      },
      {
        id: 'openai/text-embedding-3-large',
        name: 'OpenAI Text Embedding 3 Large',
        dimensions: 3072,
        description: 'OpenAI large embedding model for highest quality',
      },
      {
        id: 'openai/text-embedding-ada-002',
        name: 'OpenAI Ada 002',
        dimensions: 1536,
        description: 'OpenAI legacy embedding model',
      },
      {
        id: 'cohere/embed-english-v3.0',
        name: 'Cohere Embed English v3',
        dimensions: 1024,
        description: 'Cohere English embedding model',
      },
      {
        id: 'cohere/embed-multilingual-v3.0',
        name: 'Cohere Embed Multilingual v3',
        dimensions: 1024,
        description: 'Cohere multilingual embedding model',
      },
      {
        id: 'voyage/voyage-large-2',
        name: 'Voyage Large 2',
        dimensions: 1536,
        description: 'Voyage AI large embedding model',
      },
      {
        id: 'voyage/voyage-code-2',
        name: 'Voyage Code 2',
        dimensions: 1536,
        description: 'Voyage AI embedding model optimized for code',
      },
    ];
  },

  /**
   * Get static image generation model information
   * Returns cached information about popular OpenRouter image generation models
   */
  getImageGenerationModels: (): ImageGenerationModelInfo[] => {
    return [
      {
        id: 'google/gemini-2.0-flash-exp:free',
        name: 'Gemini 2.0 Flash Experimental (Free)',
        supportedAspectRatios: ['1:1', '3:4', '4:3', '9:16', '16:9'],
        description:
          'Free experimental Gemini 2.0 model with image generation capabilities',
      },
      {
        id: 'google/gemini-2.5-flash-preview-05-20',
        name: 'Gemini 2.5 Flash Preview',
        supportedAspectRatios: ['1:1', '3:4', '4:3', '9:16', '16:9'],
        description:
          'Fast preview model with state-of-the-art image generation',
      },
      {
        id: 'google/gemini-2.5-flash-preview-native-image',
        name: 'Gemini 2.5 Flash Native Image',
        supportedAspectRatios: ['1:1', '3:4', '4:3', '9:16', '16:9'],
        description:
          'Native image generation variant of Gemini 2.5 Flash',
      },
      {
        id: 'google/gemini-3-pro-image-preview',
        name: 'Nano Banana Pro (Gemini 3 Pro Image)',
        supportedAspectRatios: ['1:1', '3:4', '4:3', '9:16', '16:9', '21:9'],
        description:
          'Advanced image generation with fine-grained creative controls, 2K/4K output support',
      },
    ];
  },

  /**
   * Render the OpenRouter icon
   */

  /**
   * Format tools from OpenAI format to OpenAI format
   * OpenRouter uses OpenAI format, with Grok constraints applied if needed
   *
   * @param tools Array of tools in OpenAI format
   * @returns Array of tools in OpenAI format
   */
  formatTools: (
    tools: (OpenAIToolDefinition | Record<string, unknown>)[],
  ): OpenAIToolDefinition[] => {
    try {
      const formattedTools: OpenAIToolDefinition[] = [];

      for (const tool of tools) {
        // Validate tool has function property (OpenAI format)
        if (!('function' in tool)) {
          logger.warn('Skipping tool with invalid format', {
            context: 'plugin.formatTools',
          });
          continue;
        }

        // Tools already in OpenAI format, pass through
        formattedTools.push(tool as OpenAIToolDefinition);
      }
      return formattedTools;
    } catch (error) {
      logger.error(
        'Error formatting tools for OpenRouter',
        { context: 'plugin.formatTools' },
        error instanceof Error ? error : undefined
      );
      return [];
    }
  },

  /**
   * Parse tool calls from OpenRouter response format
   * Extracts tool calls from OpenRouter API responses (OpenAI format)
   *
   * @param response OpenRouter API response object
   * @returns Array of tool call requests
   */
  parseToolCalls: (response: any): ToolCallRequest[] => {
    try {
      const toolCalls = parseOpenAIToolCalls(response);
      return toolCalls;
    } catch (error) {
      logger.error(
        'Error parsing tool calls from OpenRouter response',
        { context: 'plugin.parseToolCalls' },
        error instanceof Error ? error : undefined
      );
      return [];
    }
  },
};

export default plugin;
