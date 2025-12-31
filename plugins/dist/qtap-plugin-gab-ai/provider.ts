/**
 * Gab AI Provider Implementation for Quilltap Plugin
 *
 * Gab AI is OpenAI-compatible and provides language models via api.gab.com/v1
 * This provider extends OpenAICompatibleProvider from @quilltap/plugin-utils
 * with static configuration specific to the Gab AI service.
 *
 * Note: Gab AI does not currently support file attachments or image generation.
 */

import { OpenAICompatibleProvider } from '@quilltap/plugin-utils';

/**
 * Gab AI Provider - extends OpenAICompatibleProvider with Gab-specific configuration
 *
 * Configuration:
 * - baseUrl: https://gab.ai/v1 (fixed)
 * - API key: required
 * - Attachments: not supported
 * - Image generation: not supported
 */
export class GabAIProvider extends OpenAICompatibleProvider {
  constructor() {
    super({
      baseUrl: 'https://gab.ai/v1',
      providerName: 'GabAI',
      requireApiKey: true,
      attachmentErrorMessage: 'Gab AI does not support file attachments',
    });
  }
}
