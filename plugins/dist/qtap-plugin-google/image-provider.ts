/**
 * Google Image Generation Provider Implementation for Quilltap Plugin
 *
 * Supports both:
 * - Imagen models via :predict API (imagen-4, imagen-4-fast)
 * - Gemini image models via :generateContent API (gemini-2.5-flash-image, gemini-3-pro-image-preview)
 */

import type {
  ImageProvider,
  ImageGenParams,
  ImageGenResponse,
} from './types';
import { createPluginLogger } from '@quilltap/plugin-utils';

const logger = createPluginLogger('qtap-plugin-google');

/**
 * Models that use the Gemini generateContent API for image generation
 * These models require responseModalities: ["TEXT", "IMAGE"]
 */
const GEMINI_IMAGE_MODELS = [
  'gemini-2.5-flash-image',
  'gemini-3-pro-image-preview',
];

/**
 * Models that use the Imagen predict API
 * Maps user-friendly names to actual API model IDs
 */
const IMAGEN_MODELS = ['imagen-4', 'imagen-4-fast'];

/**
 * Map user-friendly model names to actual Google API model IDs
 */
const IMAGEN_MODEL_MAP: Record<string, string> = {
  'imagen-4': 'imagen-4.0-generate-001',
  'imagen-4-fast': 'imagen-4.0-fast-generate-001',
};

export class GoogleImagenProvider implements ImageProvider {
  readonly provider = 'GOOGLE';
  readonly supportedModels = [...IMAGEN_MODELS, ...GEMINI_IMAGE_MODELS];

  /**
   * Check if a model uses the Gemini generateContent API
   */
  private isGeminiImageModel(model: string): boolean {
    return GEMINI_IMAGE_MODELS.some(
      (m) => model === m || model.startsWith(`${m}-`) || model.includes(m)
    );
  }

  async generateImage(
    params: ImageGenParams,
    apiKey: string
  ): Promise<ImageGenResponse> {
    const model = params.model ?? 'imagen-4';
    // Route to the appropriate API based on model type
    if (this.isGeminiImageModel(model)) {
      return this.generateWithGemini(params, apiKey, model);
    } else {
      return this.generateWithImagen(params, apiKey, model);
    }
  }

  /**
   * Generate images using Gemini's generateContent API
   * Used for: gemini-2.5-flash-image, gemini-3-pro-image-preview (Nano Banana Pro)
   */
  private async generateWithGemini(
    params: ImageGenParams,
    apiKey: string,
    model: string
  ): Promise<ImageGenResponse> {
    const baseUrl = 'https://generativelanguage.googleapis.com/v1beta';
    const endpoint = `${baseUrl}/models/${model}:generateContent`;

    // Build request body for Gemini image generation
    const requestBody: Record<string, unknown> = {
      contents: [
        {
          parts: [{ text: params.prompt }],
        },
      ],
      generationConfig: {
        responseModalities: ['TEXT', 'IMAGE'],
      },
    };

    // Add image configuration if aspect ratio or size specified
    const imageConfig: Record<string, string> = {};
    if (params.aspectRatio) {
      imageConfig.aspectRatio = params.aspectRatio;
    }

    // Extended params for size/resolution
    const extendedParams = params as ImageGenParams & {
      imageSize?: string;
      seed?: number;
    };
    if (extendedParams.imageSize) {
      imageConfig.imageSize = extendedParams.imageSize;
    }

    if (Object.keys(imageConfig).length > 0) {
      (requestBody.generationConfig as Record<string, unknown>).imageConfig =
        imageConfig;
    }
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'x-goog-api-key': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const error = await response.json();
      logger.error('Gemini API error', {
        context: 'GoogleImagenProvider.generateWithGemini',
        status: response.status,
        errorMessage: error.error?.message,
      });
      throw new Error(
        error.error?.message || `Gemini API error: ${response.status}`
      );
    }

    const data = await response.json();

    // Extract images from Gemini response format
    // Response: { candidates: [{ content: { parts: [{ text?, inlineData: { mimeType, data } }] } }] }
    const images: { data: string; mimeType: string }[] = [];
    let textResponse = '';

    const candidate = data.candidates?.[0];
    if (candidate?.content?.parts) {
      for (const part of candidate.content.parts) {
        if (part.inlineData) {
          images.push({
            data: part.inlineData.data,
            mimeType: part.inlineData.mimeType || 'image/png',
          });
        } else if (part.text) {
          textResponse = part.text;
        }
      }
    }
    if (images.length === 0) {
      throw new Error(
        textResponse || 'No images returned from Gemini API'
      );
    }

    return {
      images,
      raw: data,
    };
  }

  /**
   * Generate images using Imagen's predict API
   * Used for: imagen-4, imagen-4-fast
   */
  private async generateWithImagen(
    params: ImageGenParams,
    apiKey: string,
    model: string
  ): Promise<ImageGenResponse> {
    const baseUrl = 'https://generativelanguage.googleapis.com/v1beta';
    // Map user-friendly model name to actual API model ID
    const apiModelId = IMAGEN_MODEL_MAP[model] || model;
    const endpoint = `${baseUrl}/models/${apiModelId}:predict`;

    const requestBody: Record<string, unknown> = {
      instances: [
        {
          prompt: params.prompt,
        },
      ],
      parameters: {
        sampleCount: params.n ?? 1,
      },
    };

    // Add optional parameters
    if (params.aspectRatio) {
      (requestBody.parameters as Record<string, unknown>).aspectRatio =
        params.aspectRatio;
    }

    // Seed parameter is provider-specific
    const extendedParams = params as ImageGenParams & { seed?: number };
    if (extendedParams.seed !== undefined) {
      (requestBody.parameters as Record<string, unknown>).seed =
        extendedParams.seed;
    }
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'x-goog-api-key': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const error = await response.json();
      logger.error('Google Imagen API error', {
        context: 'GoogleImagenProvider.generateWithImagen',
        status: response.status,
        errorMessage: error.error?.message,
      });
      throw new Error(
        error.error?.message || `Google Imagen API error: ${response.status}`
      );
    }

    const data = await response.json();
    return {
      images: (data.predictions ?? []).map((pred: any) => ({
        data: pred.bytesBase64Encoded,
        mimeType: pred.mimeType || 'image/png',
      })),
      raw: data,
    };
  }

  async validateApiKey(apiKey: string): Promise<boolean> {
    try {
      // Validate the API key by calling the models list endpoint
      const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models', {
        method: 'GET',
        headers: {
          'x-goog-api-key': apiKey,
        },
      });

      const isValid = response.ok;
      return isValid;
    } catch (error) {
      logger.error('Google API key validation failed for image generation', {
        context: 'GoogleImagenProvider.validateApiKey',
      }, error instanceof Error ? error : undefined);
      return false;
    }
  }

  async getAvailableModels(): Promise<string[]> {
    return this.supportedModels;
  }
}
