/**
 * OpenRouter live model catalog.
 *
 * GET https://openrouter.ai/api/v1/models returns every model with the
 * context window, output cap, input modalities and supported request
 * parameters *as OpenRouter serves it*. A field the response does not state
 * is left undefined (unknown) — never defaulted.
 */

import type { ModelInfo } from '@quilltap/plugin-types';
import { createPluginLogger, getQuilltapUserAgent } from '@quilltap/plugin-utils';

const logger = createPluginLogger('qtap-plugin-openrouter');

const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models';

interface OpenRouterCatalogEntry {
  id: string;
  name?: string;
  description?: string;
  context_length?: number | null;
  architecture?: {
    modality?: string | null;
    input_modalities?: string[] | null;
    output_modalities?: string[] | null;
  } | null;
  top_provider?: {
    context_length?: number | null;
    max_completion_tokens?: number | null;
  } | null;
  supported_parameters?: string[] | null;
}

function positiveNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

function supportsImageInput(entry: OpenRouterCatalogEntry): boolean | undefined {
  const inputs = entry.architecture?.input_modalities;
  if (Array.isArray(inputs) && inputs.length > 0) return inputs.includes('image');
  // Legacy "text+image->text" style string: input side is before "->".
  const modality = entry.architecture?.modality;
  if (typeof modality === 'string' && modality.includes('->')) {
    return modality.split('->')[0].includes('image');
  }
  return undefined;
}

/** True when the model emits text (chat models), false when it does not, undefined if unstated. */
function emitsText(entry: OpenRouterCatalogEntry): boolean | undefined {
  const outputs = entry.architecture?.output_modalities;
  if (Array.isArray(outputs) && outputs.length > 0) return outputs.includes('text');
  return undefined;
}

export function mapOpenRouterEntry(entry: OpenRouterCatalogEntry): ModelInfo {
  const params = Array.isArray(entry.supported_parameters) ? entry.supported_parameters : undefined;
  return {
    id: entry.id,
    name: entry.name || entry.id,
    description: entry.description || undefined,
    contextWindow: positiveNumber(entry.context_length) ?? positiveNumber(entry.top_provider?.context_length),
    maxOutputTokens: positiveNumber(entry.top_provider?.max_completion_tokens),
    supportsImages: supportsImageInput(entry),
    supportsTools: params ? params.includes('tools') : undefined,
    supportsThinking: params
      ? params.includes('reasoning') || params.includes('include_reasoning')
      : undefined,
  };
}

/**
 * Fetch OpenRouter's detailed catalog of text/chat models.
 * Throws on a network or HTTP failure.
 */
export async function fetchOpenRouterModelCatalog(apiKey: string): Promise<ModelInfo[]> {
  const headers: Record<string, string> = {
    'User-Agent': getQuilltapUserAgent(),
    'X-Title': getQuilltapUserAgent(),
    'HTTP-Referer': process.env.BASE_URL || 'http://localhost:3000',
  };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  const response = await fetch(OPENROUTER_MODELS_URL, { headers });
  if (!response.ok) {
    throw new Error(`OpenRouter model catalog request failed: HTTP ${response.status}`);
  }

  const payload = (await response.json()) as { data?: OpenRouterCatalogEntry[] };
  if (!Array.isArray(payload.data)) {
    throw new Error('OpenRouter model catalog response had no data array');
  }

  const entries = payload.data.filter(
    (entry) => typeof entry?.id === 'string' && emitsText(entry) !== false
  );
  logger.debug('Fetched OpenRouter model catalog', {
    context: 'fetchOpenRouterModelCatalog',
    total: payload.data.length,
    textModels: entries.length,
  });
  return entries.map(mapOpenRouterEntry);
}
