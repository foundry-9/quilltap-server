/**
 * Regression tests for bug 148 — the `generate_image` schema must not invent
 * values the model never supplied.
 *
 * `toolInputOverrides` feeds this schema's output straight into the image
 * params builder as *overrides*, and overrides outrank the profile's stored
 * defaults. So a Zod `.default()` here is not a fallback — it is a value that
 * silently beats whatever the user configured on their image profile. An
 * absent key must therefore parse to `undefined`, leaving the profile's own
 * setting to stand.
 */

import {
  imageGenerationToolInputSchema,
  validateImageGenerationInput,
} from '@/lib/tools/image-generation-tool';

describe('generate_image input schema', () => {
  it.each(['size', 'quality', 'style'])(
    'leaves %s undefined when the model does not supply it',
    key => {
      const parsed = imageGenerationToolInputSchema.parse({ prompt: 'a brass zeppelin' });
      expect(parsed[key as 'size' | 'quality' | 'style']).toBeUndefined();
      expect(parsed).not.toHaveProperty(key);
    },
  );

  it('still accepts the values it does supply', () => {
    const parsed = imageGenerationToolInputSchema.parse({
      prompt: 'a brass zeppelin',
      size: '1024x1536',
      quality: 'max',
      style: 'natural',
    });

    expect(parsed.size).toBe('1024x1536');
    expect(parsed.quality).toBe('max');
    expect(parsed.style).toBe('natural');
  });

  it('accepts every quality tier the OpenAI families offer', () => {
    for (const quality of ['auto', 'low', 'medium', 'high', 'xhigh', 'max', 'standard', 'hd']) {
      expect(validateImageGenerationInput({ prompt: 'a brass zeppelin', quality })).not.toBeNull();
    }
  });

  it('accepts the standard GPT Image sizes alongside the DALL·E 3 ones', () => {
    for (const size of ['1024x1024', '1536x1024', '1024x1536', '1792x1024', '1024x1792']) {
      expect(validateImageGenerationInput({ prompt: 'a brass zeppelin', size })).not.toBeNull();
    }
  });

  it('still rejects a tier no provider offers', () => {
    expect(
      validateImageGenerationInput({ prompt: 'a brass zeppelin', quality: 'ludicrous' }),
    ).toBeNull();
  });

  it('keeps count defaulting to a single image', () => {
    // Deliberately unlike the three above: `count` carries a cost per extra
    // image, its description promises the model a default of 1, and no OpenAI
    // profile editor exposes `n` to be overridden in the first place.
    const parsed = imageGenerationToolInputSchema.parse({ prompt: 'a brass zeppelin' });
    expect(parsed.count).toBe(1);
  });
});
