/**
 * Grok Image Generation Provider Implementation for Quilltap Plugin
 *
 * Supports: grok-imagine-image, grok-imagine-image-pro, grok-2-image (legacy)
 * API: POST /v1/images/generations (compatible with OpenAI SDK)
 */

import OpenAI from 'openai';
import type { Images } from 'openai/resources';
import type { ImageProvider as ImageProviderBase, ImageGenParams, ImageGenResponse } from './types';
import { createPluginLogger, getQuilltapUserAgent } from '@quilltap/plugin-utils';

const logger = createPluginLogger('qtap-plugin-grok');

export class GrokImageProvider implements ImageProviderBase {
  readonly provider = 'GROK';
  readonly supportedModels = ['grok-imagine-image', 'grok-imagine-image-pro', 'grok-2-image'];

  private baseUrl = 'https://api.x.ai/v1';

  /**
   * Check if the model is a Grok Imagine model (vs legacy grok-2-image)
   */
  private isImagineModel(model: string): boolean {
    return model.startsWith('grok-imagine-');
  }

  async generateImage(params: ImageGenParams, apiKey: string): Promise<ImageGenResponse> {
    if (!apiKey) {
      throw new Error('Grok provider requires an API key');
    }

    const client = new OpenAI({
      apiKey,
      baseURL: this.baseUrl,
      defaultHeaders: { 'User-Agent': getQuilltapUserAgent() },
    });

    const model = params.model ?? 'grok-imagine-image';

    // Build request params - Grok uses aspect_ratio instead of size
    const requestParams: Images.ImageGenerateParams & { aspect_ratio?: string; resolution?: string } = {
      model,
      prompt: params.prompt,
      n: params.n ?? 1,
      response_format: 'b64_json',
    };

    // Add aspect_ratio if provided (Grok-specific parameter)
    if (params.aspectRatio) {
      requestParams.aspect_ratio = params.aspectRatio;
    }

    // Imagine models support a resolution parameter ('1k' or '2k')
    // Pro defaults to higher quality; we set '2k' for pro if no explicit choice
    if (this.isImagineModel(model) && model.endsWith('-pro')) {
      requestParams.resolution = '2k';
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
        defaultHeaders: { 'User-Agent': getQuilltapUserAgent() },
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
