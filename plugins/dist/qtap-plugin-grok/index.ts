/**
 * Grok Provider Plugin for Quilltap
 * Main entry point that exports the plugin configuration
 *
 * This plugin provides:
 * - Chat completion using Grok-2 and other Grok models
 * - Image generation using grok-imagine-image
 * - Vision capabilities (image analysis)
 * - Function calling / tool use
 * - Web search integration (Live Search API)
 */

import type { LLMProviderPlugin, ImageProviderConstraints } from './types';
import { GrokProvider } from './provider';
import { GrokImageProvider } from './image-provider';
import {
  createPluginLogger,
  parseOpenAIToolCalls,
  type OpenAIToolDefinition,
  type ToolCallRequest,
} from '@quilltap/plugin-utils';

const logger = createPluginLogger('qtap-plugin-grok');

/**
 * Grok image generation constraints
 * Grok has a strict 1024-byte limit for image generation prompts
 * Grok uses aspect ratios instead of fixed sizes
 */
const GROK_IMAGE_CONSTRAINTS: ImageProviderConstraints = {
  maxPromptBytes: 1024,
  promptConstraintWarning: 'IMPORTANT: Grok has a strict limit of 1024 bytes for image generation prompts. Keep your prompt concise and under this limit.',
  supportedAspectRatios: ['1:1', '4:3', '3:4', '16:9', '9:16'],
};

/**
 * Plugin metadata configuration
 */
const metadata = {
  providerName: 'GROK',
  displayName: 'Grok (xAI)',
  description: 'Grok models by xAI with chat, vision, and image generation capabilities',
  colors: {
    bg: 'bg-purple-100',
    text: 'text-purple-800',
    icon: 'text-purple-600',
  },
  abbreviation: 'XAI',
} as const;

/**
 * Configuration requirements
 */
const config = {
  requiresApiKey: true,
  requiresBaseUrl: false,
  apiKeyLabel: 'Grok API Key',
} as const;

/**
 * Supported capabilities
 */
const capabilities = {
  chat: true,
  imageGeneration: true,
  embeddings: false,
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
  notes: 'Images are supported in Grok models for vision capabilities',
  maxBase64Size: 20 * 1024 * 1024, // 20MB - Grok's API limit for images (OpenAI-compatible)
};

/**
 * Message format support for multi-character chats
 * Grok uses OpenAI-compatible format, supports name field
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
  defaultModel: 'grok-3-mini',
  recommendedModels: ['grok-3-mini', 'grok-4-1-fast'],
};

/**
 * The Grok Provider Plugin
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
  toolFormat: 'openai', // Grok uses OpenAI-compatible format
  cheapModels,
  defaultContextWindow: 131072,

  /**
   * Factory method to create a Grok LLM provider instance
   */
  createProvider: (baseUrl?: string) => {
    return new GrokProvider();
  },

  /**
   * Factory method to create a Grok image generation provider instance
   */
  createImageProvider: (baseUrl?: string) => {
    return new GrokImageProvider();
  },

  /**
   * Get list of available models from Grok API
   * Requires a valid API key
   */
  getAvailableModels: async (apiKey: string, baseUrl?: string) => {
    try {
      const provider = new GrokProvider();
      const models = await provider.getAvailableModels(apiKey);
      return models;
    } catch (error) {
      logger.error('Failed to fetch Grok models', { context: 'plugin.getAvailableModels' }, error instanceof Error ? error : undefined);
      return [];
    }
  },

  /**
   * Validate a Grok API key
   */
  validateApiKey: async (apiKey: string, baseUrl?: string) => {
    try {
      const provider = new GrokProvider();
      const isValid = await provider.validateApiKey(apiKey);
      return isValid;
    } catch (error) {
      logger.error('Error validating Grok API key', { context: 'plugin.validateApiKey' }, error instanceof Error ? error : undefined);
      return false;
    }
  },

  /**
   * Get static model information
   * Returns cached information about Grok models without needing API calls
   */
  getModelInfo: () => {
    return [
      {
        id: 'grok-4',
        name: 'Grok 4',
        contextWindow: 131072,
        maxOutputTokens: 16384,
        supportsImages: true,
        supportsTools: true,
      },
      {
        id: 'grok-4-1-fast',
        name: 'Grok 4.1 Fast',
        contextWindow: 2097152,
        maxOutputTokens: 16384,
        supportsImages: true,
        supportsTools: true,
      },
      {
        id: 'grok-3',
        name: 'Grok 3',
        contextWindow: 131072,
        maxOutputTokens: 16384,
        supportsImages: true,
        supportsTools: true,
      },
      {
        id: 'grok-3-mini',
        name: 'Grok 3 Mini',
        contextWindow: 131072,
        maxOutputTokens: 16384,
        supportsImages: true,
        supportsTools: true,
      },
      {
        id: 'grok-2-1212',
        name: 'Grok 2 (1212)',
        contextWindow: 131072,
        maxOutputTokens: 4096,
        supportsImages: true,
        supportsTools: true,
      },
      {
        id: 'grok-code-fast-1',
        name: 'Grok Code Fast',
        contextWindow: 262144,
        maxOutputTokens: 16384,
        supportsImages: false,
        supportsTools: true,
      },
      {
        id: 'grok-2-image',
        name: 'Grok 2 Image',
        contextWindow: 2048,
        maxOutputTokens: 1024,
        supportsImages: false,
        supportsTools: false,
      },
    ];
  },

  /**
   * Render the Grok icon
   */

  /**
   * Format tools from OpenAI format to OpenAI format
   * Grok uses OpenAI format, tools pass through as-is
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
        'Error formatting tools for Grok',
        { context: 'plugin.formatTools' },
        error instanceof Error ? error : undefined
      );
      return [];
    }
  },

  /**
   * Parse tool calls from Grok response format
   * Extracts tool calls from Grok API responses (OpenAI format)
   *
   * @param response Grok API response object
   * @returns Array of tool call requests
   */
  parseToolCalls: (response: any): ToolCallRequest[] => {
    try {
      const toolCalls = parseOpenAIToolCalls(response);
      return toolCalls;
    } catch (error) {
      logger.error(
        'Error parsing tool calls from Grok response',
        { context: 'plugin.parseToolCalls' },
        error instanceof Error ? error : undefined
      );
      return [];
    }
  },

  /**
   * Get image provider constraints for Grok
   * Grok has specific limitations for image generation prompts
   *
   * @returns Image provider constraints including prompt byte limit
   */
  getImageProviderConstraints: (): ImageProviderConstraints => {
    return GROK_IMAGE_CONSTRAINTS;
  },
};

export default plugin;
