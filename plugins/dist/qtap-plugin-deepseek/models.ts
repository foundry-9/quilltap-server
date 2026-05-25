/**
 * Static DeepSeek model catalog. Used by the plugin wrapper's
 * `getModelInfo()` and as a fallback list for `getAvailableModels()`
 * when the /models endpoint is unreachable.
 *
 * Both flagship models share a 1M-token context window and a 384K
 * max output. `deepseek-v4-flash` is the faster, cheaper tier;
 * `deepseek-v4-pro` is the higher-quality tier and supports DeepSeek's
 * thinking mode (forward `thinking` / `reasoning_effort` via profile
 * parameters to enable it).
 */

import type { ModelInfo } from './types';

export const STATIC_MODELS: ModelInfo[] = [
  {
    id: 'deepseek-v4-flash',
    name: 'DeepSeek V4 Flash',
    contextWindow: 1048576,
    maxOutputTokens: 393216,
    supportsImages: false,
    supportsTools: true,
  },
  {
    id: 'deepseek-v4-pro',
    name: 'DeepSeek V4 Pro',
    contextWindow: 1048576,
    maxOutputTokens: 393216,
    supportsImages: false,
    supportsTools: true,
  },
];

export const STATIC_MODEL_IDS: string[] = STATIC_MODELS.map((m) => m.id);
