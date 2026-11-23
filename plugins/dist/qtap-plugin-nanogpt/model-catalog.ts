/**
 * NanoGPT live model catalog.
 *
 * GET {base}/models?detailed=true lists chat (text) models with context
 * length, max output tokens and a `capabilities` object. Image, video, audio
 * and embedding models live in their own listings, so none appear here. A
 * field NanoGPT leaves null or absent stays undefined (unknown).
 */

import type { ModelInfo } from '@quilltap/plugin-types';
import { createPluginLogger, getQuilltapUserAgent } from '@quilltap/plugin-utils';
import { NANOGPT_BASE_URL } from './models';

const logger = createPluginLogger('qtap-plugin-nanogpt');

interface NanoGPTTextModelEntry {
  id: string;
  name?: string;
  description?: string;
  context_length?: number | null;
  max_output_tokens?: number | null;
  available?: boolean;
  capabilities?: {
    vision?: boolean;
    reasoning?: boolean;
    tool_calling?: boolean;
  } | null;
}

function positiveNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

function flag(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

export function mapNanoGPTEntry(entry: NanoGPTTextModelEntry): ModelInfo {
  const caps = entry.capabilities ?? undefined;
  return {
    id: entry.id,
    name: entry.name || entry.id,
    description: entry.description || undefined,
    contextWindow: positiveNumber(entry.context_length),
    maxOutputTokens: positiveNumber(entry.max_output_tokens),
    supportsImages: flag(caps?.vision),
    supportsTools: flag(caps?.tool_calling),
    supportsThinking: flag(caps?.reasoning),
  };
}

/**
 * Fetch NanoGPT's detailed text-model catalog. The key is optional for this
 * endpoint (it only adds user-specific pricing), but is sent when present.
 * Throws on a network or HTTP failure.
 */
export async function fetchNanoGPTModelCatalog(apiKey: string): Promise<ModelInfo[]> {
  const headers: Record<string, string> = { 'User-Agent': getQuilltapUserAgent() };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  const response = await fetch(`${NANOGPT_BASE_URL}/models?detailed=true`, { headers });
  if (!response.ok) {
    throw new Error(`NanoGPT model catalog request failed: HTTP ${response.status}`);
  }

  const payload = (await response.json()) as { data?: NanoGPTTextModelEntry[] };
  if (!Array.isArray(payload.data)) {
    throw new Error('NanoGPT model catalog response had no data array');
  }

  const entries = payload.data.filter(
    (entry) => typeof entry?.id === 'string' && entry.available !== false
  );
  logger.debug('Fetched NanoGPT model catalog', {
    context: 'fetchNanoGPTModelCatalog',
    total: payload.data.length,
    available: entries.length,
  });
  return entries.map(mapNanoGPTEntry);
}
