/**
 * OpenAI Provider Plugin for Quilltap
 * Main entry point that exports the plugin configuration
 *
 * This plugin provides:
 * - Chat completion using GPT-4, GPT-4o, GPT-3.5 Turbo and other OpenAI models
 * - Image generation using GPT-Image models (1.5, 1, 1-mini) and legacy DALL-E 2/3
 * - Vision capabilities (image analysis)
 * - Function calling / tool use
 * - Web search integration
 */

import type { LLMProviderPlugin, EmbeddingModelInfo } from './types';
import { OpenAIProvider } from './provider';
import { OpenAIImageProvider } from './image-provider';
import { OpenAIEmbeddingProvider } from './embedding-provider';
import {
  createPluginLogger,
  parseOpenAIToolCalls,
  type OpenAIToolDefinition,
  type ToolCallRequest,
} from '@quilltap/plugin-utils';

const logger = createPluginLogger('qtap-plugin-openai');

/**
 * Plugin metadata configuration
 */
const metadata = {
  providerName: 'OPENAI',
  displayName: 'OpenAI',
  description: 'OpenAI GPT models including GPT-4o and DALL-E image generation',
  colors: {
    bg: 'bg-green-100',
    text: 'text-green-800',
    icon: 'text-green-600',
  },
  abbreviation: 'OAI',
} as const;

/**
 * Configuration requirements
 */
const config = {
  requiresApiKey: true,
  requiresBaseUrl: false,
  apiKeyLabel: 'OpenAI API Key',
} as const;

/**
 * Supported capabilities
 */
const capabilities = {
  chat: true,
  imageGeneration: true,
  embeddings: true,
  webSearch: true,
  toolUse: true,
} as const;

/**
 * File attachment support
 */
const attachmentSupport = {
  supportsAttachments: true as const,
  supportedMimeTypes: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'] as string[],
  description: 'Images only (JPEG, PNG, GIF, WebP)',
  notes: 'Images are supported in vision-capable models like GPT-4V and GPT-4o',
  maxBase64Size: 20 * 1024 * 1024, // 20MB - OpenAI's API limit for images
};

/**
 * Message format support for multi-character chats
 */
const messageFormat = {
  supportsNameField: true,
  supportedRoles: ['user', 'assistant'] as ('user' | 'assistant')[],
  maxNameLength: 64,
};

/**
 * Cheap model configuration for background tasks
 */
const cheapModels = {
  defaultModel: 'gpt-4o-mini',
  recommendedModels: ['gpt-4o-mini', 'gpt-3.5-turbo'],
};

/**
 * The OpenAI Provider Plugin
 * Implements the LLMProviderPlugin interface for Quilltap
 */
// Re-export moderation provider for plugin system discovery
export { moderationPlugin } from './moderation-provider';

export const plugin: LLMProviderPlugin = {
  metadata,

  icon: {
    viewBox: '0 0 24 24',
    paths: [
      { d: 'M12 2L3 7.5v9L12 22l9-5.5v-9L12 2z', fill: 'currentColor' },
    ],
  },

  config,

  capabilities,

  attachmentSupport,

  // Runtime configuration
  messageFormat,
  charsPerToken: 3.5,
  toolFormat: 'openai',
  cheapModels,
  defaultContextWindow: 128000,

  /**
   * Factory method to create an OpenAI LLM provider instance
   */
  createProvider: (baseUrl?: string) => {
    return new OpenAIProvider();
  },

  /**
   * Factory method to create an OpenAI image generation provider instance
   */
  createImageProvider: (baseUrl?: string) => {
    return new OpenAIImageProvider();
  },

  /**
   * Factory method to create an OpenAI embedding provider instance
   */
  createEmbeddingProvider: (baseUrl?: string) => {
    return new OpenAIEmbeddingProvider(baseUrl);
  },

  /**
   * Get list of available models from OpenAI API
   * Requires a valid API key
   */
  getAvailableModels: async (apiKey: string, baseUrl?: string) => {
    try {
      const provider = new OpenAIProvider();
      const models = await provider.getAvailableModels(apiKey);
      return models;
    } catch (error) {
      logger.error('Failed to fetch OpenAI models', { context: 'plugin.getAvailableModels' }, error instanceof Error ? error : undefined);
      return [];
    }
  },

  /**
   * Validate an OpenAI API key
   */
  validateApiKey: async (apiKey: string, baseUrl?: string) => {
    try {
      const provider = new OpenAIProvider();
      const isValid = await provider.validateApiKey(apiKey);
      return isValid;
    } catch (error) {
      logger.error('Error validating OpenAI API key', { context: 'plugin.validateApiKey' }, error instanceof Error ? error : undefined);
      return false;
    }
  },

  /**
   * Get static model information
   * Returns cached information about OpenAI models without needing API calls
   */
  getModelInfo: () => {
    return [
      {
        id: 'gpt-4o',
        name: 'GPT-4o',
        contextWindow: 128000,
        maxOutputTokens: 4096,
        supportsImages: true,
        supportsTools: true,
      },
      {
        id: 'gpt-4-turbo',
        name: 'GPT-4 Turbo',
        contextWindow: 128000,
        maxOutputTokens: 4096,
        supportsImages: true,
        supportsTools: true,
      },
      {
        id: 'gpt-4',
        name: 'GPT-4',
        contextWindow: 8192,
        maxOutputTokens: 2048,
        supportsImages: false,
        supportsTools: true,
      },
      {
        id: 'gpt-3.5-turbo',
        name: 'GPT-3.5 Turbo',
        contextWindow: 4096,
        maxOutputTokens: 2048,
        supportsImages: false,
        supportsTools: true,
      },
    ];
  },

  /**
   * Get embedding models supported by OpenAI
   * Returns cached information about available embedding models
   */
  getEmbeddingModels: (): EmbeddingModelInfo[] => {
    return [
      {
        id: 'text-embedding-3-small',
        name: 'Text Embedding 3 Small',
        dimensions: 1536,
        description: 'Smaller, faster, and cheaper. Good for most use cases.',
      },
      {
        id: 'text-embedding-3-large',
        name: 'Text Embedding 3 Large',
        dimensions: 3072,
        description: 'Larger model with higher accuracy for complex tasks.',
      },
      {
        id: 'text-embedding-ada-002',
        name: 'Text Embedding Ada 002',
        dimensions: 1536,
        description: 'Legacy model. Consider using text-embedding-3-small instead.',
      },
    ];
  },

  /**
   * Format tools from OpenAI format to OpenAI format
   * Tools pass through as-is since OpenAI is the universal format
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
        'Error formatting tools for OpenAI',
        { context: 'plugin.formatTools' },
        error instanceof Error ? error : undefined
      );
      return [];
    }
  },

  /**
   * Parse tool calls from OpenAI response format
   * Extracts tool calls from OpenAI API responses
   *
   * @param response OpenAI API response object
   * @returns Array of tool call requests
   */
  parseToolCalls: (response: any): ToolCallRequest[] => {
    try {
      const toolCalls = parseOpenAIToolCalls(response);
      return toolCalls;
    } catch (error) {
      logger.error(
        'Error parsing tool calls from OpenAI response',
        { context: 'plugin.parseToolCalls' },
        error instanceof Error ? error : undefined
      );
      return [];
    }
  },
};

export default plugin;
