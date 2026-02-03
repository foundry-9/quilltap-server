/**
 * Grok Image Generation Provider Implementation for Quilltap Plugin
 *
 * Supports: grok-2-image
 * API: POST /v1/images/generations (compatible with OpenAI SDK)
 */

import OpenAI from 'openai';
import type { Images } from 'openai/resources';
import type { ImageGenProvider as ImageGenProviderBase, ImageGenParams, ImageGenResponse } from './types';
import { createPluginLogger } from '@quilltap/plugin-utils';

const logger = createPluginLogger('qtap-plugin-grok');

export class GrokImageProvider implements ImageGenProviderBase {
  readonly provider = 'GROK';
  readonly supportedModels = ['grok-2-image'];

  private baseUrl = 'https://api.x.ai/v1';

  async generateImage(params: ImageGenParams, apiKey: string): Promise<ImageGenResponse> {
    if (!apiKey) {
      throw new Error('Grok provider requires an API key');
    }

    const client = new OpenAI({
      apiKey,
      baseURL: this.baseUrl,
    });

    // Build request params - Grok uses aspect_ratio instead of size
    const requestParams: Images.ImageGenerateParams & { aspect_ratio?: string } = {
      model: params.model ?? 'grok-2-image',
      prompt: params.prompt,
      n: params.n ?? 1,
      response_format: 'b64_json',
    };

    // Add aspect_ratio if provided (Grok-specific parameter)
    if (params.aspectRatio) {
      requestParams.aspect_ratio = params.aspectRatio;
    }

    const response = await client.images.generate(requestParams);

    if (!('data' in response) || !response.data || !Array.isArray(response.data)) {
      logger.error('Invalid response from Grok Images API', { context: 'GrokImageProvider.generateImage' });
      throw new Error('Invalid response from Grok Images API');
    }
    return {
      images: response.data.map((img: { b64_json?: string; url?: string; revised_prompt?: string }) => ({
        data: img.b64_json || img.url || '',
        mimeType: 'image/jpeg',
        revisedPrompt: img.revised_prompt,
      })),
      raw: response,
    };
  }

  async validateApiKey(apiKey: string): Promise<boolean> {
    try {
      const client = new OpenAI({
        apiKey,
        baseURL: this.baseUrl,
      });
      await client.models.list();
      return true;
    } catch (error) {
      logger.error('Grok API key validation failed for image generation', { context: 'GrokImageProvider.validateApiKey' }, error instanceof Error ? error : undefined);
      return false;
    }
  }

  async getAvailableModels(): Promise<string[]> {
    return this.supportedModels;
  }
}
