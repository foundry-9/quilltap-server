/**
 * Image Provider — Shape 2: Text -> Image
 *
 * Send instructions (a prompt) to an image generation model,
 * receive one or more generated images.
 *
 * @module @quilltap/plugin-types/providers/image
 */

/**
 * Image generation parameters
 */
export interface ImageGenParams {
  /** Image generation prompt */
  prompt: string;
  /** Negative prompt (what to avoid) */
  negativePrompt?: string;
  /** Model identifier */
  model?: string;
  /** Image size (e.g., '1024x1024') */
  size?: string;
  /** Aspect ratio (e.g., '16:9') */
  aspectRatio?: string;
  /** Image quality */
  quality?: 'standard' | 'hd';
  /** Image style */
  style?: 'vivid' | 'natural';
  /** Number of images to generate */
  n?: number;
  /** Response format */
  responseFormat?: 'url' | 'b64_json';
  /** Seed for reproducibility */
  seed?: number;
  /** Guidance scale for diffusion models */
  guidanceScale?: number;
  /** Inference steps for diffusion models */
  steps?: number;
}

/**
 * Generated image result
 */
export interface GeneratedImage {
  /** Base64 encoded image data */
  data?: string;
  /** URL to the generated image */
  url?: string;
  /** Deprecated: use 'data' instead */
  b64Json?: string;
  /** Image MIME type */
  mimeType?: string;
  /** Revised prompt (some providers modify the prompt) */
  revisedPrompt?: string;
  /** Seed used for generation */
  seed?: number;
}

/**
 * Image generation response
 */
export interface ImageGenResponse {
  /** Array of generated images */
  images: GeneratedImage[];
  /** Provider-specific raw response */
  raw?: unknown;
}

/**
 * Image generation provider interface — Shape 2: Text -> Image
 *
 * Sends a text prompt to an image generation model and receives
 * one or more generated images.
 */
export interface ImageProvider {
  /** Provider identifier */
  readonly provider: string;
  /** Models supported by this provider */
  readonly supportedModels: string[];

  /**
   * Generate an image from a text prompt
   */
  generateImage(params: ImageGenParams, apiKey: string): Promise<ImageGenResponse>;

  /**
   * Validate an API key
   */
  validateApiKey(apiKey: string): Promise<boolean>;

  /**
   * Get available models
   */
  getAvailableModels(apiKey?: string): Promise<string[]>;
}
