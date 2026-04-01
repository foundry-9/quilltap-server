/**
 * OpenAI Image Generation Provider Implementation for Quilltap Plugin
 *
 * Supports GPT-Image models (1.5, 1, 1-mini) and legacy DALL-E models
 * Note: DALL-E 2 and DALL-E 3 are deprecated and will stop being supported on 05/12/2026
 * Handles model-specific parameter validation and normalization
 */

import OpenAI from 'openai';
import type { ImageGenProvider as ImageGenProviderBase, ImageGenParams, ImageGenResponse } from './types';
import { createPluginLogger } from '@quilltap/plugin-utils';

const logger = createPluginLogger('qtap-plugin-openai');

export class OpenAIImageProvider implements ImageGenProviderBase {
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
      logger.debug('Normalizing size for gpt-image model', { context: 'OpenAIImageProvider.validateAndNormalizeSize', model, originalSize: size, normalizedSize: '1024x1024' });
      return '1024x1024';
    }

    if (model === 'dall-e-3') {
      // dall-e-3 supports: 1024x1024, 1024x1792, 1792x1024
      const dalleThreeSizes = ['1024x1024', '1024x1792', '1792x1024'];
      if (dalleThreeSizes.includes(size)) {
        return size;
      }
      // Map unsupported sizes to nearest valid size
      logger.debug('Normalizing size for dall-e-3', { context: 'OpenAIImageProvider.validateAndNormalizeSize', originalSize: size, normalizedSize: '1024x1024' });
      return '1024x1024';
    }

    // dall-e-2 supports: 256x256, 512x512, 1024x1024
    const dalleTwoSizes = ['256x256', '512x512', '1024x1024'];
    if (dalleTwoSizes.includes(size)) {
      return size;
    }
    logger.debug('Normalizing size for dall-e-2', { context: 'OpenAIImageProvider.validateAndNormalizeSize', originalSize: size, normalizedSize: '1024x1024' });
    return '1024x1024';
  }

  async generateImage(params: ImageGenParams, apiKey: string): Promise<ImageGenResponse> {
    logger.debug('OpenAI image generation started', {
      context: 'OpenAIImageProvider.generateImage',
      model: params.model,
      promptLength: params.prompt.length,
      n: params.n ?? 1,
    });

    const client = new OpenAI({ apiKey });

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
      logger.debug('Applied DALL-E specific parameters', {
        context: 'OpenAIImageProvider.generateImage',
        quality: requestParams.quality,
        style: requestParams.style,
      });
    }

    const response = await client.images.generate(requestParams);

    if (!response.data || !Array.isArray(response.data)) {
      logger.error('Invalid response from OpenAI Images API', { context: 'OpenAIImageProvider.generateImage' });
      throw new Error('Invalid response from OpenAI Images API');
    }

    logger.debug('Image generation completed', {
      context: 'OpenAIImageProvider.generateImage',
      imageCount: response.data.length,
    });

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
      logger.debug('Validating OpenAI API key for image generation', { context: 'OpenAIImageProvider.validateApiKey' });
      const client = new OpenAI({ apiKey });
      await client.models.list();
      logger.debug('OpenAI API key validation successful', { context: 'OpenAIImageProvider.validateApiKey' });
      return true;
    } catch (error) {
      logger.error('OpenAI API key validation failed for image generation', { context: 'OpenAIImageProvider.validateApiKey' }, error instanceof Error ? error : undefined);
      return false;
    }
  }

  async getAvailableModels(): Promise<string[]> {
    logger.debug('Getting available OpenAI image models', { context: 'OpenAIImageProvider.getAvailableModels' });
    return this.supportedModels;
  }
}
