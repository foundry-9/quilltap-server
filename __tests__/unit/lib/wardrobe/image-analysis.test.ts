/**
 * Tests for the wardrobe-from-image vision prompt and its response parser.
 *
 * The parser is private, so it's driven end-to-end through
 * `analyzeImageForWardrobeItems` with the LLM provider mocked out — no
 * network, no vision model.
 */

import { beforeEach, describe, expect, it, jest } from '@jest/globals'

jest.mock('@/lib/logger', () => {
  const makeLogger = (): any => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    child: jest.fn(() => makeLogger()),
  })
  return { logger: makeLogger() }
})

const mockSendMessage = jest.fn()
jest.mock('@/lib/llm', () => ({
  createLLMProvider: jest.fn(async () => ({
    sendMessage: (...args: unknown[]) => mockSendMessage(...args),
  })),
}))

jest.mock('@/lib/llm/connection-profile-utils', () => ({
  profileSupportsMimeType: jest.fn(() => true),
}))

jest.mock('@/lib/services/llm-logging.service', () => ({
  logLLMCall: jest.fn(() => Promise.resolve()),
}))

jest.mock('@/lib/llm/cheap-llm', () => ({
  profileParams: jest.fn(() => ({})),
}))

const mockShrink = jest.fn(async (args: { buffer: Buffer; mimeType: string }) => ({
  buffer: args.buffer,
  mimeType: args.mimeType,
  wasShrunk: false,
  originalSize: args.buffer.length,
  finalSize: args.buffer.length,
}))
jest.mock('@/lib/files/llm-image-budget', () => ({
  shrinkImageForLlmTransport: (...args: unknown[]) => mockShrink(...(args as [never])),
}))

const { analyzeImageForWardrobeItems } = require('@/lib/wardrobe/image-analysis') as {
  analyzeImageForWardrobeItems: typeof import('@/lib/wardrobe/image-analysis').analyzeImageForWardrobeItems
}

const PROFILE = {
  id: 'p1',
  provider: 'ANTHROPIC',
  modelName: 'claude-opus-5',
  apiKeyId: 'k1',
  baseUrl: null,
  isDefault: true,
}

const repos = {
  chatSettings: {
    findByUserId: jest.fn(async (): Promise<unknown> => null),
  },
  connections: {
    findById: jest.fn(async (): Promise<unknown> => null),
    findByUserId: jest.fn(async () => [PROFILE]),
    findApiKeyByIdAndUserId: jest.fn(async () => ({ key_value: 'sk-test' })),
  },
}

/** Run the real parser over a canned model answer. */
async function analyze(items: unknown): Promise<{ types: string[]; title: string }[]> {
  mockSendMessage.mockResolvedValue({ content: JSON.stringify({ items }) })
  const result = await analyzeImageForWardrobeItems(
    { image: 'AAAA', mimeType: 'image/png' },
    repos as never,
    'user-1',
  )
  return result.proposedItems as { types: string[]; title: string }[]
}

describe('wardrobe image analysis — the hair slot', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('keeps an item the model typed as "hair"', async () => {
    const items = await analyze([
      { title: 'Coiled Chignon', description: 'Low twisted knot, jet pins', types: ['hair'] },
    ])
    expect(items).toHaveLength(1)
    expect(items[0].types).toEqual(['hair'])
  })

  it('still defaults a genuinely unknown type to accessories', async () => {
    const items = await analyze([
      { title: 'Mystery Thing', description: 'Unclear', types: ['cloak'] },
    ])
    expect(items[0].types).toEqual(['accessories'])
  })

  it('sends a system prompt that names hair as a slot and rules out unstyled hair', async () => {
    await analyze([])
    const [request] = mockSendMessage.mock.calls[0] as [{ messages: { role: string; content: string }[] }]
    const system = request.messages.find((m) => m.role === 'system')!.content
    expect(system).toContain('"hair"')
    expect(system).toContain('Plain, loose, unstyled hair is NOT an item.')
    expect(system).toContain('- Valid types are ONLY: "top", "bottom", "footwear", "accessories", "hair"')
  })

  it('asks the user prompt for a deliberate hairstyle', async () => {
    await analyze([])
    const [request] = mockSendMessage.mock.calls[0] as [{ messages: { role: string; content: string }[] }]
    const user = request.messages.find((m) => m.role === 'user')!.content
    expect(user).toContain('deliberate hairstyle')
  })
})

describe('wardrobe image analysis — the proposed outfit', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  const TWO_ITEMS = [
    { title: 'Velvet Blazer', description: 'Deep green', types: ['top'] },
    { title: 'Oxford Brogues', description: 'Oxblood', types: ['footwear'] },
  ]

  async function analyzeRaw(payload: unknown) {
    mockSendMessage.mockResolvedValue({ content: JSON.stringify(payload) })
    return analyzeImageForWardrobeItems({ image: 'AAAA', mimeType: 'image/png' }, repos, 'user-1')
  }

  it('returns the named ensemble alongside the items', async () => {
    const result = await analyzeRaw({
      items: TWO_ITEMS,
      outfit: { title: '  Club Night Ensemble ', description: 'Sharp.', appropriateness: 'evening' },
    })
    expect(result.proposedItems).toHaveLength(2)
    expect(result.proposedOutfit).toEqual({
      title: 'Club Night Ensemble',
      description: 'Sharp.',
      appropriateness: 'evening',
    })
  })

  it('drops an outfit with no title rather than failing the analysis', async () => {
    const result = await analyzeRaw({ items: TWO_ITEMS, outfit: { description: 'Nameless' } })
    expect(result.proposedItems).toHaveLength(2)
    expect(result.proposedOutfit).toBeNull()
  })

  it('treats a missing outfit as none', async () => {
    const result = await analyzeRaw({ items: TWO_ITEMS })
    expect(result.proposedOutfit).toBeNull()
  })

  it('offers no outfit for a single piece', async () => {
    const result = await analyzeRaw({
      items: [TWO_ITEMS[0]],
      outfit: { title: 'Just a Blazer' },
    })
    expect(result.proposedOutfit).toBeNull()
  })

  it('asks the model to name the ensemble', async () => {
    await analyzeRaw({ items: [] })
    const [request] = mockSendMessage.mock.calls[0] as [{ messages: { role: string; content: string }[] }]
    const system = request.messages.find((m) => m.role === 'system')!.content
    expect(system).toContain('"outfit": {')
    expect(system).toContain('set "outfit" to null')
  })
})

describe('wardrobe image analysis — the shared vision path (bug 197)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    repos.chatSettings.findByUserId.mockResolvedValue(null)
    repos.connections.findById.mockResolvedValue(null)
  })

  it('sends the bytes shrunk for transport, not the upload', async () => {
    mockShrink.mockResolvedValueOnce({
      buffer: Buffer.from('small'),
      mimeType: 'image/webp',
      wasShrunk: true,
      originalSize: 3,
      finalSize: 5,
    })
    mockSendMessage.mockResolvedValue({
      content: JSON.stringify({ items: [{ title: 'Hat', description: 'A hat', types: ['accessories'] }] }),
      usage: { promptTokens: 2000, completionTokens: 50, totalTokens: 2050 },
    })
    await analyzeImageForWardrobeItems({ image: 'AAAA', mimeType: 'image/png' }, repos as never, 'user-1')

    expect(mockShrink).toHaveBeenCalledWith(expect.objectContaining({ mimeType: 'image/png', provider: 'ANTHROPIC' }))
    const [request] = mockSendMessage.mock.calls[0] as [{ messages: { role: string; attachments?: { data: string; mimeType: string }[] }[] }]
    const attachment = request.messages.find((m) => m.role === 'user')!.attachments![0]
    expect(attachment.mimeType).toBe('image/webp')
    expect(attachment.data).toBe(Buffer.from('small').toString('base64'))
  })

  it('refuses an answer the model gave without the image', async () => {
    // Billed for the text alone: the gateway dropped the picture (bug 116).
    mockSendMessage.mockResolvedValue({
      content: JSON.stringify({ items: [{ title: 'Invented Gown', description: 'x', types: ['top'] }] }),
      usage: { promptTokens: 40, completionTokens: 300, totalTokens: 340 },
    })
    await expect(
      analyzeImageForWardrobeItems({ image: 'AAAA', mimeType: 'image/png' }, repos as never, 'user-1'),
    ).rejects.toThrow(/without seeing the image/)
  })

  it('passes over a configured profile that cannot receive images', async () => {
    const textOnly = { ...PROFILE, id: 'p-text', provider: 'OLLAMA', modelName: 'llama3' }
    repos.chatSettings.findByUserId.mockResolvedValue({ imageDescriptionProfileId: 'p-text' })
    repos.connections.findById.mockResolvedValue(textOnly)
    mockSendMessage.mockResolvedValue({ content: JSON.stringify({ items: [] }) })

    const result = await analyzeImageForWardrobeItems(
      { image: 'AAAA', mimeType: 'image/png' },
      repos as never,
      'user-1',
    )
    expect(result.provider).toBe('ANTHROPIC')
  })
})
