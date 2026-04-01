
import { GrokImageProvider } from '@/plugins/dist/qtap-plugin-grok/image-provider';

// Mock OpenAI
jest.mock('openai', () => {
  return {
    __esModule: true,
    default: jest.fn().mockImplementation(() => ({
      images: {
        generate: jest.fn(),
      },
      models: {
        list: jest.fn(),
      },
    })),
  };
});

import OpenAI from 'openai';

function getMockClient() {
  const MockOpenAI = OpenAI as jest.MockedClass<typeof OpenAI>;
  return MockOpenAI.mock.results[MockOpenAI.mock.results.length - 1]?.value;
}

describe('GrokImageProvider', () => {
  let provider: GrokImageProvider;
  const mockApiKey = 'test-api-key';

  beforeEach(() => {
    provider = new GrokImageProvider();
    jest.clearAllMocks();
  });

  describe('supportedModels', () => {
    it('should include grok-imagine-image, grok-imagine-image-pro, and legacy grok-2-image', () => {
      expect(provider.supportedModels).toEqual([
        'grok-imagine-image',
        'grok-imagine-image-pro',
        'grok-2-image',
      ]);
    });
  });

  describe('generateImage', () => {
    it('should default to grok-imagine-image when no model specified', async () => {
      const mockResponse = {
        data: [{ b64_json: 'base64data', revised_prompt: 'revised' }],
      };

      const mockClient = { images: { generate: jest.fn().mockResolvedValue(mockResponse) }, models: { list: jest.fn() } };
      (OpenAI as unknown as jest.Mock).mockImplementation(() => mockClient);

      await provider.generateImage({ prompt: 'test prompt' }, mockApiKey);

      expect(mockClient.images.generate).toHaveBeenCalledWith(
        expect.objectContaining({ model: 'grok-imagine-image' })
      );
    });

    it('should handle grok-imagine-image model with b64_json response', async () => {
      const mockResponse = {
        data: [{ b64_json: 'base64encodedimage', revised_prompt: 'revised prompt' }],
      };

      const mockClient = { images: { generate: jest.fn().mockResolvedValue(mockResponse) }, models: { list: jest.fn() } };
      (OpenAI as unknown as jest.Mock).mockImplementation(() => mockClient);

      const result = await provider.generateImage(
        { prompt: 'test prompt', model: 'grok-imagine-image' },
        mockApiKey
      );

      expect(result.images).toHaveLength(1);
      expect(result.images[0].data).toBe('base64encodedimage');
      expect(result.images[0].revisedPrompt).toBe('revised prompt');
    });

    it('should set resolution to 2k for grok-imagine-image-pro', async () => {
      const mockResponse = {
        data: [{ b64_json: 'base64data' }],
      };

      const mockClient = { images: { generate: jest.fn().mockResolvedValue(mockResponse) }, models: { list: jest.fn() } };
      (OpenAI as unknown as jest.Mock).mockImplementation(() => mockClient);

      await provider.generateImage(
        { prompt: 'test prompt', model: 'grok-imagine-image-pro' },
        mockApiKey
      );

      expect(mockClient.images.generate).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'grok-imagine-image-pro',
          resolution: '2k',
        })
      );
    });

    it('should not set resolution for standard grok-imagine-image', async () => {
      const mockResponse = {
        data: [{ b64_json: 'base64data' }],
      };

      const mockClient = { images: { generate: jest.fn().mockResolvedValue(mockResponse) }, models: { list: jest.fn() } };
      (OpenAI as unknown as jest.Mock).mockImplementation(() => mockClient);

      await provider.generateImage(
        { prompt: 'test prompt', model: 'grok-imagine-image' },
        mockApiKey
      );

      const callArgs = mockClient.images.generate.mock.calls[0][0];
      expect(callArgs.resolution).toBeUndefined();
    });

    it('should not set resolution for legacy grok-2-image', async () => {
      const mockResponse = {
        data: [{ b64_json: 'base64data' }],
      };

      const mockClient = { images: { generate: jest.fn().mockResolvedValue(mockResponse) }, models: { list: jest.fn() } };
      (OpenAI as unknown as jest.Mock).mockImplementation(() => mockClient);

      await provider.generateImage(
        { prompt: 'test prompt', model: 'grok-2-image' },
        mockApiKey
      );

      const callArgs = mockClient.images.generate.mock.calls[0][0];
      expect(callArgs.resolution).toBeUndefined();
    });

    it('should pass aspect_ratio when provided', async () => {
      const mockResponse = {
        data: [{ b64_json: 'base64data' }],
      };

      const mockClient = { images: { generate: jest.fn().mockResolvedValue(mockResponse) }, models: { list: jest.fn() } };
      (OpenAI as unknown as jest.Mock).mockImplementation(() => mockClient);

      await provider.generateImage(
        { prompt: 'test prompt', model: 'grok-imagine-image', aspectRatio: '16:9' },
        mockApiKey
      );

      expect(mockClient.images.generate).toHaveBeenCalledWith(
        expect.objectContaining({ aspect_ratio: '16:9' })
      );
    });

    it('should throw error if API returns invalid response', async () => {
      const mockClient = { images: { generate: jest.fn().mockResolvedValue({}) }, models: { list: jest.fn() } };
      (OpenAI as unknown as jest.Mock).mockImplementation(() => mockClient);

      await expect(
        provider.generateImage({ prompt: 'test prompt', model: 'grok-imagine-image' }, mockApiKey)
      ).rejects.toThrow('Invalid response from Grok Images API');
    });

    it('should throw error if no API key provided', async () => {
      await expect(
        provider.generateImage({ prompt: 'test prompt', model: 'grok-imagine-image' }, '')
      ).rejects.toThrow('Grok provider requires an API key');
    });

    it('should fall back to url when b64_json is missing', async () => {
      const mockResponse = {
        data: [{ url: 'https://example.com/image.jpg', revised_prompt: 'revised' }],
      };

      const mockClient = { images: { generate: jest.fn().mockResolvedValue(mockResponse) }, models: { list: jest.fn() } };
      (OpenAI as unknown as jest.Mock).mockImplementation(() => mockClient);

      const result = await provider.generateImage(
        { prompt: 'test prompt', model: 'grok-imagine-image' },
        mockApiKey
      );

      expect(result.images[0].data).toBe('https://example.com/image.jpg');
    });
  });

  describe('getAvailableModels', () => {
    it('should return all supported models', async () => {
      const models = await provider.getAvailableModels();
      expect(models).toEqual(['grok-imagine-image', 'grok-imagine-image-pro', 'grok-2-image']);
    });
  });
});
