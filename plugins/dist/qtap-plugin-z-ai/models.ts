/**
 * Static Z.AI model catalog. Shared by both the plugin wrapper (for
 * `getModelInfo()`) and the provider instance (for merging into
 * `getAvailableModels()` so that vision-capable models always appear
 * in the chat picker even when Z.AI's `/models` endpoint omits them).
 */

import type { ModelInfo } from './types';

// Image-generation model IDs are owned by the image provider; keep them out of
// the chat model list merge so they don't leak into the chat picker.
export const IMAGE_GEN_MODEL_PATTERN = /^(cogview|glm-image)/i;

export const STATIC_MODELS: ModelInfo[] = [
  {
    id: 'glm-4.6',
    name: 'GLM-4.6',
    contextWindow: 200000,
    maxOutputTokens: 128000,
    supportsImages: false,
    supportsTools: true,
  },
  {
    id: 'glm-4.5',
    name: 'GLM-4.5',
    contextWindow: 131072,
    maxOutputTokens: 98304,
    supportsImages: false,
    supportsTools: true,
  },
  {
    id: 'glm-4.5-x',
    name: 'GLM-4.5-X',
    contextWindow: 131072,
    maxOutputTokens: 98304,
    supportsImages: false,
    supportsTools: true,
  },
  {
    id: 'glm-4.5-air',
    name: 'GLM-4.5-Air',
    contextWindow: 131072,
    maxOutputTokens: 98304,
    supportsImages: false,
    supportsTools: true,
  },
  {
    id: 'glm-4.5-airx',
    name: 'GLM-4.5-AirX',
    contextWindow: 131072,
    maxOutputTokens: 98304,
    supportsImages: false,
    supportsTools: true,
  },
  {
    id: 'glm-4.5-flash',
    name: 'GLM-4.5-Flash',
    contextWindow: 131072,
    maxOutputTokens: 98304,
    supportsImages: false,
    supportsTools: true,
  },
  {
    id: 'glm-4-32b-0414-128k',
    name: 'GLM-4-32B (128K)',
    contextWindow: 131072,
    maxOutputTokens: 16384,
    supportsImages: false,
    supportsTools: true,
  },
  {
    id: 'glm-4.6v',
    name: 'GLM-4.6V (Vision)',
    contextWindow: 65536,
    maxOutputTokens: 32768,
    supportsImages: true,
    supportsTools: true,
  },
  {
    id: 'glm-4.6v-flashx',
    name: 'GLM-4.6V-FlashX (Vision)',
    contextWindow: 65536,
    maxOutputTokens: 32768,
    supportsImages: true,
    supportsTools: true,
  },
  {
    id: 'glm-4.6v-flash',
    name: 'GLM-4.6V-Flash (Vision)',
    contextWindow: 65536,
    maxOutputTokens: 32768,
    supportsImages: true,
    supportsTools: true,
  },
  {
    id: 'glm-5v-turbo',
    name: 'GLM-5V-Turbo (Vision)',
    contextWindow: 65536,
    maxOutputTokens: 32768,
    supportsImages: true,
    supportsTools: true,
  },
  {
    id: 'glm-4.5v',
    name: 'GLM-4.5V (Vision)',
    contextWindow: 65536,
    maxOutputTokens: 16384,
    supportsImages: true,
    supportsTools: true,
  },
  {
    id: 'cogview-4-250304',
    name: 'CogView-4',
    contextWindow: 4096,
    maxOutputTokens: 1024,
    supportsImages: false,
    supportsTools: false,
  },
  {
    id: 'glm-image',
    name: 'GLM-Image',
    contextWindow: 4096,
    maxOutputTokens: 1024,
    supportsImages: false,
    supportsTools: false,
  },
];

export const STATIC_CHAT_MODEL_IDS: string[] = STATIC_MODELS
  .map((m) => m.id)
  .filter((id) => !IMAGE_GEN_MODEL_PATTERN.test(id));
