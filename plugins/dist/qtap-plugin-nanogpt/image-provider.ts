/**
 * NanoGPT Image Generation Provider Implementation for Quilltap Plugin
 *
 * Uses NanoGPT's OpenAI-compatible images route at
 * POST /api/v1/images/generations, which defaults to base64 responses
 * (`response_format: "b64_json"`) — exactly what Quilltap's consumers read.
 * Model discovery goes through GET /api/v1/image-models, a dedicated listing
 * with per-model capability flags; `?detailed=true` adds the per-model tags,
 * resolutions and image caps this plugin builds its options schema from.
 */

import OpenAI from 'openai';
import type { Images } from 'openai/resources';
import type {
  ImageProvider as ImageProviderBase,
  ImageGenParams,
  ImageGenResponse,
  ImageGenerationModelInfo,
  ImageLoraSupport,
  ProviderOptionField,
  ProviderOptionsSchema,
} from './types';
import { createPluginLogger, getQuilltapUserAgent } from '@quilltap/plugin-utils';
import { NANOGPT_BASE_URL, STATIC_IMAGE_MODELS, STATIC_IMAGE_MODEL_IDS } from './models';
import {
  applyLoras,
  applyPassthroughParameters,
  matchLoraFamily,
  NANOGPT_LORA_FAMILIES,
} from './image-loras';
import { fitImageShape } from './image-sizes';

const logger = createPluginLogger('qtap-plugin-nanogpt');

interface NanoGPTImageModelEntry {
  id: string;
  name?: string;
  description?: string;
  tags?: string[];
  max_images?: number;
  supported_parameters?: {
    resolutions?: string[];
    aspect_ratio?: string[];
  };
  capabilities?: {
    image_generation?: boolean;
    nsfw?: boolean;
  };
}

/**
 * The detailed catalog, cached module-wide.
 *
 * The options-schema hook is synchronous and gets no API key, so it cannot
 * fetch anything itself — but the profile editor always lists models before
 * (and whenever) it asks for a schema, and that listing does have the key.
 * So the listing fills this cache and the schema hook reads it. A cold cache
 * is not a failure: the schema falls back to the provider-wide size list,
 * which is what the hand-written panel offered before this existed.
 */
const CATALOG_TTL_MS = 60 * 60 * 1000;
let detailedCatalog: Map<string, NanoGPTImageModelEntry> | null = null;
let detailedCatalogFetchedAt = 0;

function catalogIsFresh(): boolean {
  return detailedCatalog !== null && Date.now() - detailedCatalogFetchedAt < CATALOG_TTL_MS;
}

/** The cached entry for a model id, or undefined when the cache can't help. */
function catalogEntry(model: string | undefined): NanoGPTImageModelEntry | undefined {
  if (!model || !catalogIsFresh()) return undefined;
  return detailedCatalog!.get(model);
}

/**
 * Sizes offered when the catalog has nothing to say — the ones hidream
 * advertises plus the 1536-wide pair the Flux and GPT-Image families share.
 * Kept in step with `NANOGPT_IMAGE_CONSTRAINTS.supportedSizes` in index.ts.
 */
const FALLBACK_SIZES = [
  '1024x1024',
  '768x1360',
  '1360x768',
  '880x1168',
  '1168x880',
  '1248x832',
  '832x1248',
  '1536x1024',
  '1024x1536',
];

/** "1248x832" -> "Landscape (1248x832)", for the size picker's labels. */
function labelForSize(size: string): string {
  const match = /^(\d+)\s*[x×]\s*(\d+)$/.exec(size.trim());
  if (!match) return size;
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (width === height) return `Square (${size})`;
  const ratio = width / height;
  if (ratio > 1) return ratio >= 1.6 ? `Wide (${size})` : `Landscape (${size})`;
  return ratio <= 0.625 ? `Tall (${size})` : `Portrait (${size})`;
}

/** True when a posted size or aspect ratio asks for something other than a square. */
function isNonSquare(size: string | null | undefined, aspectRatio: unknown): boolean {
  if (typeof aspectRatio === 'string') {
    const [width, height] = aspectRatio.split(':').map(Number);
    if (width > 0 && height > 0) return width !== height;
  }
  const dims = size ? /^\s*(\d+)\s*[x×*]\s*(\d+)\s*$/i.exec(size) : null;
  return dims !== null && dims[1] !== dims[2];
}

/**
 * Whether a failed generate call is one a square might get past: a 400 about
 * the output's size, resolution or aspect ratio, or an upstream 503. NanoGPT's
 * error body is a bare string, so the SDK keeps only the status and message.
 */
function isShapeFailure(error: unknown): boolean {
  const status = (error as { status?: unknown } | null)?.status;
  if (status === 503) return true;
  if (status !== 400) return false;
  const message = error instanceof Error ? error.message : String(error);
  return /\b(size|resolution|aspect|dimension|output)\b/i.test(message);
}

export class NanoGPTImageProvider implements ImageProviderBase {
  readonly provider = 'NANOGPT';
  readonly supportedModels = STATIC_IMAGE_MODEL_IDS;

  private baseUrl = NANOGPT_BASE_URL;

  async generateImage(params: ImageGenParams, apiKey: string): Promise<ImageGenResponse> {
    if (!apiKey) {
      throw new Error('NanoGPT provider requires an API key');
    }

    const client = new OpenAI({
      apiKey,
      baseURL: this.baseUrl,
      defaultHeaders: { 'User-Agent': getQuilltapUserAgent() },
    });

    // hidream is NanoGPT's own server-side default; make it explicit.
    const model = params.model ?? 'hidream';

    const requestParams: Images.ImageGenerateParams = {
      model,
      prompt: params.prompt,
      n: params.n ?? 1,
      // NanoGPT defaults to b64_json already; pin it so a future default
      // change upstream cannot silently hand us URLs.
      response_format: 'b64_json',
    };

    // Fit the requested shape onto what this model lists — the host's portrait
    // and landscape sizes are provider-wide, and a size the model does not
    // list is a hard 400 (bug 269).
    const sizeCatalog = (await this.catalogEntryFor(model, apiKey))?.supported_parameters;
    const shape = fitImageShape(sizeCatalog, params.size, params.aspectRatio);
    if (shape.adjusted) {
      logger.debug('Fitted the requested image shape to the model', {
        context: 'NanoGPTImageProvider.generateImage',
        model,
        requestedSize: params.size,
        requestedAspectRatio: params.aspectRatio,
        size: shape.size,
        aspectRatio: shape.aspectRatio,
      });
    }
    if (shape.size) {
      requestParams.size = shape.size as Images.ImageGenerateParams['size'];
    }

    // NanoGPT's model-specific generation controls ride the request body as
    // flat keys alongside the OpenAI-compatible fields — the documented
    // mechanism for `guidance_scale` / `num_inference_steps` / `strength` /
    // `seed`, and the same channel the LoRA fields use. The OpenAI SDK
    // serialises the params object as given, so extra keys travel; this is the
    // existing `seed` cast pattern, widened.
    const extraBody = requestParams as unknown as Record<string, unknown>;

    if (shape.aspectRatio) {
      extraBody.aspect_ratio = shape.aspectRatio;
    }
    if (params.seed !== undefined) {
      extraBody.seed = params.seed;
    }
    if (params.guidanceScale !== undefined) {
      extraBody.guidance_scale = params.guidanceScale;
    }
    if (params.steps !== undefined) {
      extraBody.num_inference_steps = params.steps;
    }
    if (params.negativePrompt) {
      extraBody.negative_prompt = params.negativePrompt;
    }

    const passthroughKeys = applyPassthroughParameters(extraBody, params.profileParameters);
    const applied = applyLoras(extraBody, model, params.loras, params.profileParameters);

    // Named rather than counted: when the dogfood run checks whether the flat
    // keys survived NanoGPT's legacy route, this line is the record of exactly
    // what was posted. A response identical to the no-LoRA one, with these
    // keys present in the log, is the signature of a silently-dropped key.
    logger.debug('Posting NanoGPT image request', {
      context: 'NanoGPTImageProvider.generateImage',
      model,
      size: requestParams.size,
      aspectRatio: shape.aspectRatio,
      n: requestParams.n,
      loraDialect: applied.dialect,
      loraKeys: applied.keys,
      loraDropped: applied.dropped,
      passthroughKeys,
    });

    let response: Awaited<ReturnType<typeof client.images.generate>>;
    try {
      try {
        response = await client.images.generate(requestParams);
      } catch (error) {
        // A non-square request the model turns down on its shape — a size it
        // does not list, or a ratio upstream cannot serve right now (Qwen
        // Image 3 answered every non-square ratio with an uncharged 503 while
        // 1:1 worked) — gets one more try as a plain square. A square picture
        // beats no picture; the caller measures what comes back. Bug 269.
        const square = isNonSquare(requestParams.size, extraBody.aspect_ratio) && isShapeFailure(error)
          ? fitImageShape(sizeCatalog, '1024x1024', undefined)
          : null;
        if (!square) throw error;
        logger.warn('NanoGPT turned down a non-square image; retrying once as a square', {
          context: 'NanoGPTImageProvider.generateImage',
          model,
          size: requestParams.size,
          aspectRatio: extraBody.aspect_ratio,
          squareSize: square.size,
          squareAspectRatio: square.aspectRatio,
          error: error instanceof Error ? error.message : String(error),
        });
        requestParams.size = square.size as Images.ImageGenerateParams['size'];
        if (square.aspectRatio) {
          extraBody.aspect_ratio = square.aspectRatio;
        } else {
          delete extraBody.aspect_ratio;
        }
        response = await client.images.generate(requestParams);
      }
    } catch (error) {
      // The failure path needs this more than the success path does. NanoGPT
      // answers a rejected adapter, an unreachable weights repo and a filtered
      // prompt with the same generic 400 — "try a different prompt or image" —
      // so the body that was posted is the only thing separating those causes,
      // and at `info` the debug line above is not there to consult. Key
      // *names* only: `keys` never carries a value, which is what keeps
      // `hf_api_token` out of the log.
      logger.error('NanoGPT image request failed', {
        context: 'NanoGPTImageProvider.generateImage',
        model,
        size: requestParams.size,
        aspectRatio: extraBody.aspect_ratio,
        n: requestParams.n,
        loraDialect: applied.dialect,
        loraKeys: applied.keys,
        loraDropped: applied.dropped,
        passthroughKeys,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }

    if (!('data' in response) || !response.data || !Array.isArray(response.data)) {
      logger.error('Invalid response from NanoGPT Images API', {
        context: 'NanoGPTImageProvider.generateImage',
      });
      throw new Error('Invalid response from NanoGPT Images API');
    }

    // b64_json is the requested format, but NanoGPT documents that either
    // field can appear (URL generation and base64 fall back to each other),
    // so handle both: download URL-only entries into base64, which is the
    // only form Quilltap's consumers read.
    const images = await Promise.all(
      response.data.map(async (img: { b64_json?: string; url?: string; revised_prompt?: string }) => {
        let data = img.b64_json;
        let mimeType = 'image/png';
        if (!data && img.url) {
          const imageResponse = await fetch(img.url);
          if (!imageResponse.ok) {
            throw new Error(`Failed to download NanoGPT image: HTTP ${imageResponse.status}`);
          }
          const contentType = imageResponse.headers.get('content-type');
          if (contentType && contentType.startsWith('image/')) {
            mimeType = contentType.split(';')[0];
          }
          data = Buffer.from(await imageResponse.arrayBuffer()).toString('base64');
        }
        if (!data) {
          throw new Error('NanoGPT image entry carried neither base64 data nor a URL');
        }
        return {
          data,
          url: img.url,
          mimeType,
          revisedPrompt: img.revised_prompt,
        };
      })
    );

    return {
      images,
      raw: response,
    };
  }

  async validateApiKey(apiKey: string): Promise<boolean> {
    if (!apiKey) return false;
    // Defer to the text provider's validation to avoid a paid image call.
    // Callers typically validate once via the text provider.
    return true;
  }

  /**
   * List image-generation models.
   *
   * Without an API key this is the curated static list. With a key, NanoGPT's
   * dedicated /image-models listing is queried (in its `?detailed=true` form,
   * which also feeds the options-schema cache) and filtered to entries whose
   * capability flags say they generate images — the listing also carries
   * edit-only and upscale-only entries. The curated ids are unioned in so the
   * documented flagships and the LoRA families always appear. Throws on
   * transport failure so the caller can fall back to `supportedModels` and
   * label the list as built-in.
   */
  async getAvailableModels(apiKey?: string): Promise<string[]> {
    if (!apiKey) {
      return [...this.supportedModels];
    }

    const entries = await this.fetchDetailedCatalog(apiKey);
    const merged = new Set<string>(
      entries
        .filter((m) => m.capabilities?.image_generation === true)
        .map((m) => m.id)
    );
    for (const id of STATIC_IMAGE_MODEL_IDS) merged.add(id);

    const imageModels = Array.from(merged).sort();
    logger.debug('Discovered NanoGPT image-generation models', {
      context: 'NanoGPTImageProvider.getAvailableModels',
      count: imageModels.length,
    });
    return imageModels;
  }

  /**
   * The catalog entry for a model, refreshing a cold cache with this call's
   * key. The job child never lists models, so its cache starts cold; a failed
   * fetch is not fatal — the request then goes out as asked.
   */
  private async catalogEntryFor(model: string, apiKey: string): Promise<NanoGPTImageModelEntry | undefined> {
    if (!catalogIsFresh()) {
      try {
        await this.fetchDetailedCatalog(apiKey);
      } catch (error) {
        logger.warn('Could not refresh the NanoGPT image catalog; posting the size as asked', {
          context: 'NanoGPTImageProvider.catalogEntryFor',
          model,
          error: error instanceof Error ? error.message : String(error),
        });
        return undefined;
      }
    }
    return catalogEntry(model);
  }

  /**
   * Fetch the detailed catalog and refresh the module cache.
   *
   * `?detailed=true` is the same endpoint the plugin already called, so this
   * costs no extra round trip — it just asks for the per-model tags,
   * resolutions and `max_images` alongside the ids.
   */
  private async fetchDetailedCatalog(apiKey: string): Promise<NanoGPTImageModelEntry[]> {
    const response = await fetch(`${this.baseUrl}/image-models?detailed=true`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'User-Agent': getQuilltapUserAgent(),
      },
    });
    if (!response.ok) {
      throw new Error(`NanoGPT image-model listing failed: HTTP ${response.status}`);
    }

    const payload = (await response.json()) as { data?: NanoGPTImageModelEntry[] };
    const entries = Array.isArray(payload.data) ? payload.data : [];

    detailedCatalog = new Map(entries.map((entry) => [entry.id, entry]));
    detailedCatalogFetchedAt = Date.now();
    logger.debug('Cached the detailed NanoGPT image catalog', {
      context: 'NanoGPTImageProvider.fetchDetailedCatalog',
      count: entries.length,
      loraTagged: entries.filter((e) => e.tags?.includes('lora')).length,
    });

    return entries;
  }
}

/**
 * The image-generation models this plugin declares statically, enriched from
 * the cached live catalog where it has something to add.
 *
 * The static families carry a real `loraSupport` — cap, scale range and all —
 * because their wire dialect is known. A model the live catalog merely *tags*
 * `lora` gets capability without a dialect: one adapter, permissive scale, and
 * `applyLoras` will refuse to guess a spelling for it and say so. That is
 * deliberately better than inventing an indexed body the model would ignore.
 */
export function getNanoGPTImageModels(): ImageGenerationModelInfo[] {
  const models: ImageGenerationModelInfo[] = STATIC_IMAGE_MODELS.map((model) => ({ ...model }));

  if (!catalogIsFresh()) {
    return models;
  }

  const known = new Set(models.map((m) => m.id));
  for (const entry of detailedCatalog!.values()) {
    if (known.has(entry.id)) continue;
    if (entry.capabilities?.image_generation !== true) continue;
    if (!entry.tags?.includes('lora')) continue;
    // A family the dialect table already covers by prefix needs no entry of
    // its own — the host's longest-prefix match finds the declared one.
    if (matchLoraFamily(entry.id)) continue;

    models.push({
      id: entry.id,
      name: entry.name ?? entry.id,
      description: entry.description,
      supportedSizes: entry.supported_parameters?.resolutions,
      loraSupport: {
        maxLoras: 1,
        sourceKinds: ['url', 'hf-repo'],
      } satisfies ImageLoraSupport,
    });
  }

  return models;
}

/**
 * Build the image-profile options schema for a model.
 *
 * Sizes and the image count come from the cached detailed catalog when it has
 * the model, so the picker offers what this model actually accepts rather than
 * one hardcoded list for two hundred models. The per-family extras
 * (steps, guidance, the fal preset, the pruna token) are gated with
 * `appliesToModels`, so a profile pointed at `hidream` is not offered a
 * `lora_preset` box it has no use for.
 *
 * LoRA URLs and scales are deliberately absent: they are a structured
 * repeating pair with their own editor, declared through `loraSupport`.
 */
export function getNanoGPTImageOptionsSchema(model?: string): ProviderOptionsSchema {
  const entry = catalogEntry(model);
  const sizes = entry?.supported_parameters?.resolutions?.length
    ? entry.supported_parameters.resolutions
    : FALLBACK_SIZES;
  const maxImages = entry?.max_images && entry.max_images > 0 ? entry.max_images : 1;

  const fields: ProviderOptionField[] = [
    {
      key: 'size',
      label: 'Default Size',
      type: 'enum',
      default: sizes.includes('1024x1024') ? '1024x1024' : sizes[0],
      helpText: entry
        ? 'The resolutions this model advertises. Requests that name no size take the first.'
        : "Common sizes across NanoGPT's image models; each model maps to its nearest native resolution.",
      enumValues: sizes.map((size) => ({ value: size, label: labelForSize(size) })),
    },
  ];

  if (maxImages > 1) {
    fields.push({
      key: 'n',
      label: 'Images per Request',
      type: 'number',
      default: 1,
      helpText: `This model returns up to ${maxImages} per request. Leave blank for one.`,
    });
  }

  // Diffusion dials. NanoGPT documents these as model-specific generation
  // controls; they mean nothing to the routed API models (GPT Image, Recraft),
  // so they are offered only to the open-weight families that read them.
  const diffusionModels = [
    'flux-lora',
    'flux-2-dev',
    'flux-2-klein-4b',
    'flux-2-klein-9b',
    'z-image-turbo-lora',
    'hidream',
    'wavespeed-ai/*',
    'pruna-ai/*',
  ];

  fields.push(
    {
      key: 'num_inference_steps',
      label: 'Inference Steps',
      type: 'number',
      helpText: 'More steps, more refinement, more time and money. Blank leaves it to the model.',
      appliesToModels: diffusionModels,
    },
    {
      key: 'guidance_scale',
      label: 'Guidance Scale',
      type: 'number',
      helpText:
        'How closely the model is held to the prompt. Low wanders and invents; high obeys and stiffens. Blank leaves it to the model.',
      appliesToModels: diffusionModels,
    },
  );

  // The fal-hosted flux-lora family is the only one that takes a named preset.
  fields.push({
    key: 'lora_preset',
    label: 'LoRA Preset',
    type: 'string',
    helpText:
      "A named preset offered by this model's host, applied alongside whatever adapter you list below. Leave blank unless you have been given one.",
    appliesToModels: ['flux-lora'],
  });

  // The pruna families can load private or gated HuggingFace weights.
  const tokenModels = NANOGPT_LORA_FAMILIES
    .filter((family) => family.support.supportsPrivateWeightsToken)
    .map((family) => `${family.prefix}*`);

  fields.push({
    key: 'hf_api_token',
    label: 'HuggingFace Token (private weights)',
    type: 'string',
    helpText:
      'Only needed when your LoRA lives behind a gated or private HuggingFace repository. It is sent to NanoGPT with the request, and only for the models that can use it.',
    appliesToModels: tokenModels,
  });

  return {
    groups: [
      {
        title: 'NanoGPT Image Options',
        helpText:
          "NanoGPT routes each request to the named model's own atelier, so these controls mean whatever that establishment takes them to mean — and the ones it has no use for are simply not offered. Sizes and the image count come from the model's own advertised capabilities where NanoGPT publishes them.",
        fields,
      },
    ],
  };
}
