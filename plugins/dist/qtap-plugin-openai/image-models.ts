/**
 * OpenAI image-model capability table — the plugin's single source of truth for
 * what each Images-API family accepts.
 *
 * Three consumers read from here and none of them re-derives any of it:
 *   - `image-provider.ts`, to decide which parameters reach the wire and to
 *     validate a requested size;
 *   - `index.ts`'s `getImageGenerationModels()`, for the host's orientation and
 *     size declarations;
 *   - `index.ts`'s `getImageProviderOptionsSchema()`, for the image-profile
 *     editor's fields.
 *
 * Families are matched by longest prefix, so dated snapshots ride their family's
 * entry for free (`gpt-image-2.5-flare-2026-09-08` → `gpt-image-2.5-flare`) and
 * the overlapping ids resolve the way you would hope: `gpt-image-2.5-sunburst`
 * beats `gpt-image-2`, and `gpt-image-1-mini` beats `gpt-image-1`.
 *
 * @module image-models
 */

/** Quality tiers, in the order the editor lists them. */
export type OpenAIImageQuality =
  | 'auto'
  | 'low'
  | 'medium'
  | 'high'
  | 'xhigh'
  | 'max'
  | 'standard'
  | 'hd';

/** Wire formats the GPT Image families can return. */
export type OpenAIImageOutputFormat = 'png' | 'jpeg' | 'webp';

/** Background treatments the GPT Image families accept. */
export type OpenAIImageBackground = 'auto' | 'transparent' | 'opaque';

export interface OpenAIImageModelCapabilities {
  /** Family id, and the prefix every dated snapshot of it starts with. */
  id: string;
  /** Display name for the editor and the host's model list. */
  name: string;
  /**
   * True for the `gpt-image-*` families, which always return base64, accept
   * `background` / `output_format` / `output_compression` / `moderation`, and
   * reject `response_format` and `style`.
   */
  gptImage: boolean;
  /** Quality tiers this family accepts, in editor order. */
  qualities: readonly OpenAIImageQuality[];
  /** Standard sizes, offered in the editor and declared to the host. */
  sizes: readonly string[];
  /**
   * True where the API takes any `WIDTHxHEIGHT` satisfying
   * {@link ARBITRARY_SIZE_RULES} — GPT Image 2 and both GPT Image 2.5 models.
   */
  arbitrarySizes: boolean;
  /** `style` is DALL·E 3's alone. */
  supportsStyle: boolean;
  /** Ceiling on `n` for one request. */
  maxN: number;
}

/**
 * The documented limits on an arbitrary `WIDTHxHEIGHT` request. OpenAI reserves
 * the right to apply tighter per-model pixel and edge limits on top of these, so
 * a size that clears them all is forwarded rather than guaranteed — the API is
 * the final authority, and its rejection names the real limit.
 */
export const ARBITRARY_SIZE_RULES = {
  /** Both edges must be divisible by this. */
  edgeMultiple: 16,
  /** Longest edge over shortest may not exceed this (1:3 … 3:1). */
  maxAspect: 3,
  /** No edge may exceed the long side of the maximum resolution. */
  maxEdge: 3840,
  /** Total pixels may not exceed the maximum resolution's budget. */
  maxPixels: 3840 * 2160,
  /** Above this many pixels the docs call the resolution experimental. */
  experimentalAbovePixels: 2560 * 1440,
} as const;

const GPT_IMAGE_STANDARD_SIZES = ['auto', '1024x1024', '1536x1024', '1024x1536'] as const;

/**
 * Sizes offered in the editor for the arbitrary-resolution families. The API
 * takes far more than these — this is a picker, not the limit — so the list
 * stays a useful spread of shapes rather than an enumeration.
 */
const GPT_IMAGE_WIDE_SIZES = [
  'auto',
  '1024x1024',
  '1536x1024',
  '1024x1536',
  '1792x1024',
  '1024x1792',
  '1920x1088',
  '1088x1920',
  '2048x2048',
  '2560x1440',
  '1440x2560',
  '3840x2160',
  '2160x3840',
] as const;

const GPT_IMAGE_QUALITIES = ['auto', 'low', 'medium', 'high'] as const;
const GPT_IMAGE_25_QUALITIES = ['auto', 'low', 'medium', 'high', 'xhigh', 'max'] as const;

/**
 * Every family the plugin knows, newest first. `supportedModels` and the host's
 * model list are both derived from this, so adding a family here is the whole
 * job of adding a model.
 */
export const OPENAI_IMAGE_MODELS: readonly OpenAIImageModelCapabilities[] = [
  {
    id: 'gpt-image-2.5-sunburst',
    name: 'GPT Image 2.5 Sunburst',
    gptImage: true,
    qualities: GPT_IMAGE_25_QUALITIES,
    sizes: GPT_IMAGE_WIDE_SIZES,
    arbitrarySizes: true,
    supportsStyle: false,
    maxN: 10,
  },
  {
    id: 'gpt-image-2.5-flare',
    name: 'GPT Image 2.5 Flare',
    gptImage: true,
    qualities: GPT_IMAGE_25_QUALITIES,
    sizes: GPT_IMAGE_WIDE_SIZES,
    arbitrarySizes: true,
    supportsStyle: false,
    maxN: 10,
  },
  {
    id: 'gpt-image-2',
    name: 'GPT Image 2',
    gptImage: true,
    qualities: GPT_IMAGE_QUALITIES,
    sizes: GPT_IMAGE_WIDE_SIZES,
    arbitrarySizes: true,
    supportsStyle: false,
    maxN: 10,
  },
  {
    id: 'gpt-image-1.5',
    name: 'GPT Image 1.5',
    gptImage: true,
    qualities: GPT_IMAGE_QUALITIES,
    sizes: GPT_IMAGE_STANDARD_SIZES,
    arbitrarySizes: false,
    supportsStyle: false,
    maxN: 10,
  },
  {
    id: 'gpt-image-1-mini',
    name: 'GPT Image 1 Mini',
    gptImage: true,
    qualities: GPT_IMAGE_QUALITIES,
    sizes: GPT_IMAGE_STANDARD_SIZES,
    arbitrarySizes: false,
    supportsStyle: false,
    maxN: 10,
  },
  {
    id: 'gpt-image-1',
    name: 'GPT Image 1',
    gptImage: true,
    qualities: GPT_IMAGE_QUALITIES,
    sizes: GPT_IMAGE_STANDARD_SIZES,
    arbitrarySizes: false,
    supportsStyle: false,
    maxN: 10,
  },
  {
    id: 'dall-e-3',
    name: 'DALL·E 3',
    gptImage: false,
    qualities: ['standard', 'hd'],
    sizes: ['1024x1024', '1792x1024', '1024x1792'],
    arbitrarySizes: false,
    supportsStyle: true,
    maxN: 1,
  },
  {
    id: 'dall-e-2',
    name: 'DALL·E 2',
    gptImage: false,
    qualities: ['standard'],
    sizes: ['256x256', '512x512', '1024x1024'],
    arbitrarySizes: false,
    supportsStyle: false,
    maxN: 10,
  },
];

/** Model ids in the order the editor and `supportedModels` list them. */
export const OPENAI_IMAGE_MODEL_IDS: readonly string[] = OPENAI_IMAGE_MODELS.map(m => m.id);

/**
 * The capability entry governing `model`: exact id first, then the longest
 * family prefix, so dated snapshots resolve without their own entry. Returns
 * undefined for a model this plugin does not recognise — a live `/v1/models`
 * listing can name one, and guessing its limits would be worse than forwarding
 * the request untouched.
 */
export function findImageModel(
  model: string | undefined,
): OpenAIImageModelCapabilities | undefined {
  if (!model) {
    return undefined;
  }
  const exact = OPENAI_IMAGE_MODELS.find(m => m.id === model);
  if (exact) {
    return exact;
  }
  return OPENAI_IMAGE_MODELS.filter(m => model.startsWith(m.id)).sort(
    (a, b) => b.id.length - a.id.length,
  )[0];
}

/** Whether `model` belongs to one of the `gpt-image-*` families. */
export function isGptImageModel(model: string | undefined): boolean {
  return findImageModel(model)?.gptImage ?? (model ?? '').startsWith('gpt-image-');
}

export interface ParsedSize {
  width: number;
  height: number;
}

/** Parse a `WIDTHxHEIGHT` string, or undefined when it is not one. */
export function parseSize(size: string): ParsedSize | undefined {
  const match = /^(\d+)x(\d+)$/.exec(size.trim());
  if (!match) {
    return undefined;
  }
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    return undefined;
  }
  return { width, height };
}

/**
 * Check an arbitrary `WIDTHxHEIGHT` against {@link ARBITRARY_SIZE_RULES},
 * naming the rule it breaks so the caller can log something a user can act on.
 */
export function checkArbitrarySize(size: string): { ok: true } | { ok: false; reason: string } {
  const parsed = parseSize(size);
  if (!parsed) {
    return { ok: false, reason: 'not a WIDTHxHEIGHT value' };
  }
  const { width, height } = parsed;
  const { edgeMultiple, maxAspect, maxEdge, maxPixels } = ARBITRARY_SIZE_RULES;

  if (width % edgeMultiple !== 0 || height % edgeMultiple !== 0) {
    return { ok: false, reason: `both edges must be divisible by ${edgeMultiple}` };
  }
  if (Math.max(width, height) / Math.min(width, height) > maxAspect) {
    return { ok: false, reason: `aspect ratio must be between 1:${maxAspect} and ${maxAspect}:1` };
  }
  if (width > maxEdge || height > maxEdge) {
    return { ok: false, reason: `no edge may exceed ${maxEdge}px` };
  }
  if (width * height > maxPixels) {
    return { ok: false, reason: `total pixels may not exceed ${maxPixels}` };
  }
  return { ok: true };
}

/** MIME type for a returned image, given the requested output format. */
export function mimeTypeForFormat(format: OpenAIImageOutputFormat | undefined): string {
  switch (format) {
    case 'jpeg':
      return 'image/jpeg';
    case 'webp':
      return 'image/webp';
    default:
      return 'image/png';
  }
}
