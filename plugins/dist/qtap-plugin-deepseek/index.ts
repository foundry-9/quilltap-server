/**
 * DeepSeek Provider Plugin for Quilltap
 * Main entry point that exports the plugin configuration
 *
 * This plugin provides:
 * - Chat completion using DeepSeek's OpenAI-compatible Chat Completions API
 * - Function / tool calling on `deepseek-chat`
 * - JSON mode and JSON-schema response formats
 * - The `deepseek-reasoner` chain-of-thought model (R1 family)
 *
 * Built on the OpenAICompatibleProvider base class shipped in
 * @quilltap/plugin-utils. The DeepSeek provider extends it to add
 * tool forwarding, response_format, and prompt-cache usage reporting.
 */

import type { TextProviderPlugin } from './types';
import { DeepSeekProvider } from './provider';
import { STATIC_MODELS, STATIC_MODEL_IDS } from './models';
import {
  createPluginLogger,
  parseOpenAIToolCalls,
  type OpenAIToolDefinition,
  type ToolCallRequest,
} from '@quilltap/plugin-utils';
import {
  hasAnyXMLToolMarkers,
  parseAllXMLAsToolCalls,
  stripAllXMLToolMarkers,
} from '@quilltap/plugin-utils/tools';

const logger = createPluginLogger('qtap-plugin-deepseek');

const metadata = {
  providerName: 'DEEPSEEK',
  displayName: 'DeepSeek',
  description: 'DeepSeek-V3 chat and DeepSeek-R1 reasoning models',
  colors: {
    bg: 'bg-sky-100',
    text: 'text-sky-800',
    icon: 'text-sky-600',
  },
  abbreviation: 'DSK',
} as const;

const config = {
  requiresApiKey: true,
  requiresBaseUrl: false,
  apiKeyLabel: 'DeepSeek API Key',
} as const;

const capabilities = {
  chat: true,
  imageGeneration: false,
  embeddings: false,
  webSearch: false,
  toolUse: true,
} as const;

const attachmentSupport = {
  supportsAttachments: false as const,
  supportedMimeTypes: [] as string[],
  description: 'DeepSeek models do not accept file attachments',
};

const messageFormat = {
  supportsNameField: true,
  supportedRoles: ['user', 'assistant'] as ('user' | 'assistant')[],
  maxNameLength: 64,
};

const cheapModels = {
  defaultModel: 'deepseek-chat',
  recommendedModels: ['deepseek-chat'],
};

export const plugin: TextProviderPlugin = {
  metadata,

  icon: {
    viewBox: '0 0 24 24',
    paths: [
      // Stylized whale silhouette, nodding at DeepSeek's mascot
      {
        d: 'M3 13c0-3.5 3-6 7-6 2 0 3.5.6 5 1.6 1-.6 2.2-1 3-.6.6.3.9.9.9 1.5 0 .5-.2 1-.6 1.5 1.1 1 1.7 2.3 1.7 3.5 0 3-2.7 5.5-6 5.5H8c-2.8 0-5-2-5-4.5zm13-3.2a1 1 0 100 2 1 1 0 000-2z',
        fill: 'currentColor',
      },
    ],
  },

  config,

  capabilities,

  attachmentSupport,

  messageFormat,
  charsPerToken: 3.5,
  toolFormat: 'openai',
  cheapModels,
  defaultContextWindow: 131072,

  createProvider: (_baseUrl?: string) => {
    return new DeepSeekProvider();
  },

  getAvailableModels: async (apiKey: string, _baseUrl?: string) => {
    try {
      const provider = new DeepSeekProvider();
      const dynamic = await provider.getAvailableModels(apiKey);
      // Merge dynamic /models output with our static catalog so the
      // chat picker keeps working if DeepSeek omits a flagship name.
      const merged = new Set<string>(dynamic);
      for (const id of STATIC_MODEL_IDS) merged.add(id);
      return Array.from(merged).sort();
    } catch (error) {
      logger.error(
        'Failed to fetch DeepSeek models',
        { context: 'plugin.getAvailableModels' },
        error instanceof Error ? error : undefined
      );
      return [...STATIC_MODEL_IDS].sort();
    }
  },

  validateApiKey: async (apiKey: string, _baseUrl?: string) => {
    try {
      const provider = new DeepSeekProvider();
      return await provider.validateApiKey(apiKey);
    } catch (error) {
      logger.error(
        'Error validating DeepSeek API key',
        { context: 'plugin.validateApiKey' },
        error instanceof Error ? error : undefined
      );
      return false;
    }
  },

  getModelInfo: () => STATIC_MODELS,

  /**
   * DeepSeek's API is OpenAI-compatible, so tools are passed through verbatim.
   */
  formatTools: (
    tools: (OpenAIToolDefinition | Record<string, unknown>)[]
  ): OpenAIToolDefinition[] => {
    try {
      const formatted: OpenAIToolDefinition[] = [];
      for (const tool of tools) {
        if (!('function' in tool)) {
          logger.warn('Skipping tool with invalid format', { context: 'plugin.formatTools' });
          continue;
        }
        formatted.push(tool as OpenAIToolDefinition);
      }
      return formatted;
    } catch (error) {
      logger.error(
        'Error formatting tools for DeepSeek',
        { context: 'plugin.formatTools' },
        error instanceof Error ? error : undefined
      );
      return [];
    }
  },

  parseToolCalls: (response: unknown): ToolCallRequest[] => {
    try {
      return parseOpenAIToolCalls(response);
    } catch (error) {
      logger.error(
        'Error parsing tool calls from DeepSeek response',
        { context: 'plugin.parseToolCalls' },
        error instanceof Error ? error : undefined
      );
      return [];
    }
  },

  hasTextToolMarkers(text: string): boolean {
    return hasAnyXMLToolMarkers(text);
  },

  parseTextToolCalls(text: string): ToolCallRequest[] {
    try {
      return parseAllXMLAsToolCalls(text);
    } catch (error) {
      logger.error(
        'Error parsing text tool calls',
        { context: 'deepseek.parseTextToolCalls' },
        error instanceof Error ? error : undefined
      );
      return [];
    }
  },

  stripTextToolMarkers(text: string): string {
    return stripAllXMLToolMarkers(text);
  },
};

export default plugin;
