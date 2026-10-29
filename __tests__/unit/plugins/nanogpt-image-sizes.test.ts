/**
 * Bug 269 — every portrait on Qwen Image 3 Uncensored was a 400.
 *
 * The host resolves "portrait" to NanoGPT's provider-wide `832x1248`, but the
 * Qwen Image 3 family lists only resolution tiers (`1k`, `2k`) and takes its
 * shape in a separate `aspect_ratio` field, so NanoGPT answered every avatar
 * with "supports 1K and 2K output" — three times per job, since the queue
 * retries. The plugin now fits the request onto the model's own catalog entry
 * at the wire: nearest listed size, or nearest tier plus nearest listed ratio.
 */

import { fitImageShape } from '@/plugins/dist/qtap-plugin-nanogpt/image-sizes';
import { NanoGPTImageProvider } from '@/plugins/dist/qtap-plugin-nanogpt/image-provider';

jest.mock('openai', () => {
  return {
    __esModule: true,
    default: jest.fn().mockImplementation(() => ({
      images: { generate: jest.fn() },
      models: { list: jest.fn() },
    })),
  };
});

import OpenAI from 'openai';

const QWEN3 = {
  resolutions: ['1k', '2k'],
  aspect_ratio: ['1:1', '3:2', '16:9', '21:9', '9:16', '2:3', '3:4', '4:5'],
};

describe('fitImageShape', () => {
  it('maps a portrait size onto a tier model as the nearest tier plus the nearest ratio', () => {
    expect(fitImageShape(QWEN3, '832x1248', undefined)).toEqual({
      size: '1k',
      aspectRatio: '2:3',
      adjusted: true,
    });
  });

  it('maps landscape and square the same way', () => {
    expect(fitImageShape(QWEN3, '1248x832', undefined)).toMatchObject({ size: '1k', aspectRatio: '3:2' });
    expect(fitImageShape(QWEN3, '1024x1024', undefined)).toMatchObject({ size: '1k', aspectRatio: '1:1' });
  });

  it('picks the larger tier for a larger request', () => {
    expect(fitImageShape(QWEN3, '1536x2304', undefined)).toMatchObject({ size: '2k', aspectRatio: '2:3' });
  });

  it('leaves a tier the model lists alone', () => {
    expect(fitImageShape(QWEN3, '2k', undefined)).toEqual({ size: '2k', aspectRatio: undefined, adjusted: false });
  });

  it('takes the shape from aspectRatio when no size is given', () => {
    expect(fitImageShape(QWEN3, undefined, '9:16')).toMatchObject({ size: '1k', aspectRatio: '9:16' });
  });

  it('omits aspect_ratio on a tier model that lists no ratios', () => {
    expect(fitImageShape({ resolutions: ['1k', '2k'] }, '832x1248', undefined)).toEqual({
      size: '1k',
      aspectRatio: undefined,
      adjusted: true,
    });
  });

  it('snaps to the nearest listed concrete size, in the model\'s own spelling', () => {
    const catalog = { resolutions: ['1024*1024', '1280*720', '720*1280', '1536*1024', '1024*1536', 'auto'] };
    expect(fitImageShape(catalog, '832x1248', undefined)).toEqual({
      size: '1024*1536',
      aspectRatio: undefined,
      adjusted: true,
    });
  });

  it('breaks a ratio tie by area', () => {
    const catalog = { resolutions: ['512x512', '1024x1024', '2048x2048'] };
    expect(fitImageShape(catalog, '1000x1000', undefined)).toMatchObject({ size: '1024x1024' });
  });

  it('passes the request through untouched with no catalog entry or no shape', () => {
    expect(fitImageShape(undefined, '832x1248', undefined)).toEqual({
      size: '832x1248',
      aspectRatio: undefined,
      adjusted: false,
    });
    expect(fitImageShape(QWEN3, undefined, undefined)).toEqual({
      size: undefined,
      aspectRatio: undefined,
      adjusted: false,
    });
  });
});

describe('NanoGPTImageProvider.generateImage fits the posted body', () => {
  const originalFetch = global.fetch;
  let generate: jest.Mock;

  beforeEach(() => {
    generate = jest.fn().mockResolvedValue({ data: [{ b64_json: 'aGVsbG8=' }] });
    (OpenAI as unknown as jest.Mock).mockImplementation(() => ({
      images: { generate },
      models: { list: jest.fn() },
    }));
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  // Runs first, while the module's catalog cache is still cold.
  it('posts the size as asked when the catalog cannot be fetched', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 503 }) as unknown as typeof fetch;

    await new NanoGPTImageProvider().generateImage(
      { prompt: 'a lighthouse keeper', model: 'qwen-image-3-uncensored', size: '832x1248' } as never,
      'test-key',
    );

    const body = generate.mock.calls[0][0];
    expect(body.size).toBe('832x1248');
    expect(body).not.toHaveProperty('aspect_ratio');
  });

  it('fetches the catalog in a cold process and posts tier + aspect_ratio', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          {
            id: 'qwen-image-3-uncensored',
            capabilities: { image_generation: true },
            supported_parameters: QWEN3,
          },
        ],
      }),
    }) as unknown as typeof fetch;

    await new NanoGPTImageProvider().generateImage(
      { prompt: 'a lighthouse keeper', model: 'qwen-image-3-uncensored', size: '832x1248' } as never,
      'test-key',
    );

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/image-models?detailed=true'),
      expect.anything(),
    );
    const body = generate.mock.calls[0][0];
    expect(body.size).toBe('1k');
    expect(body.aspect_ratio).toBe('2:3');
  });
});

describe('NanoGPTImageProvider.generateImage retries a turned-down shape as a square', () => {
  // The catalog cache is warm with Qwen Image 3 from the block above.
  function failWith(status: number, message: string): Error {
    return Object.assign(new Error(`${status} ${message}`), { status });
  }

  function mockGenerate(...results: Array<Error | object>): jest.Mock {
    const generate = jest.fn();
    for (const result of results) {
      if (result instanceof Error) generate.mockRejectedValueOnce(result);
      else generate.mockResolvedValueOnce(result);
    }
    (OpenAI as unknown as jest.Mock).mockImplementation(() => ({
      images: { generate },
      models: { list: jest.fn() },
    }));
    return generate;
  }

  const OK = { data: [{ b64_json: 'aGVsbG8=' }] };

  it('retries an upstream 503 on a non-square tier ratio at 1:1', async () => {
    const generate = mockGenerate(failWith(503, 'Service is temporarily unavailable.'), OK);

    await new NanoGPTImageProvider().generateImage(
      { prompt: 'a lighthouse keeper', model: 'qwen-image-3-uncensored', size: '832x1248' } as never,
      'test-key',
    );

    expect(generate).toHaveBeenCalledTimes(2);
    expect(generate.mock.calls[1][0]).toMatchObject({ size: '1k', aspect_ratio: '1:1' });
  });

  it('retries a size 400 at 1024x1024 when the model has no catalog entry', async () => {
    const generate = mockGenerate(failWith(400, '"Model X supports 1K and 2K output."'), OK);

    await new NanoGPTImageProvider().generateImage(
      { prompt: 'a lighthouse keeper', model: 'uncatalogued-model', size: '832x1248' } as never,
      'test-key',
    );

    expect(generate).toHaveBeenCalledTimes(2);
    expect(generate.mock.calls[1][0].size).toBe('1024x1024');
    expect(generate.mock.calls[1][0]).not.toHaveProperty('aspect_ratio');
  });

  it('does not retry a 400 that is not about shape', async () => {
    const generate = mockGenerate(failWith(400, 'try a different prompt or image'));

    await expect(
      new NanoGPTImageProvider().generateImage(
        { prompt: 'a lighthouse keeper', model: 'uncatalogued-model', size: '832x1248' } as never,
        'test-key',
      ),
    ).rejects.toThrow('try a different prompt');
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it('does not retry a request that was already square', async () => {
    const generate = mockGenerate(failWith(503, 'Service is temporarily unavailable.'));

    await expect(
      new NanoGPTImageProvider().generateImage(
        { prompt: 'a lighthouse keeper', model: 'qwen-image-3-uncensored', size: '1024x1024' } as never,
        'test-key',
      ),
    ).rejects.toThrow('503');
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it('surfaces the retry\'s own failure when the square is turned down too', async () => {
    const generate = mockGenerate(
      failWith(503, 'Service is temporarily unavailable.'),
      failWith(503, 'still unavailable'),
    );

    await expect(
      new NanoGPTImageProvider().generateImage(
        { prompt: 'a lighthouse keeper', model: 'qwen-image-3-uncensored', size: '832x1248' } as never,
        'test-key',
      ),
    ).rejects.toThrow('still unavailable');
    expect(generate).toHaveBeenCalledTimes(2);
  });
});
