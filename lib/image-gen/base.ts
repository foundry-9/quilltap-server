/**
 * Base class for image generation providers
 * Implements a unified interface for different image generation APIs
 */

import type { ImageProvider, ImageGenParams, ImageGenResponse } from '@quilltap/plugin-types'

// Re-export types for backward compatibility
export type { ImageGenParams, GeneratedImage, ImageGenResponse, ImageProvider } from '@quilltap/plugin-types'

/** @deprecated Use ImageProvider instead */
export type ImageGenProvider = ImageProvider

export abstract class BaseImageProvider implements ImageProvider {
  abstract readonly provider: string;
  abstract readonly supportedModels: string[];

  abstract generateImage(
    params: ImageGenParams,
    apiKey: string
  ): Promise<ImageGenResponse>;

  abstract validateApiKey(apiKey: string): Promise<boolean>;

  abstract getAvailableModels(apiKey?: string): Promise<string[]>;
}
