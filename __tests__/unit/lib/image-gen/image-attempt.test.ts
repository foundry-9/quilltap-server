/**
 * The logged image attempt and the provider-image decoder
 * (lib/image-gen/image-attempt.ts): one closure every picture path hands the
 * Concierge's failover, and the tail that turns `images[n]` into stored bytes.
 */

jest.mock('@/lib/llm/plugin-factory', () => ({
  createImageProvider: jest.fn(),
}))
jest.mock('@/lib/services/llm-logging.service', () => ({
  logLLMCall: jest.fn(),
}))
jest.mock('@/lib/image-gen/params-builder', () => ({
  buildImageGenParams: jest.fn(),
}))
jest.mock('@/lib/files/webp-conversion', () => ({
  convertToWebP: jest.fn(),
}))

import { decodeProviderImage, makeLoggedImageAttempt } from '@/lib/image-gen/image-attempt'
import { createImageProvider } from '@/lib/llm/plugin-factory'
import { logLLMCall } from '@/lib/services/llm-logging.service'
import { buildImageGenParams } from '@/lib/image-gen/params-builder'
import { convertToWebP } from '@/lib/files/webp-conversion'
import { sha256OfBuffer } from '@/lib/utils/sha256'
import type { ImageProfile } from '@/lib/schemas/types'

const mockCreateProvider = jest.mocked(createImageProvider)
const mockLog = jest.mocked(logLLMCall)
const mockBuild = jest.mocked(buildImageGenParams)
const mockConvert = jest.mocked(convertToWebP)

const primary = { id: 'prof-1', name: 'Primary', provider: 'OPENAI', modelName: 'gpt-image-1' } as ImageProfile
const understudy = { id: 'prof-2', name: 'Understudy', provider: 'GROK', modelName: 'grok-image' } as ImageProfile

let generateImage: jest.Mock

beforeEach(() => {
  jest.clearAllMocks()
  generateImage = jest.fn().mockResolvedValue({ images: [{ data: 'AAAA', revisedPrompt: 'a revised prompt' }] })
  mockCreateProvider.mockReturnValue({ generateImage } as never)
  mockBuild.mockImplementation((opts) => ({ params: { prompt: opts.prompt, built: opts.profile.id } } as never))
  mockLog.mockResolvedValue(null)
})

describe('makeLoggedImageAttempt', () => {
  it('builds the asked profile\'s params, calls it, and logs the answer under the given type', async () => {
    const attempt = makeLoggedImageAttempt({
      userId: 'user-1',
      logType: 'WARDROBE_ITEM_IMAGE',
      prompt: 'an opera coat',
      primaryProfileId: primary.id,
      chatId: 'chat-1',
      characterId: 'char-1',
      params: { overrides: { n: 1 }, orientation: 'portrait', logContext: { context: 'test' } },
    })

    const response = await attempt(primary, 'sk-1')

    expect(response.images[0].data).toBe('AAAA')
    expect(mockCreateProvider).toHaveBeenCalledWith('OPENAI')
    expect(mockBuild).toHaveBeenCalledWith(expect.objectContaining({
      profile: primary,
      prompt: 'an opera coat',
      orientation: 'portrait',
      overrides: { n: 1 },
      logContext: expect.objectContaining({ context: 'test', profileId: 'prof-1', rerouted: false }),
    }))
    expect(generateImage).toHaveBeenCalledWith({ prompt: 'an opera coat', built: 'prof-1' }, 'sk-1')
    expect(mockLog).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-1',
      type: 'WARDROBE_ITEM_IMAGE',
      chatId: 'chat-1',
      characterId: 'char-1',
      imageProfileId: 'prof-1',
      request: { messages: [{ role: 'user', content: 'an opera coat' }] },
      response: { content: 'a revised prompt' },
    }))
  })

  it('labels any other profile a Concierge reroute', async () => {
    generateImage.mockResolvedValue({ images: [{ data: 'AAAA' }] })
    const attempt = makeLoggedImageAttempt({
      userId: 'user-1', logType: 'IMAGE_GENERATION', prompt: 'p', primaryProfileId: primary.id,
    })

    await attempt(understudy, 'sk-2')

    expect(mockLog).toHaveBeenCalledWith(expect.objectContaining({
      imageProfileId: 'prof-2',
      response: { content: 'Generated 1 image(s) (Concierge reroute)' },
    }))
    expect(mockBuild).toHaveBeenCalledWith(expect.objectContaining({
      logContext: expect.objectContaining({ rerouted: true }),
    }))
  })

  it('reuses prebuilt params for their own profile only', async () => {
    const prebuilt = { prompt: 'p', cached: true } as never
    const attempt = makeLoggedImageAttempt({
      userId: 'user-1', logType: 'IMAGE_GENERATION', prompt: 'p', primaryProfileId: primary.id,
      prebuilt: { profileId: primary.id, params: prebuilt },
    })

    await attempt(primary, 'sk-1')
    expect(mockBuild).not.toHaveBeenCalled()
    expect(generateImage).toHaveBeenLastCalledWith(prebuilt, 'sk-1')

    await attempt(understudy, 'sk-2')
    expect(mockBuild).toHaveBeenCalledTimes(1)
  })

  it('logs a failure and rethrows it', async () => {
    generateImage.mockRejectedValue(new Error('content_policy_violation'))
    const attempt = makeLoggedImageAttempt({
      userId: 'user-1', logType: 'IMAGE_GENERATION', prompt: 'p', primaryProfileId: primary.id,
    })

    await expect(attempt(primary, 'sk-1')).rejects.toThrow('content_policy_violation')
    expect(mockLog).toHaveBeenCalledWith(expect.objectContaining({
      response: { content: '', error: 'content_policy_violation' },
    }))
  })

  it('never lets a logging failure fail the picture', async () => {
    mockLog.mockRejectedValue(new Error('llm_logs is down'))
    const attempt = makeLoggedImageAttempt({
      userId: 'user-1', logType: 'IMAGE_GENERATION', prompt: 'p', primaryProfileId: primary.id,
    })
    await expect(attempt(primary, 'sk-1')).resolves.toEqual(expect.objectContaining({ images: expect.any(Array) }))
  })
})

describe('decodeProviderImage', () => {
  it('decodes, transcodes, measures and hashes images[n]', async () => {
    const webp = Buffer.from('webp-bytes')
    mockConvert.mockResolvedValue({
      buffer: webp, mimeType: 'image/webp', filename: 'stem_1.webp', wasConverted: true, width: 832, height: 1216,
    })

    const decoded = await decodeProviderImage(
      { images: [{ data: 'ignored' }, { b64Json: Buffer.from('png').toString('base64'), mimeType: 'image/png', revisedPrompt: 'rp' }] },
      'stem',
      1,
    )

    expect(mockConvert).toHaveBeenCalledWith(Buffer.from('png'), 'image/png', expect.stringMatching(/^stem_\d+\.png$/))
    expect(decoded).toEqual({
      buffer: webp,
      mimeType: 'image/webp',
      filename: 'stem_1.webp',
      width: 832,
      height: 1216,
      sha256: sha256OfBuffer(webp),
      revisedPrompt: 'rp',
    })
  })

  it('returns null when the provider sent no inline image', async () => {
    expect(await decodeProviderImage({ images: [] }, 'stem')).toBeNull()
    expect(await decodeProviderImage({ images: [{ url: 'https://example.invalid/x.png' }] }, 'stem')).toBeNull()
    expect(await decodeProviderImage(null, 'stem')).toBeNull()
    expect(mockConvert).not.toHaveBeenCalled()
  })
})
