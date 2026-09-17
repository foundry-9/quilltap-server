/**
 * What the OpenAI image provider actually puts on the wire.
 *
 * The Images API rejects a whole request over one parameter the selected model
 * does not know, so the provider's job is to send each family exactly what it
 * accepts: GPT Image 2.5's `xhigh`/`max` tiers and arbitrary resolutions, the
 * GPT Image output controls, DALL·E 3's `style`, and nothing else. These tests
 * pin that per-family behaviour.
 */

import { OpenAIImageProvider } from '@/plugins/dist/qtap-plugin-openai/image-provider';
import type { ImageGenParams } from '@quilltap/plugin-types';

jest.mock('openai', () => ({
  __esModule: true,
  default: jest.fn(),
}));

import OpenAI from 'openai';

/** One generated image, enough for the provider to map a response. */
const OK_RESPONSE = { data: [{ b64_json: 'aGVsbG8=', revised_prompt: 'a revised prompt' }] };

/**
 * Run one generation and hand back the request body the SDK was called with,
 * alongside the provider's mapped response.
 */
async function generate(params: Partial<ImageGenParams>) {
  const generateMock = jest.fn().mockResolvedValue(OK_RESPONSE);
  (OpenAI as unknown as jest.Mock).mockImplementation(() => ({
    images: { generate: generateMock },
    models: { list: jest.fn() },
  }));

  const provider = new OpenAIImageProvider();
  const response = await provider.generateImage(
    { prompt: 'a gentleman in a brass diving suit', ...params } as ImageGenParams,
    'test-api-key',
  );

  expect(generateMock).toHaveBeenCalledTimes(1);
  return { request: generateMock.mock.calls[0][0], response };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('model catalogue', () => {
  it('advertises both GPT Image 2.5 models', () => {
    const provider = new OpenAIImageProvider();
    expect(provider.supportedModels).toEqual(
      expect.arrayContaining(['gpt-image-2.5-sunburst', 'gpt-image-2.5-flare']),
    );
  });
});

describe('quality tiers', () => {
  it.each(['gpt-image-2.5-sunburst', 'gpt-image-2.5-flare'])(
    '%s accepts the premium xhigh and max tiers',
    async model => {
      const { request } = await generate({ model, quality: 'xhigh' });
      expect(request.quality).toBe('xhigh');

      const max = await generate({ model, quality: 'max' });
      expect(max.request.quality).toBe('max');
    },
  );

  it('resolves a dated 2.5 snapshot to its family, premium tiers included', async () => {
    const { request } = await generate({
      model: 'gpt-image-2.5-flare-2026-09-08',
      quality: 'max',
    });
    expect(request.quality).toBe('max');
  });

  it('drops xhigh on gpt-image-2, which does not offer it', async () => {
    const { request } = await generate({ model: 'gpt-image-2', quality: 'xhigh' });
    expect(request.quality).toBeUndefined();
  });

  it('drops hd on a GPT Image model rather than sending DALL·E spelling', async () => {
    const { request } = await generate({ model: 'gpt-image-1.5', quality: 'hd' });
    expect(request.quality).toBeUndefined();
  });

  it('omits quality entirely for GPT Image when the profile sets none', async () => {
    const { request } = await generate({ model: 'gpt-image-2.5-sunburst' });
    expect(request).not.toHaveProperty('quality');
  });

  it('keeps DALL·E 3 on its own tiers, defaulting to standard', async () => {
    const hd = await generate({ model: 'dall-e-3', quality: 'hd' });
    expect(hd.request.quality).toBe('hd');

    const unset = await generate({ model: 'dall-e-3' });
    expect(unset.request.quality).toBe('standard');

    const bogus = await generate({ model: 'dall-e-3', quality: 'max' });
    expect(bogus.request.quality).toBe('standard');
  });
});

describe('size handling', () => {
  it('forwards an arbitrary resolution the 2.5 models accept', async () => {
    const { request } = await generate({ model: 'gpt-image-2.5-sunburst', size: '1536x864' });
    expect(request.size).toBe('1536x864');
  });

  it('forwards the maximum documented resolution', async () => {
    const { request } = await generate({ model: 'gpt-image-2.5-flare', size: '3840x2160' });
    expect(request.size).toBe('3840x2160');
  });

  it.each([
    ['1000x1000', 'edges not divisible by 16'],
    ['3200x800', 'aspect ratio beyond 3:1'],
    ['3856x2160', 'edge beyond the maximum'],
    ['3840x3840', 'pixel budget exceeded'],
  ])('falls back to 1024x1024 for %s (%s)', async size => {
    const { request } = await generate({ model: 'gpt-image-2.5-sunburst', size });
    expect(request.size).toBe('1024x1024');
  });

  it('rejects an arbitrary size on gpt-image-1.5, which takes only the standard three', async () => {
    const { request } = await generate({ model: 'gpt-image-1.5', size: '1536x864' });
    expect(request.size).toBe('1024x1024');
  });

  it('keeps the standard sizes on every GPT Image family', async () => {
    const { request } = await generate({ model: 'gpt-image-1', size: '1024x1536' });
    expect(request.size).toBe('1024x1536');
  });

  it('keeps DALL·E 3 on its own size list', async () => {
    const ok = await generate({ model: 'dall-e-3', size: '1792x1024' });
    expect(ok.request.size).toBe('1792x1024');

    const wrong = await generate({ model: 'dall-e-3', size: '1536x1024' });
    expect(wrong.request.size).toBe('1024x1024');
  });
});

describe('GPT Image output controls', () => {
  it('forwards background, output format, compression and moderation', async () => {
    const { request } = await generate({
      model: 'gpt-image-2.5-sunburst',
      profileParameters: {
        background: 'transparent',
        output_format: 'webp',
        output_compression: 80,
        moderation: 'low',
      },
    });

    expect(request.background).toBe('transparent');
    expect(request.output_format).toBe('webp');
    expect(request.output_compression).toBe(80);
    expect(request.moderation).toBe('low');
  });

  it('forces PNG when a transparent background is asked for alongside JPEG', async () => {
    const { request, response } = await generate({
      model: 'gpt-image-2.5-flare',
      profileParameters: { background: 'transparent', output_format: 'jpeg' },
    });

    expect(request.background).toBe('transparent');
    expect(request.output_format).toBe('png');
    expect(response.images[0].mimeType).toBe('image/png');
  });

  it('drops output_compression for PNG, which does not take it', async () => {
    const { request } = await generate({
      model: 'gpt-image-2.5-sunburst',
      profileParameters: { output_format: 'png', output_compression: 50 },
    });
    expect(request).not.toHaveProperty('output_compression');
  });

  it('drops values outside the accepted sets rather than sending a 400', async () => {
    const { request } = await generate({
      model: 'gpt-image-2.5-sunburst',
      profileParameters: {
        background: 'chartreuse',
        output_format: 'tiff',
        output_compression: 300,
        moderation: 'off',
      },
    });

    expect(request).not.toHaveProperty('background');
    expect(request).not.toHaveProperty('output_format');
    expect(request).not.toHaveProperty('output_compression');
    expect(request).not.toHaveProperty('moderation');
  });

  it('never sends the GPT Image controls to a DALL·E model', async () => {
    const { request } = await generate({
      model: 'dall-e-3',
      profileParameters: { background: 'transparent', output_format: 'webp', moderation: 'low' },
    });

    expect(request).not.toHaveProperty('background');
    expect(request).not.toHaveProperty('output_format');
    expect(request).not.toHaveProperty('moderation');
  });

  it('reports the MIME type the requested format will actually return', async () => {
    const webp = await generate({
      model: 'gpt-image-2',
      profileParameters: { output_format: 'webp' },
    });
    expect(webp.response.images[0].mimeType).toBe('image/webp');

    const jpeg = await generate({
      model: 'gpt-image-2',
      profileParameters: { output_format: 'jpeg' },
    });
    expect(jpeg.response.images[0].mimeType).toBe('image/jpeg');

    const unset = await generate({ model: 'gpt-image-2' });
    expect(unset.response.images[0].mimeType).toBe('image/png');
  });
});

describe('family-specific parameters', () => {
  it('sends style only for DALL·E 3', async () => {
    const dalle3 = await generate({ model: 'dall-e-3' });
    expect(dalle3.request.style).toBe('vivid');

    const dalle2 = await generate({ model: 'dall-e-2' });
    expect(dalle2.request).not.toHaveProperty('style');

    const gptImage = await generate({ model: 'gpt-image-2.5-sunburst', style: 'natural' });
    expect(gptImage.request).not.toHaveProperty('style');
  });

  it('asks DALL·E for base64 but never sends response_format to GPT Image', async () => {
    const dalle = await generate({ model: 'dall-e-3' });
    expect(dalle.request.response_format).toBe('b64_json');

    const gptImage = await generate({ model: 'gpt-image-2.5-sunburst' });
    expect(gptImage.request).not.toHaveProperty('response_format');
  });

  it('caps the image count at the model maximum', async () => {
    const dalle3 = await generate({ model: 'dall-e-3', n: 4 });
    expect(dalle3.request.n).toBe(1);

    const sunburst = await generate({ model: 'gpt-image-2.5-sunburst', n: 4 });
    expect(sunburst.request.n).toBe(4);
  });

  it('forwards an unrecognised model untouched rather than guessing its limits', async () => {
    const { request } = await generate({
      model: 'gpt-image-3-supernova',
      size: '4096x4096',
      quality: 'ludicrous',
    });

    expect(request.size).toBe('4096x4096');
    expect(request.quality).toBe('ludicrous');
  });
});
