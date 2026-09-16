/**
 * OpenAI Image Generation Provider Implementation for Quilltap Plugin
 *
 * Supports the GPT Image families (2.5 Sunburst / 2.5 Flare, 2, 1.5, 1, 1-mini)
 * and the legacy DALL-E models.
 * Note: DALL-E 2 and DALL-E 3 are deprecated and will stop being supported on 05/12/2026
 *
 * Every per-model fact this file branches on — which parameters a family
 * accepts, which quality tiers, which sizes — comes from the capability table in
 * `image-models.ts`, so the wire logic here never re-states a model's limits.
 */

import OpenAI from 'openai';
import type { ImageProvider, ImageGenParams, ImageGenResponse } from './types';
import { createPluginLogger, getQuilltapUserAgent } from '@quilltap/plugin-utils';
import {
  ARBITRARY_SIZE_RULES,
  OPENAI_IMAGE_MODEL_IDS,
  checkArbitrarySize,
  findImageModel,
  isGptImageModel,
  mimeTypeForFormat,
  parseSize,
  type OpenAIImageBackground,
  type OpenAIImageOutputFormat,
  type OpenAIImageQuality,
} from './image-models';

const logger = createPluginLogger('qtap-plugin-openai');

const OUTPUT_FORMATS: readonly OpenAIImageOutputFormat[] = ['png', 'jpeg', 'webp'];
const BACKGROUNDS: readonly OpenAIImageBackground[] = ['auto', 'transparent', 'opaque'];
const MODERATIONS = ['auto', 'low'] as const;

/** Formats that can carry an alpha channel, so a transparent background survives. */
const TRANSPARENCY_CAPABLE_FORMATS: readonly OpenAIImageOutputFormat[] = ['png', 'webp'];

/** Formats to which `output_compression` applies. */
const COMPRESSIBLE_FORMATS: readonly OpenAIImageOutputFormat[] = ['jpeg', 'webp'];

/**
 * Read one of a known set of strings out of the profile's residual parameter
 * bag. Anything unrecognised is dropped with a warning rather than forwarded —
 * the Images API rejects the whole request over one bad enum, so a typo in a
 * stored profile would otherwise take the image down with it.
 */
function readEnum<T extends string>(
  bag: Record<string, unknown> | undefined,
  key: string,
  allowed: readonly T[],
): T | undefined {
  const raw = bag?.[key];
  if (raw === undefined || raw === null || raw === '') {
    return undefined;
  }
  if (typeof raw === 'string' && (allowed as readonly string[]).includes(raw)) {
    return raw as T;
  }
  logger.warn('Ignoring unsupported OpenAI image parameter value', {
    context: 'OpenAIImageProvider.readEnum',
    key,
    value: String(raw),
    allowed: allowed.join(', '),
  });
  return undefined;
}

/** Read an integer in `[min, max]` from the residual bag, dropping anything else. */
function readIntInRange(
  bag: Record<string, unknown> | undefined,
  key: string,
  min: number,
  max: number,
): number | undefined {
  const raw = bag?.[key];
  if (raw === undefined || raw === null || raw === '') {
    return undefined;
  }
  const value = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < min || value > max) {
    logger.warn('Ignoring out-of-range OpenAI image parameter', {
      context: 'OpenAIImageProvider.readIntInRange',
      key,
      value: String(raw),
      min,
      max,
    });
    return undefined;
  }
  return value;
}

export class OpenAIImageProvider implements ImageProvider {
  readonly provider = 'OPENAI';
  readonly supportedModels = [...OPENAI_IMAGE_MODEL_IDS];

  private isGptImageModel(model: string): boolean {
    return isGptImageModel(model);
  }

  /**
   * Validate and normalize size for the OpenAI API.
   *
   * GPT Image 2 and both GPT Image 2.5 models take any `WIDTHxHEIGHT` meeting
   * the documented edge, aspect and pixel rules, so those are forwarded as
   * given; everything else is checked against its family's standard list. An
   * unusable size falls back to `1024x1024` — the one size every family
   * supports — and says in the log what was wrong, because silently returning a
   * differently-shaped image is the harder failure to diagnose.
   */
  private validateAndNormalizeSize(size: string | undefined, model: string): string {
    if (!size) {
      return '1024x1024';
    }

    const caps = findImageModel(model);

    // A model the plugin does not recognise (a live /v1/models listing can name
    // one): forward the caller's size untouched rather than guess its limits.
    if (!caps) {
      return size;
    }

    if (caps.sizes.includes(size)) {
      return size;
    }

    if (caps.arbitrarySizes) {
      const check = checkArbitrarySize(size);
      if (check.ok) {
        const parsed = parseSize(size)!;
        if (parsed.width * parsed.height > ARBITRARY_SIZE_RULES.experimentalAbovePixels) {
          logger.debug('Requesting an experimental OpenAI image resolution', {
            context: 'OpenAIImageProvider.validateAndNormalizeSize',
            model,
            size,
          });
        }
        return size;
      }
      logger.warn('Falling back to 1024x1024: unsupported OpenAI image size', {
        context: 'OpenAIImageProvider.validateAndNormalizeSize',
        model,
        size,
        reason: check.reason,
      });
      return '1024x1024';
    }

    logger.warn('Falling back to 1024x1024: size not supported by this OpenAI model', {
      context: 'OpenAIImageProvider.validateAndNormalizeSize',
      model,
      size,
      supported: caps.sizes.join(', '),
    });
    return '1024x1024';
  }

  /**
   * Pick the quality tier to send, given what the selected family accepts.
   *
   * The tiers are family-specific — `xhigh` and `max` are GPT Image 2.5's alone,
   * and `hd` is DALL·E 3's — so a profile carrying a tier the chosen model does
   * not know is dropped rather than forwarded into a 400. GPT Image sends
   * nothing when unset (the API's own `auto` default applies); DALL·E keeps its
   * historical `standard` default.
   */
  private resolveQuality(
    quality: string | undefined,
    model: string,
  ): OpenAIImageQuality | undefined {
    const caps = findImageModel(model);
    const isGptImage = this.isGptImageModel(model);

    if (!quality) {
      return isGptImage ? undefined : 'standard';
    }
    if (!caps) {
      return quality as OpenAIImageQuality;
    }
    if ((caps.qualities as readonly string[]).includes(quality)) {
      return quality as OpenAIImageQuality;
    }

    logger.warn('Ignoring quality tier unsupported by this OpenAI model', {
      context: 'OpenAIImageProvider.resolveQuality',
      model,
      quality,
      supported: caps.qualities.join(', '),
    });
    return isGptImage ? undefined : 'standard';
  }

  async generateImage(params: ImageGenParams, apiKey: string): Promise<ImageGenResponse> {
    const client = new OpenAI({
      apiKey,
      defaultHeaders: { 'User-Agent': getQuilltapUserAgent() },
    });

    const modelName = params.model ?? 'dall-e-3';
    const caps = findImageModel(modelName);
    // gpt-image models have different parameter support than DALL-E models
    const isGptImage = this.isGptImageModel(modelName);
    const bag = params.profileParameters;

    const requestedN = params.n ?? 1;
    const n = caps ? Math.min(Math.max(requestedN, 1), caps.maxN) : requestedN;
    if (n !== requestedN) {
      logger.warn('Capping image count to the model maximum', {
        context: 'OpenAIImageProvider.generateImage',
        model: modelName,
        requested: requestedN,
        capped: n,
      });
    }

    const requestParams: Record<string, unknown> = {
      model: params.model,
      prompt: params.prompt,
      n,
    };

    // gpt-image models always return base64 and reject response_format;
    // DALL-E models default to a URL, so ask them for b64_json explicitly.
    if (!isGptImage) {
      requestParams.response_format = 'b64_json';
    }

    // Size handling with validation
    requestParams.size = this.validateAndNormalizeSize(params.size, modelName);

    const quality = this.resolveQuality(params.quality, modelName);
    if (quality !== undefined) {
      requestParams.quality = quality;
    }

    // style is DALL-E 3's alone — dall-e-2 and the GPT Image families reject it.
    if (caps ? caps.supportsStyle : !isGptImage) {
      requestParams.style = params.style ?? 'vivid';
    }

    // ---- GPT Image extras -------------------------------------------------
    // background / output_format / output_compression / moderation are the
    // GPT Image families' own parameters; they ride the profile's residual bag
    // under their wire names, so the host never has to enumerate them.
    let outputFormat: OpenAIImageOutputFormat | undefined;
    if (isGptImage) {
      outputFormat = readEnum(bag, 'output_format', OUTPUT_FORMATS);
      const background = readEnum(bag, 'background', BACKGROUNDS);
      const moderation = readEnum(bag, 'moderation', MODERATIONS);
      const outputCompression = readIntInRange(bag, 'output_compression', 0, 100);

      if (background !== undefined) {
        // A transparent background needs an alpha-capable format. Honour the
        // more specific intent — the user asked for transparency — and say so,
        // rather than letting the API return a silently flattened JPEG.
        if (
          background === 'transparent' &&
          outputFormat !== undefined &&
          !TRANSPARENCY_CAPABLE_FORMATS.includes(outputFormat)
        ) {
          logger.warn('Forcing PNG output: a transparent background needs png or webp', {
            context: 'OpenAIImageProvider.generateImage',
            model: modelName,
            requestedFormat: outputFormat,
          });
          outputFormat = 'png';
        }
        requestParams.background = background;
      }

      if (outputFormat !== undefined) {
        requestParams.output_format = outputFormat;
      }

      if (outputCompression !== undefined) {
        // Only webp and jpeg are compressed; png ignores the parameter, and the
        // API rejects it outright on some families.
        if (outputFormat !== undefined && COMPRESSIBLE_FORMATS.includes(outputFormat)) {
          requestParams.output_compression = outputCompression;
        } else {
          logger.debug('Dropping output_compression: it applies only to jpeg and webp', {
            context: 'OpenAIImageProvider.generateImage',
            model: modelName,
            outputFormat: outputFormat ?? 'png (default)',
          });
        }
      }

      if (moderation !== undefined) {
        requestParams.moderation = moderation;
      }
    }

    logger.debug('Calling OpenAI Images API', {
      context: 'OpenAIImageProvider.generateImage',
      model: modelName,
      size: requestParams.size,
      quality: requestParams.quality ?? '(model default)',
      background: requestParams.background ?? '(model default)',
      outputFormat: requestParams.output_format ?? '(model default)',
      outputCompression: requestParams.output_compression ?? '(model default)',
      moderation: requestParams.moderation ?? '(model default)',
      n,
    });

    // The request is assembled as a loose bag because which keys are legal
    // depends on the model family; pin the cast to the non-streaming params so
    // the response type is the image list rather than the streaming union.
    const response = await client.images.generate(
      requestParams as unknown as OpenAI.Images.ImageGenerateParamsNonStreaming,
    );

    if (!response.data || !Array.isArray(response.data)) {
      logger.error('Invalid response from OpenAI Images API', { context: 'OpenAIImageProvider.generateImage' });
      throw new Error('Invalid response from OpenAI Images API');
    }

    const mimeType = mimeTypeForFormat(outputFormat);
    return {
      images: response.data.map((img) => ({
        // gpt-image models return b64_json, DALL-E models were asked for it
        data: img.b64_json || img.url || '',
        mimeType,
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

  /**
   * List image-generation models.
   *
   * Without an API key this is the curated static list. With a key, GET
   * /v1/models is queried and filtered to the Images-API families
   * (`dall-e-*`, `gpt-image-*`) — the endpoint reflects what the account can
   * actually reach (e.g. gpt-image models gated behind org verification), so
   * the filtered list is the honest answer. Throws on transport failure or an
   * empty result so the caller can fall back to `supportedModels` and label
   * the list as built-in rather than live.
   */
  async getAvailableModels(apiKey?: string): Promise<string[]> {
    if (!apiKey) {
      return [...this.supportedModels];
    }

    const client = new OpenAI({
      apiKey,
      defaultHeaders: { 'User-Agent': getQuilltapUserAgent() },
    });
    const response = await client.models.list();
    const imageModels = response.data
      .map((m) => m.id)
      .filter((id) => /^(dall-e|gpt-image)/.test(id))
      .sort();

    if (imageModels.length === 0) {
      throw new Error('OpenAI /v1/models listed no image-generation models for this API key');
    }

    logger.debug('Discovered OpenAI image-generation models', {
      context: 'OpenAIImageProvider.getAvailableModels',
      count: imageModels.length,
    });
    return imageModels;
  }
}
