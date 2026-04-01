/**
 * Ollama Provider Plugin for Quilltap
 * Main entry point that exports the plugin configuration
 *
 * This plugin provides:
 * - Chat completion using any Ollama-compatible model
 * - Support for local and remote Ollama servers
 * - Offline AI inference capabilities
 * - Support for multimodal models like llava
 * - Embeddings support through compatible models
 */

import type { LLMProviderPlugin, EmbeddingModelInfo } from './types';
import { OllamaProvider } from './provider';
import { OllamaEmbeddingProvider } from './embedding-provider';
import {
  createPluginLogger,
  parseOpenAIToolCalls,
  type OpenAIToolDefinition,
  type ToolCallRequest,
} from '@quilltap/plugin-utils';

const logger = createPluginLogger('qtap-plugin-ollama');

/**
 * Plugin metadata configuration
 */
const metadata = {
  providerName: 'OLLAMA',
  displayName: 'Ollama',
  description: 'Local Ollama LLM models for offline AI inference',
  colors: {
    bg: 'bg-gray-100',
    text: 'text-gray-800',
    icon: 'text-gray-600',
  },
  abbreviation: 'OLL',
} as const;

/**
 * Configuration requirements
 */
const config = {
  requiresApiKey: false,
  requiresBaseUrl: true,
  baseUrlLabel: 'Ollama Base URL',
  baseUrlDefault: 'http://localhost:11434',
} as const;

/**
 * Supported capabilities
 */
const capabilities = {
  chat: true,
  imageGeneration: false,
  embeddings: true,
  webSearch: false,
  toolUse: false,
} as const;

/**
 * File attachment support
 */
const attachmentSupport = {
  supportsAttachments: false as const,
  supportedMimeTypes: [] as string[],
  description: 'File attachments not yet supported (requires multimodal model detection)',
  notes: 'Multimodal models like llava can process images, but require model-specific implementation',
};

/**
 * Message format support for multi-character chats
 * Ollama is conservative - name support varies by model
 */
const messageFormat = {
  supportsNameField: false,
  supportedRoles: [] as ('user' | 'assistant')[],
};

/**
 * Cheap model configuration for background tasks
 */
const cheapModels = {
  defaultModel: 'llama3.2:3b',
  recommendedModels: ['llama3.2:3b', 'llama3.2:1b', 'phi3:mini', 'mistral:7b', 'gemma2:2b'],
};

/**
 * The Ollama Provider Plugin
 * Implements the LLMProviderPlugin interface for Quilltap
 */
export const plugin: LLMProviderPlugin = {
  metadata,

  config,

  capabilities,

  attachmentSupport,

  // Runtime configuration
  messageFormat,
  charsPerToken: 3.5,
  toolFormat: 'openai', // Ollama uses OpenAI-compatible format
  cheapModels,
  defaultContextWindow: 8192, // Conservative default for local models

  /**
   * Factory method to create an Ollama LLM provider instance
   * Requires baseUrl parameter for Ollama server connection
   */
  createProvider: (baseUrl?: string) => {
    const url = baseUrl || config.baseUrlDefault;
    return new OllamaProvider(url);
  },

  /**
   * Ollama does not support image generation
   */
  createImageProvider: (baseUrl?: string) => {
    throw new Error('Ollama does not support image generation');
  },

  /**
   * Factory method to create an Ollama embedding provider instance
   */
  createEmbeddingProvider: (baseUrl?: string) => {
    const url = baseUrl || config.baseUrlDefault;
    return new OllamaEmbeddingProvider(url);
  },

  /**
   * Get list of available models from Ollama server
   * No API key required, uses baseUrl to connect to local/remote Ollama instance
   */
  getAvailableModels: async (apiKey: string, baseUrl?: string) => {
    const url = baseUrl || config.baseUrlDefault;
    try {
      const provider = new OllamaProvider(url);
      const models = await provider.getAvailableModels(apiKey);
      return models;
    } catch (error) {
      logger.error('Failed to fetch Ollama models', { context: 'plugin.getAvailableModels', baseUrl: url }, error instanceof Error ? error : undefined);
      return [];
    }
  },

  /**
   * Validate Ollama server connection
   * Ollama doesn't use API keys, just verifies server is reachable
   */
  validateApiKey: async (apiKey: string, baseUrl?: string) => {
    const url = baseUrl || config.baseUrlDefault;
    try {
      const provider = new OllamaProvider(url);
      const isValid = await provider.validateApiKey(apiKey);
      return isValid;
    } catch (error) {
      logger.error('Error validating Ollama server', { context: 'plugin.validateApiKey', baseUrl: url }, error instanceof Error ? error : undefined);
      return false;
    }
  },

  /**
   * Get static model information
   * Returns cached information about common Ollama models
   */
  getModelInfo: () => {
    return [
      {
        id: 'llama2',
        name: 'Llama 2',
        contextWindow: 4096,
        maxOutputTokens: 2048,
        supportsImages: false,
        supportsTools: false,
      },
      {
        id: 'neural-chat',
        name: 'Neural Chat',
        contextWindow: 4096,
        maxOutputTokens: 2048,
        supportsImages: false,
        supportsTools: false,
      },
      {
        id: 'mistral',
        name: 'Mistral',
        contextWindow: 8192,
        maxOutputTokens: 2048,
        supportsImages: false,
        supportsTools: false,
      },
      {
        id: 'llava',
        name: 'LLaVA (Vision)',
        contextWindow: 4096,
        maxOutputTokens: 2048,
        supportsImages: true,
        supportsTools: false,
      },
      {
        id: 'dolphin-mixtral',
        name: 'Dolphin Mixtral',
        contextWindow: 32768,
        maxOutputTokens: 4096,
        supportsImages: false,
        supportsTools: false,
      },
    ];
  },

  /**
   * Get embedding models supported by Ollama
   * Returns static information about available embedding models
   */
  getEmbeddingModels: (): EmbeddingModelInfo[] => {
    return [
      {
        id: 'nomic-embed-text',
        name: 'Nomic Embed Text',
        dimensions: 768,
        description: 'High-quality open embedding model. Good balance of speed and accuracy.',
      },
      {
        id: 'mxbai-embed-large',
        name: 'MixedBread Embed Large',
        dimensions: 1024,
        description: 'Large embedding model with excellent performance.',
      },
      {
        id: 'all-minilm',
        name: 'All MiniLM',
        dimensions: 384,
        description: 'Fast and lightweight. Good for quick semantic search.',
      },
      {
        id: 'snowflake-arctic-embed',
        name: 'Snowflake Arctic Embed',
        dimensions: 1024,
        description: 'State-of-the-art retrieval embedding model.',
      },
    ];
  },

  /**
   * Render the Ollama icon
   */

  /**
   * Format tools from OpenAI format to OpenAI format
   * Ollama uses OpenAI format, with Grok constraints applied if needed
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
        'Error formatting tools for Ollama',
        { context: 'plugin.formatTools' },
        error instanceof Error ? error : undefined
      );
      return [];
    }
  },

  /**
   * Parse tool calls from Ollama response format
   * Extracts tool calls from Ollama API responses (OpenAI format)
   *
   * @param response Ollama API response object
   * @returns Array of tool call requests
   */
  parseToolCalls: (response: any): ToolCallRequest[] => {
    try {
      const toolCalls = parseOpenAIToolCalls(response);
      return toolCalls;
    } catch (error) {
      logger.error(
        'Error parsing tool calls from Ollama response',
        { context: 'plugin.parseToolCalls' },
        error instanceof Error ? error : undefined
      );
      return [];
    }
  },
};

export default plugin;
