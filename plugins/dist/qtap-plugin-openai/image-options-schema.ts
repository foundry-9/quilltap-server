/**
 * The image-profile options schema the Quilltap host renders for OpenAI.
 *
 * Built per model from the capability table in `image-models.ts`: the quality
 * list is the selected family's own tiers, the size list its own resolutions,
 * and the GPT Image extras appear only for the families that accept them. The
 * host refetches this whenever the selected model changes, so the editor never
 * offers a knob the chosen model would reject.
 *
 * Storage keys are the OpenAI wire names, because that is what
 * `image-provider.ts` reads back off `ImageGenParams.profileParameters` —
 * except `size`, `quality` and `style`, which the host lifts onto the named
 * `ImageGenParams` fields and the provider therefore reads from `params`.
 *
 * @module image-options-schema
 */

import type {
  ProviderOptionEnumValue,
  ProviderOptionField,
  ProviderOptionsSchema,
} from './types';
import {
  ARBITRARY_SIZE_RULES,
  OPENAI_IMAGE_MODELS,
  findImageModel,
  parseSize,
  type OpenAIImageModelCapabilities,
  type OpenAIImageQuality,
} from './image-models';

/** Leading choice on every optional enum: store nothing, let the model decide. */
const MODEL_DEFAULT: ProviderOptionEnumValue = { value: '', label: '(model default)' };

const QUALITY_LABELS: Record<OpenAIImageQuality, string> = {
  auto: 'Auto — the model chooses',
  low: 'Low — fastest and cheapest',
  medium: 'Medium',
  high: 'High',
  xhigh: 'Extra High',
  max: 'Max — the finest the model offers',
  standard: 'Standard',
  hd: 'HD — finer detail',
};

const QUALITY_DESCRIPTIONS: Partial<Record<OpenAIImageQuality, string>> = {
  xhigh: 'GPT Image 2.5 only. Slower and dearer than High.',
  max: 'GPT Image 2.5 only. The slowest and most expensive tier.',
};

/**
 * Describe a concrete size for the picker: shape first, since that is what a
 * writer is actually choosing, then the pixels.
 */
function sizeLabel(size: string): string {
  if (size === 'auto') {
    return 'Auto — the model chooses the shape';
  }
  const parsed = parseSize(size);
  if (!parsed) {
    return size;
  }
  const { width, height } = parsed;
  const shape = width === height ? 'Square' : width > height ? 'Landscape' : 'Portrait';
  return `${shape} (${width}×${height})`;
}

/** Flag the resolutions OpenAI's own docs still call experimental. */
function sizeDescription(size: string): string | undefined {
  const parsed = parseSize(size);
  if (!parsed) {
    return undefined;
  }
  return parsed.width * parsed.height > ARBITRARY_SIZE_RULES.experimentalAbovePixels
    ? 'Experimental resolution — slower, and the model may decline it.'
    : undefined;
}

function qualityField(caps: OpenAIImageModelCapabilities): ProviderOptionField {
  return {
    key: 'quality',
    label: 'Quality',
    type: 'enum',
    default: '',
    helpText: caps.qualities.includes('max')
      ? 'How much effort the model spends on the image. Extra High and Max are GPT Image 2.5’s premium tiers — sharper detail, at a higher price and a longer wait.'
      : 'How much effort the model spends on the image. Higher tiers cost more and take longer.',
    enumValues: [
      MODEL_DEFAULT,
      ...caps.qualities.map(q => ({
        value: q,
        label: QUALITY_LABELS[q],
        ...(QUALITY_DESCRIPTIONS[q] ? { description: QUALITY_DESCRIPTIONS[q] } : {}),
      })),
    ],
  };
}

function sizeField(caps: OpenAIImageModelCapabilities): ProviderOptionField {
  return {
    key: 'size',
    label: 'Default Size',
    type: 'enum',
    default: '',
    helpText: caps.arbitrarySizes
      ? `Default dimensions for this profile. This model also accepts any size whose edges divide by ${ARBITRARY_SIZE_RULES.edgeMultiple}, at an aspect ratio between 1:${ARBITRARY_SIZE_RULES.maxAspect} and ${ARBITRARY_SIZE_RULES.maxAspect}:1, up to ${ARBITRARY_SIZE_RULES.maxEdge}×2160 — the list below is a selection, not the limit. Asking for a portrait or landscape image in chat overrides this.`
      : 'Default dimensions for this profile. Asking for a portrait or landscape image in chat overrides this.',
    enumValues: [
      MODEL_DEFAULT,
      ...caps.sizes.map(s => {
        const description = sizeDescription(s);
        return { value: s, label: sizeLabel(s), ...(description ? { description } : {}) };
      }),
    ],
  };
}

const STYLE_FIELD: ProviderOptionField = {
  key: 'style',
  label: 'Style',
  type: 'enum',
  default: '',
  helpText: 'DALL·E 3 only. Vivid leans dramatic and hyper-real; Natural is more restrained.',
  enumValues: [
    MODEL_DEFAULT,
    { value: 'vivid', label: 'Vivid — dramatic, hyper-real' },
    { value: 'natural', label: 'Natural — realistic, less exaggerated' },
  ],
};

const BACKGROUND_FIELD: ProviderOptionField = {
  key: 'background',
  label: 'Background',
  type: 'enum',
  default: '',
  helpText:
    'Transparent backgrounds need a PNG or WebP output format; ask for one with JPEG selected and the format is switched to PNG so the transparency survives.',
  enumValues: [
    MODEL_DEFAULT,
    { value: 'auto', label: 'Auto — the model chooses' },
    { value: 'opaque', label: 'Opaque — always a filled background' },
    { value: 'transparent', label: 'Transparent — cut-out subject' },
  ],
};

const OUTPUT_FORMAT_FIELD: ProviderOptionField = {
  key: 'output_format',
  label: 'Output Format',
  type: 'enum',
  default: '',
  helpText: 'The file format the model returns. PNG is the default and the safest for transparency.',
  enumValues: [
    MODEL_DEFAULT,
    { value: 'png', label: 'PNG — lossless, supports transparency' },
    { value: 'webp', label: 'WebP — smaller, supports transparency' },
    { value: 'jpeg', label: 'JPEG — smallest, no transparency' },
  ],
};

const OUTPUT_COMPRESSION_FIELD: ProviderOptionField = {
  key: 'output_compression',
  label: 'Output Compression',
  type: 'number',
  helpText:
    'Compression level from 0 to 100, applied only when the output format is WebP or JPEG. Higher keeps more detail; the model defaults to 100. Ignored for PNG.',
};

const MODERATION_FIELD: ProviderOptionField = {
  key: 'moderation',
  label: 'Moderation',
  type: 'enum',
  default: '',
  helpText:
    "OpenAI's own content filter for GPT Image models. Low is less restrictive; it does not disable filtering, and OpenAI's usage policies still apply.",
  enumValues: [
    MODEL_DEFAULT,
    { value: 'auto', label: 'Auto — OpenAI’s standard filtering' },
    { value: 'low', label: 'Low — less restrictive' },
  ],
};

/**
 * Build the editor schema for `modelName`.
 *
 * An unknown or unspecified model gets the widest family's schema — the GPT
 * Image 2.5 one — so the editor is never empty while the model list is still
 * loading or when a profile names a model released after this plugin shipped.
 */
export function getOpenAIImageOptionsSchema(modelName?: string): ProviderOptionsSchema {
  const caps = findImageModel(modelName) ?? OPENAI_IMAGE_MODELS[0];

  const fields: ProviderOptionField[] = [qualityField(caps), sizeField(caps)];
  if (caps.supportsStyle) {
    fields.push(STYLE_FIELD);
  }

  const groups: ProviderOptionsSchema['groups'] = [
    { title: 'Image Parameters', fields },
  ];

  if (caps.gptImage) {
    groups.push({
      title: 'GPT Image Output',
      helpText:
        'Parameters the GPT Image families accept. DALL·E models ignore this section because it is not offered for them.',
      fields: [
        BACKGROUND_FIELD,
        OUTPUT_FORMAT_FIELD,
        OUTPUT_COMPRESSION_FIELD,
        MODERATION_FIELD,
      ],
    });
  }

  return { groups };
}
