/**
 * Live model catalog for the Google (Gemini API) provider.
 *
 * Reads the paginated `models.list` endpoint directly (rather than through the
 * SDK) so that the raw `thinking` flag and token limits are available. Fields
 * the API does not state — tool support and image input — are left undefined.
 */

import { createPluginLogger, getQuilltapUserAgent } from '@quilltap/plugin-utils';
import type { ModelInfo } from './types';

const logger = createPluginLogger('qtap-plugin-google');

const MODELS_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';
const PAGE_SIZE = 1000;
/** Guard against a server that never stops returning a nextPageToken. */
const MAX_PAGES = 20;

interface GoogleModelResource {
  name?: string;
  displayName?: string;
  inputTokenLimit?: number;
  outputTokenLimit?: number;
  supportedGenerationMethods?: string[];
  thinking?: boolean;
}

interface GoogleModelsListResponse {
  models?: GoogleModelResource[];
  nextPageToken?: string;
}

function positiveInt(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

/**
 * Fetch every generateContent-capable model with the details Google states.
 * Throws on any HTTP or network failure rather than returning a partial list.
 */
export async function fetchGoogleModelCatalog(apiKey: string): Promise<ModelInfo[]> {
  const catalog: ModelInfo[] = [];
  let pageToken: string | undefined;

  for (let page = 0; page < MAX_PAGES; page++) {
    const params = new URLSearchParams({ pageSize: String(PAGE_SIZE) });
    if (pageToken) params.set('pageToken', pageToken);

    const response = await fetch(`${MODELS_ENDPOINT}?${params.toString()}`, {
      method: 'GET',
      headers: {
        // Key goes in a header so it never lands in a URL or a log line
        'x-goog-api-key': apiKey,
        'User-Agent': getQuilltapUserAgent(),
      },
    });

    if (!response.ok) {
      logger.error('Google model catalog request failed', {
        context: 'getModelCatalog',
        status: response.status,
        page,
      });
      throw new Error(`Google models.list failed: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as GoogleModelsListResponse;

    for (const model of data.models ?? []) {
      if (!model.name || !model.supportedGenerationMethods?.includes('generateContent')) continue;

      // Same id shape as getAvailableModels: "models/gemini-2.5-flash" -> "gemini-2.5-flash"
      const id = model.name.replace(/^models\//, '');
      const info: ModelInfo = {
        id,
        name: model.displayName || id,
        contextWindow: positiveInt(model.inputTokenLimit),
        maxOutputTokens: positiveInt(model.outputTokenLimit),
      };
      if (typeof model.thinking === 'boolean') {
        info.supportsThinking = model.thinking;
      }
      catalog.push(info);
    }

    pageToken = data.nextPageToken || undefined;
    if (!pageToken) break;
  }

  logger.debug('Fetched Google model catalog', { context: 'getModelCatalog', count: catalog.length });
  return catalog;
}
