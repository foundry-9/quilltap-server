/**
 * OpenAI Image Generation Provider Implementation for Quilltap Plugin
 *
 * Supports GPT-Image models (1.5, 1, 1-mini) and legacy DALL-E models
 * Note: DALL-E 2 and DALL-E 3 are deprecated and will stop being supported on 05/12/2026
 * Handles model-specific parameter validation and normalization
 */

import OpenAI from 'openai';
import type { ImageProvider, ImageGenParams, ImageGenResponse } from './types';
import { createPluginLogger, getQuilltapUserAgent } from '@quilltap/plugin-utils';

const logger = createPluginLogger('qtap-plugin-openai');

export class OpenAIImageProvider implements ImageProvider {
  readonly provider = 'OPENAI';
  readonly supportedModels = ['gpt-image-1.5', 'gpt-image-1', 'gpt-image-1-mini', 'dall-e-3', 'dall-e-2'];

  /**
   * Check if a model is a GPT-Image model (1.5, 1, or 1-mini)
   */
  private isGptImageModel(model: string): boolean {
    return model.startsWith('gpt-image-');
  }

  /**
   * Validate and normalize size for OpenAI API
   * gpt-image models: 1024x1024, 1024x1536, 1536x1024, auto
   * dall-e-3: 1024x1024, 1024x1792, 1792x1024
   * dall-e-2: 256x256, 512x512, 1024x1024
   */
  private validateAndNormalizeSize(size: string | undefined, model: string): string {
    if (!size) {
      return '1024x1024';
    }

    if (this.isGptImageModel(model)) {
      // gpt-image models support: 1024x1024, 1024x1536, 1536x1024, auto
      const gptImageSizes = ['1024x1024', '1024x1536', '1536x1024', 'auto'];
      if (gptImageSizes.includes(size)) {
        return size;
      }
      // Map unsupported sizes to nearest valid size
      return '1024x1024';
    }

    if (model === 'dall-e-3') {
      // dall-e-3 supports: 1024x1024, 1024x1792, 1792x1024
      const dalleThreeSizes = ['1024x1024', '1024x1792', '1792x1024'];
      if (dalleThreeSizes.includes(size)) {
        return size;
      }
      // Map unsupported sizes to nearest valid size
      return '1024x1024';
    }

    // dall-e-2 supports: 256x256, 512x512, 1024x1024
    const dalleTwoSizes = ['256x256', '512x512', '1024x1024'];
    if (dalleTwoSizes.includes(size)) {
      return size;
    }
    return '1024x1024';
  }

  async generateImage(params: ImageGenParams, apiKey: string): Promise<ImageGenResponse> {
    const client = new OpenAI({
      apiKey,
      defaultHeaders: { 'User-Agent': getQuilltapUserAgent() },
    });

    // gpt-image models have different parameter support than DALL-E models
    const isGptImage = this.isGptImageModel(params.model ?? '');

    const requestParams: any = {
      model: params.model,
      prompt: params.prompt,
      n: params.n ?? 1,
    };

    // gpt-image-1 returns URL by default, DALL-E models can use b64_json
    if (!isGptImage) {
      requestParams.response_format = 'b64_json';
    }

    // Size handling with validation
    const modelName = params.model ?? 'dall-e-3';
    requestParams.size = this.validateAndNormalizeSize(params.size, modelName);

    // quality and style are DALL-E 3 specific parameters
    if (!isGptImage) {
      requestParams.quality = params.quality ?? 'standard';
      requestParams.style = params.style ?? 'vivid';
    }

    const response = await client.images.generate(requestParams);

    if (!response.data || !Array.isArray(response.data)) {
      logger.error('Invalid response from OpenAI Images API', { context: 'OpenAIImageProvider.generateImage' });
      throw new Error('Invalid response from OpenAI Images API');
    }
    return {
      images: response.data.map((img) => ({
        // gpt-image-1 returns urls, DALL-E models return b64_json
        data: img.b64_json || img.url || '',
        mimeType: 'image/png',
        revisedPrompt: img.revised_prompt,
      })),
      raw: response,
    };
  }

  async validateApiKey(apiKey: string): Promise<boolean> {
    try {
      const client = new OpenAI({
        apiKey,
        defaultHeaders: { 'User-Agent': getQuilltapUserAgent() },
      });
      await client.models.list();
      return true;
    } catch (error) {
      logger.error('OpenAI API key validation failed for image generation', { context: 'OpenAIImageProvider.validateApiKey' }, error instanceof Error ? error : undefined);
      return false;
    }
  }

  async getAvailableModels(): Promise<string[]> {
    return this.supportedModels;
  }
}
