/**
 * Live model catalog for the Ollama provider.
 *
 * Lists models with /api/tags, then asks /api/show about each for its
 * capabilities and context length. Ollama publishes no maximum output length,
 * so maxOutputTokens is always left undefined; capability flags are set only
 * when the server reports a `capabilities` array (older servers omit it).
 */

import { createPluginLogger, getQuilltapUserAgent } from '@quilltap/plugin-utils';
import type { ModelInfo } from './types';

const logger = createPluginLogger('qtap-plugin-ollama');

const SHOW_CONCURRENCY = 4;

interface OllamaTagsResponse {
  models?: Array<{ name?: string; model?: string }>;
}

interface OllamaShowResponse {
  capabilities?: string[];
  model_info?: Record<string, unknown>;
}

function contextLengthOf(modelInfo: Record<string, unknown> | undefined): number | undefined {
  if (!modelInfo) return undefined;
  const arch = modelInfo['general.architecture'];
  if (typeof arch !== 'string' || !arch) return undefined;
  const value = modelInfo[`${arch}.context_length`];
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

async function showModel(baseUrl: string, name: string): Promise<ModelInfo | null> {
  const response = await fetch(`${baseUrl}/api/show`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': getQuilltapUserAgent() },
    body: JSON.stringify({ model: name }),
  });
  if (!response.ok) {
    throw new Error(`Ollama /api/show failed for ${name}: ${response.status}`);
  }
  const data = (await response.json()) as OllamaShowResponse;
  const caps = Array.isArray(data.capabilities) ? data.capabilities : undefined;

  // Embedding-only models are not chat models
  if (caps && caps.includes('embedding') && !caps.includes('completion')) {
    logger.debug('Skipping embedding-only model', { context: 'getModelCatalog', model: name });
    return null;
  }

  const info: ModelInfo = { id: name, name, contextWindow: contextLengthOf(data.model_info) };
  if (caps) {
    info.supportsTools = caps.includes('tools');
    info.supportsImages = caps.includes('vision');
    info.supportsThinking = caps.includes('thinking');
  }
  return info;
}

/**
 * Fetch the detailed model list from an Ollama server. Throws if the server
 * is unreachable or any lookup fails, rather than returning a partial list.
 */
export async function fetchOllamaModelCatalog(baseUrl: string): Promise<ModelInfo[]> {
  const tagsResponse = await fetch(`${baseUrl}/api/tags`, {
    method: 'GET',
    headers: { 'User-Agent': getQuilltapUserAgent() },
  });
  if (!tagsResponse.ok) {
    logger.error('Ollama model catalog listing failed', { context: 'getModelCatalog', baseUrl, status: tagsResponse.status });
    throw new Error(`Ollama /api/tags failed: ${tagsResponse.status}`);
  }
  const tags = (await tagsResponse.json()) as OllamaTagsResponse;
  const names = (tags.models ?? []).map((m) => m.name ?? m.model).filter((n): n is string => !!n);

  const results: Array<ModelInfo | null> = new Array(names.length).fill(null);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < names.length) {
      const i = next++;
      results[i] = await showModel(baseUrl, names[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(SHOW_CONCURRENCY, names.length) }, worker));

  const catalog = results.filter((m): m is ModelInfo => m !== null);
  logger.debug('Fetched Ollama model catalog', { context: 'getModelCatalog', baseUrl, listed: names.length, count: catalog.length });
  return catalog;
}
