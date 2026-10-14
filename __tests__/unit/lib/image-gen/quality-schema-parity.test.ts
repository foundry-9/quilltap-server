/**
 * Every schema that validates an image quality tier must validate the same set.
 *
 * Caught in review of the GPT Image 2.5 change: the new tiers reached the
 * `generate_image` tool schema while the two HTTP generate schemas still read
 * `z.enum(['standard','hd'])`, so a profile could store `max` and
 * `POST /api/v1/images?action=generate` would reject it before the provider
 * ever saw it. All three now share `imageQualitySchema`; these tests pin that
 * they still agree, and that the union covers every tier a provider offers.
 */

import { IMAGE_QUALITY_VALUES, imageQualitySchema } from '@/lib/image-gen/quality';
import { imageGenerationToolInputSchema } from '@/lib/tools/image-generation-tool';
import { OPENAI_IMAGE_MODELS } from '@/plugins/dist/qtap-plugin-openai/image-models';

/** Pull the `quality` enum out of a Zod object schema's shape. */
function qualityOptionsOf(schema: { shape: Record<string, unknown> }): string[] {
  const field = schema.shape.quality as { options?: string[]; unwrap?: () => unknown };
  // The field is optional (and sometimes described), so unwrap until the enum.
  let node: unknown = field;
  for (let i = 0; i < 5; i += 1) {
    const candidate = node as { options?: string[]; unwrap?: () => unknown };
    if (Array.isArray(candidate?.options)) {
      return candidate.options;
    }
    if (typeof candidate?.unwrap !== 'function') break;
    node = candidate.unwrap();
  }
  throw new Error('could not find the quality enum options');
}

describe('image quality schema parity', () => {
  it('accepts every tier and rejects anything else', () => {
    for (const tier of IMAGE_QUALITY_VALUES) {
      expect(imageQualitySchema.safeParse(tier).success).toBe(true);
    }
    expect(imageQualitySchema.safeParse('ludicrous').success).toBe(false);
    expect(imageQualitySchema.safeParse('').success).toBe(false);
  });

  it('includes the GPT Image 2.5 premium tiers the routes used to reject', () => {
    for (const tier of ['auto', 'low', 'medium', 'high', 'xhigh', 'max']) {
      expect(imageQualitySchema.safeParse(tier).success).toBe(true);
    }
  });

  it('keeps the DALL-E spelling working', () => {
    expect(imageQualitySchema.safeParse('standard').success).toBe(true);
    expect(imageQualitySchema.safeParse('hd').success).toBe(true);
  });

  it('the generate_image tool schema validates the same set', () => {
    expect(qualityOptionsOf(imageGenerationToolInputSchema as never).sort()).toEqual(
      [...IMAGE_QUALITY_VALUES].sort(),
    );
  });

  it('covers every tier the OpenAI capability table declares', () => {
    const declared = new Set(OPENAI_IMAGE_MODELS.flatMap(m => m.qualities));
    for (const tier of declared) {
      expect(imageQualitySchema.safeParse(tier).success).toBe(true);
    }
    // And nothing in the shared union is a tier no model offers.
    expect([...declared].sort()).toEqual([...IMAGE_QUALITY_VALUES].sort());
  });
});
