/**
 * OpenAI Moderation Provider for Quilltap
 *
 * Uses OpenAI's dedicated moderation endpoint (POST /v1/moderations)
 * to classify content for dangerous/sensitive material. This endpoint
 * is purpose-built for content moderation and is free to use with
 * any OpenAI API key.
 *
 * @see https://platform.openai.com/docs/api-reference/moderations
 */

import {
  createPluginLogger,
  getQuilltapUserAgent,
} from '@quilltap/plugin-utils';

import type {
  ModerationProviderPlugin,
  ModerationResult,
  ModerationCategoryResult,
} from '@quilltap/plugin-types';

const logger = createPluginLogger('qtap-plugin-openai:moderation');

/**
 * OpenAI moderation response shape
 */
interface OpenAIModerationResponse {
  id: string;
  model: string;
  results: Array<{
    flagged: boolean;
    categories: Record<string, boolean>;
    category_scores: Record<string, number>;
  }>;
}

/**
 * OpenAI Moderation Provider Plugin
 *
 * Provides content moderation via the OpenAI moderation endpoint.
 * This is free to use and returns structured category flags with scores.
 */
export const moderationPlugin: ModerationProviderPlugin = {
  metadata: {
    providerName: 'OPENAI',
    displayName: 'OpenAI Moderation',
    description: 'Free content moderation via the OpenAI moderation endpoint',
    abbreviation: 'OAI',
    colors: {
      bg: 'bg-green-100',
      text: 'text-green-800',
      icon: 'text-green-600',
    },
  },

  config: {
    requiresApiKey: true,
    apiKeyLabel: 'OpenAI API Key',
    requiresBaseUrl: false,
  },

  moderate: async (
    content: string,
    apiKey: string,
    baseUrl?: string
  ): Promise<ModerationResult> => {
    const url = baseUrl
      ? `${baseUrl.replace(/\/$/, '')}/v1/moderations`
      : 'https://api.openai.com/v1/moderations';

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'User-Agent': getQuilltapUserAgent(),
      },
      body: JSON.stringify({ input: content }),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      logger.error('OpenAI moderation API error', {
        status: response.status,
        error: errorText,
      });
      throw new Error(`OpenAI moderation API error (${response.status}): ${errorText}`);
    }

    const data = await response.json() as OpenAIModerationResponse;

    if (!data.results || data.results.length === 0) {
      logger.warn('OpenAI moderation returned empty results');
      return { flagged: false, categories: [] };
    }

    const result = data.results[0];
    const categories: ModerationCategoryResult[] = [];

    // Map all OpenAI categories to our generic format
    for (const [category, flagged] of Object.entries(result.categories)) {
      const score = result.category_scores[category] ?? 0;
      categories.push({
        category,
        flagged,
        score,
      });
    }

    return {
      flagged: result.flagged,
      categories,
    };
  },

  validateApiKey: async (apiKey: string, baseUrl?: string): Promise<boolean> => {
    try {
      const url = baseUrl
        ? `${baseUrl.replace(/\/$/, '')}/v1/moderations`
        : 'https://api.openai.com/v1/moderations';

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
          'User-Agent': getQuilltapUserAgent(),
        },
        body: JSON.stringify({ input: 'test' }),
      });

      return response.ok;
    } catch {
      return false;
    }
  },
};
