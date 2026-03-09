/**
 * Google Gemini Provider Plugin for Quilltap
 * Main entry point that exports the plugin configuration
 *
 * This plugin provides:
 * - Chat completion using Gemini, Gemini 2.0, and other Google models
 * - Vision capabilities (image analysis)
 * - Image generation using Imagen models and Gemini image generation
 * - Function calling / tool use
 * - Web search integration via Google Search
 */

import type { LLMProviderPlugin, ImageGenerationModelInfo } from './types';
import { GoogleProvider } from './provider';
import { GoogleImagenProvider } from './image-provider';
import {
  createPluginLogger,
  convertToGoogleFormat,
  parseGoogleToolCalls,
  type OpenAIToolDefinition,
  type GoogleToolDefinition,
  type ToolCallRequest,
} from '@quilltap/plugin-utils';
import { hasToolUseMarkers, parseToolUseFormat, stripToolUseMarkers, convertTextToolToRequest } from '@quilltap/plugin-utils/tools';

const logger = createPluginLogger('qtap-plugin-google');

/**
 * Plugin metadata configuration
 */
const metadata = {
  providerName: 'GOOGLE',
  displayName: 'Google Gemini',
  description: 'Google Gemini models including text and image generation via Generative AI API',
  colors: {
    bg: 'bg-blue-100',
    text: 'text-blue-800',
    icon: 'text-blue-600',
  },
  abbreviation: 'GGL',
  // Legacy provider names that map to this provider for backward compatibility
  legacyNames: ['GOOGLE_IMAGEN'] as string[],
} as const;

/**
 * Configuration requirements
 */
const config = {
  requiresApiKey: true,
  requiresBaseUrl: false,
  apiKeyLabel: 'Google Generative AI API Key',
} as const;

/**
 * Supported capabilities
 */
const capabilities = {
  chat: true,
  imageGeneration: true,
  embeddings: false,
  webSearch: true,
  toolUse: false,
} as const;

/**
 * File attachment support
 */
const attachmentSupport = {
  supportsAttachments: true as const,
  supportedMimeTypes: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'] as string[],
  description: 'Images only (JPEG, PNG, GIF, WebP)',
  notes: 'Images are supported in Gemini models for vision analysis',
  maxBase64Size: 20 * 1024 * 1024, // 20MB - Google's API limit for images
};

/**
 * Message format support for multi-character chats
 * Google does NOT support the name field in messages
 */
const messageFormat = {
  supportsNameField: false,
  supportedRoles: [] as ('user' | 'assistant')[],
};

/**
 * Cheap model configuration for background tasks
 */
const cheapModels = {
  defaultModel: 'gemini-2.5-flash',
  recommendedModels: ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-3-flash-preview'],
};

/**
 * The Google Provider Plugin
 * Implements the LLMProviderPlugin interface for Quilltap
 */
export const plugin: LLMProviderPlugin = {
  metadata,

  icon: {
    viewBox: '0 0 24 24',
    paths: [
      { d: 'M12 2c0 5.523-4.477 10-10 10 5.523 0 10 4.477 10 10 0-5.523 4.477-10 10-10-5.523 0-10-4.477-10-10z', fill: 'currentColor' },
    ],
  },

  config,

  capabilities,

  attachmentSupport,

  // Runtime configuration
  messageFormat,
  charsPerToken: 3.8, // Google uses SentencePiece tokenizer, slightly more efficient
  toolFormat: 'google',
  cheapModels,
  defaultContextWindow: 1000000,

  /**
   * Factory method to create a Google LLM provider instance
   */
  createProvider: (baseUrl?: string) => {
    return new GoogleProvider();
  },

  /**
   * Factory method to create a Google Imagen image generation provider instance
   */
  createImageProvider: (baseUrl?: string) => {
    return new GoogleImagenProvider();
  },

  /**
   * Get list of available models from Google API
   * Requires a valid API key
   */
  getAvailableModels: async (apiKey: string, baseUrl?: string) => {
    try {
      const provider = new GoogleProvider();
      const models = await provider.getAvailableModels(apiKey);
      return models;
    } catch (error) {
      logger.error('Failed to fetch Google models', { context: 'plugin.getAvailableModels' }, error instanceof Error ? error : undefined);
      return [];
    }
  },

  /**
   * Validate a Google API key
   */
  validateApiKey: async (apiKey: string, baseUrl?: string) => {
    try {
      const provider = new GoogleProvider();
      const isValid = await provider.validateApiKey(apiKey);
      return isValid;
    } catch (error) {
      logger.error('Error validating Google API key', { context: 'plugin.validateApiKey' }, error instanceof Error ? error : undefined);
      return false;
    }
  },

  /**
   * Get static model information
   * Returns cached information about Google models without needing API calls
   * Note: Use getAvailableModels() for dynamic listing from API
   */
  getModelInfo: () => {
    return [
      // Gemini 3 models (latest thinking/reasoning models)
      {
        id: 'gemini-3-flash-preview',
        name: 'Gemini 3 Flash (Preview)',
        contextWindow: 1000000,
        maxOutputTokens: 8192,
        supportsImages: true,
        supportsTools: true,
      },
      {
        id: 'gemini-3-pro-preview',
        name: 'Gemini 3 Pro (Preview)',
        contextWindow: 1000000,
        maxOutputTokens: 8192,
        supportsImages: true,
        supportsTools: true,
      },
      // Gemini 2.5 models
      {
        id: 'gemini-2.5-flash',
        name: 'Gemini 2.5 Flash',
        contextWindow: 1000000,
        maxOutputTokens: 8192,
        supportsImages: true,
        supportsTools: true,
      },
      {
        id: 'gemini-2.5-flash-lite',
        name: 'Gemini 2.5 Flash Lite',
        contextWindow: 1000000,
        maxOutputTokens: 8192,
        supportsImages: true,
        supportsTools: true,
      },
      {
        id: 'gemini-2.5-pro',
        name: 'Gemini 2.5 Pro',
        contextWindow: 1000000,
        maxOutputTokens: 8192,
        supportsImages: true,
        supportsTools: true,
      },
      // Image generation models
      {
        id: 'gemini-2.5-flash-image',
        name: 'Gemini 2.5 Flash Image',
        contextWindow: 1000000,
        maxOutputTokens: 8192,
        supportsImages: true,
        supportsTools: false,
      },
      {
        id: 'gemini-3-pro-image-preview',
        name: 'Gemini 3 Pro Image (Preview)',
        contextWindow: 65536,
        maxOutputTokens: 32768,
        supportsImages: true,
        supportsTools: false,
      },
      // Imagen models (use predict API)
      {
        id: 'imagen-4',
        name: 'Imagen 4',
        contextWindow: 0,
        maxOutputTokens: 0,
        supportsImages: false,
        supportsTools: false,
      },
      {
        id: 'imagen-4-fast',
        name: 'Imagen 4 Fast',
        contextWindow: 0,
        maxOutputTokens: 0,
        supportsImages: false,
        supportsTools: false,
      },
    ];
  },

  /**
   * Get static image generation model information
   * Returns cached information about Google image generation models
   */
  getImageGenerationModels: (): ImageGenerationModelInfo[] => {
    return [
      // Gemini image generation models (use generateContent API)
      {
        id: 'gemini-2.5-flash-image',
        name: 'Gemini 2.5 Flash Image',
        supportedAspectRatios: [
          '1:1',
          '2:3',
          '3:2',
          '3:4',
          '4:3',
          '4:5',
          '5:4',
          '9:16',
          '16:9',
          '21:9',
        ],
        description:
          'Fast, efficient model for general image generation with text rendering',
      },
      {
        id: 'gemini-3-pro-image-preview',
        name: 'Gemini 3 Pro Image (Preview)',
        supportedAspectRatios: [
          '1:1',
          '2:3',
          '3:2',
          '3:4',
          '4:3',
          '4:5',
          '5:4',
          '9:16',
          '16:9',
          '21:9',
        ],
        description:
          'Advanced image generation with reasoning, fine-grained creative controls, 2K/4K output, up to 14 reference images',
      },
      // Imagen models (use predict API via GoogleImagenProvider)
      {
        id: 'imagen-4',
        name: 'Imagen 4',
        supportedAspectRatios: ['1:1', '3:4', '4:3', '9:16', '16:9'],
        description: 'High-quality image generation with Imagen 4',
      },
      {
        id: 'imagen-4-fast',
        name: 'Imagen 4 Fast',
        supportedAspectRatios: ['1:1', '3:4', '4:3', '9:16', '16:9'],
        description: 'Faster image generation variant of Imagen 4',
      },
    ];
  },

  /**
   * Render the Google icon
   */

  /**
   * Format tools from OpenAI format to Google format
   * Converts tool definitions to Google's function calling format
   *
   * @param tools Array of tools in OpenAI format
   * @returns Array of tools in Google format
   */
  formatTools: (
    tools: (OpenAIToolDefinition | Record<string, unknown>)[],
  ): GoogleToolDefinition[] => {
    try {
      const formattedTools: GoogleToolDefinition[] = [];

      for (const tool of tools) {
        // Validate tool has function property (OpenAI format)
        if (!('function' in tool)) {
          logger.warn('Skipping tool with invalid format', {
            context: 'plugin.formatTools',
          });
          continue;
        }

        const openaiTool = tool as OpenAIToolDefinition;

        // Convert from OpenAI format to Google format
        const googleTool = convertToGoogleFormat(openaiTool);
        formattedTools.push(googleTool);
      }
      return formattedTools;
    } catch (error) {
      logger.error(
        'Error formatting tools for Google',
        { context: 'plugin.formatTools' },
        error instanceof Error ? error : undefined
      );
      return [];
    }
  },

  /**
   * Parse tool calls from Google response format
   * Extracts tool calls from Google Gemini API responses
   *
   * @param response Google API response object
   * @returns Array of tool call requests
   */
  parseToolCalls: (response: any): ToolCallRequest[] => {
    try {
      const toolCalls = parseGoogleToolCalls(response);
      return toolCalls;
    } catch (error) {
      logger.error(
        'Error parsing tool calls from Google response',
        { context: 'plugin.parseToolCalls' },
        error instanceof Error ? error : undefined
      );
      return [];
    }
  },

  /**
   * Detect spontaneous tool_use XML markers in Gemini text responses
   */
  hasTextToolMarkers(text: string): boolean {
    return hasToolUseMarkers(text);
  },

  /**
   * Parse spontaneous tool_use XML from Gemini text responses
   */
  parseTextToolCalls(text: string): ToolCallRequest[] {
    try {
      const parsed = parseToolUseFormat(text);
      if (parsed.length > 0) {
        logger.debug('Detected spontaneous tool_use XML in Gemini response', {
          context: 'google.parseTextToolCalls',
          count: parsed.length,
          tools: parsed.map(p => p.toolName),
        });
      }
      return parsed.map(convertTextToolToRequest);
    } catch (error) {
      logger.error(
        'Error parsing text tool calls',
        { context: 'google.parseTextToolCalls' },
        error instanceof Error ? error : undefined
      );
      return [];
    }
  },

  /**
   * Strip spontaneous tool_use XML markers from Gemini text responses
   */
  stripTextToolMarkers(text: string): string {
    return stripToolUseMarkers(text)
      .replace(/\n{3,}/g, '\n\n')
      .replace(/  +/g, ' ')
      .trim();
  },
};

export default plugin;
