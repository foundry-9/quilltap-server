/**
 * Z.AI Image Generation Provider Implementation for Quilltap Plugin
 *
 * Supports CogView-4 and GLM-Image via POST /paas/v4/images/generations.
 * Z.AI's image endpoint mirrors OpenAI's shape closely enough that the
 * OpenAI SDK works for requests; responses include URLs valid for 30 days.
 */

import OpenAI from 'openai';
import type { Images } from 'openai/resources';
import type { ImageProvider as ImageProviderBase, ImageGenParams, ImageGenResponse } from './types';
import { createPluginLogger, getQuilltapUserAgent } from '@quilltap/plugin-utils';

const logger = createPluginLogger('qtap-plugin-z-ai');

const SUPPORTED_MODELS = ['cogview-4-250304', 'glm-image'];

export class ZAIImageProvider implements ImageProviderBase {
  readonly provider = 'Z_AI';
  readonly supportedModels = SUPPORTED_MODELS;

  private baseUrl = 'https://api.z.ai/api/paas/v4';

  async generateImage(params: ImageGenParams, apiKey: string): Promise<ImageGenResponse> {
    if (!apiKey) {
      throw new Error('Z.AI provider requires an API key');
    }

    const client = new OpenAI({
      apiKey,
      baseURL: this.baseUrl,
      defaultHeaders: { 'User-Agent': getQuilltapUserAgent() },
    });

    const model = params.model ?? 'cogview-4-250304';

    const requestParams: Images.ImageGenerateParams = {
      model,
      prompt: params.prompt,
      n: params.n ?? 1,
    };

    if (params.size) {
      requestParams.size = params.size as Images.ImageGenerateParams['size'];
    } else if (model === 'glm-image') {
      requestParams.size = '1280x1280' as Images.ImageGenerateParams['size'];
    } else {
      requestParams.size = '1024x1024' as Images.ImageGenerateParams['size'];
    }

    if (params.quality) {
      requestParams.quality = params.quality as Images.ImageGenerateParams['quality'];
    }

    const response = await client.images.generate(requestParams);

    if (!('data' in response) || !response.data || !Array.isArray(response.data)) {
      logger.error('Invalid response from Z.AI Images API', {
        context: 'ZAIImageProvider.generateImage',
      });
      throw new Error('Invalid response from Z.AI Images API');
    }

    return {
      images: response.data.map((img: { b64_json?: string; url?: string; revised_prompt?: string }) => ({
        data: img.b64_json,
        url: img.url,
        mimeType: 'image/png',
        revisedPrompt: img.revised_prompt,
      })),
      raw: response,
    };
  }

  async validateApiKey(apiKey: string): Promise<boolean> {
    if (!apiKey) return false;
    // Defer to the text provider's validation to avoid a paid image call.
    // Callers typically validate once via the text provider.
    return true;
  }

  async getAvailableModels(): Promise<string[]> {
    return this.supportedModels;
  }
}
