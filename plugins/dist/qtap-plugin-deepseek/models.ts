/**
 * Static DeepSeek model catalog. Used by the plugin wrapper's
 * `getModelInfo()` and as a fallback list for `getAvailableModels()`
 * when the /models endpoint is unreachable.
 *
 * Both flagship models share a 128K context window. `deepseek-chat`
 * is the general-purpose conversational model (DeepSeek-V3 family);
 * `deepseek-reasoner` is the R1-style reasoning model that returns
 * a separate chain-of-thought channel alongside the final answer.
 */

import type { ModelInfo } from './types';

export const STATIC_MODELS: ModelInfo[] = [
  {
    id: 'deepseek-chat',
    name: 'DeepSeek Chat (V3)',
    contextWindow: 131072,
    maxOutputTokens: 8192,
    supportsImages: false,
    supportsTools: true,
  },
  {
    id: 'deepseek-reasoner',
    name: 'DeepSeek Reasoner (R1)',
    contextWindow: 131072,
    maxOutputTokens: 8192,
    supportsImages: false,
    supportsTools: false,
  },
];

export const STATIC_MODEL_IDS: string[] = STATIC_MODELS.map((m) => m.id);
