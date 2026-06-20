import { applyCharacterFieldUpdates } from '@/components/characters/apply-character-field-updates'

describe('applyCharacterFieldUpdates', () => {
  const originalFetch = global.fetch

  afterEach(() => {
    global.fetch = originalFetch
    jest.restoreAllMocks()
  })

  function mockFetch(impl: (url: string, init?: RequestInit) => { ok: boolean; body?: unknown }) {
    const fetchMock = jest.fn(async (url: string, init?: RequestInit) => {
      const { ok, body } = impl(url, init)
      return {
        ok,
        json: async () => body ?? {},
      } as Response
    })
    global.fetch = fetchMock as unknown as typeof fetch
    return fetchMock
  }

  it('issues a per-prompt PUT and no main PUT for a system-prompt-only change', async () => {
    const fetchMock = mockFetch(() => ({ ok: true }))

    const { errors } = await applyCharacterFieldUpdates('char-1', {
      mainUpdates: {},
      promptUpdates: [{ id: 'p1', content: 'new content' }],
    })

    expect(errors).toEqual([])
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/v1/characters/char-1/prompts/p1')
    expect(init?.method).toBe('PUT')
    expect(JSON.parse(init?.body as string)).toEqual({ content: 'new content' })
  })

  it('issues both a per-prompt PUT and a main PUT for a mixed change', async () => {
    const fetchMock = mockFetch(() => ({ ok: true }))

    await applyCharacterFieldUpdates('char-1', {
      mainUpdates: { description: 'Hello {{char}}' },
      promptUpdates: [{ id: 'p1', content: 'prompt' }],
    })

    const urls = fetchMock.mock.calls.map((c) => c[0])
    expect(urls).toContain('/api/v1/characters/char-1/prompts/p1')
    expect(urls).toContain('/api/v1/characters/char-1')
    // Prompt PUT fires before the main PUT.
    expect(urls.indexOf('/api/v1/characters/char-1/prompts/p1')).toBeLessThan(
      urls.indexOf('/api/v1/characters/char-1')
    )
  })

  it('does not fire the main PUT when there are no mainUpdates', async () => {
    const fetchMock = mockFetch(() => ({ ok: true }))
    await applyCharacterFieldUpdates('char-1', { mainUpdates: {} })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('collects a failed prompt PUT into errors without throwing, using the server message', async () => {
    mockFetch((url) =>
      url.includes('/prompts/')
        ? { ok: false, body: { error: 'Prompt boom' } }
        : { ok: true }
    )

    const { errors } = await applyCharacterFieldUpdates('char-1', {
      mainUpdates: { description: 'x' },
      promptUpdates: [{ id: 'p1', content: 'prompt' }],
    })

    expect(errors).toEqual(['Prompt boom'])
  })

  it('falls back to provided message strings when the server returns none', async () => {
    mockFetch((url) => (url.includes('/prompts/') ? { ok: false } : { ok: true }))

    const { errors } = await applyCharacterFieldUpdates('char-1', {
      mainUpdates: {},
      promptUpdates: [{ id: 'p1', content: 'prompt' }],
      messages: { promptUpdateFailed: 'Custom prompt failure' },
    })

    expect(errors).toEqual(['Custom prompt failure'])
  })

  it('creates new prompts via POST', async () => {
    const fetchMock = mockFetch(() => ({ ok: true }))

    await applyCharacterFieldUpdates('char-1', {
      mainUpdates: {},
      promptCreates: [{ name: 'Refined', content: 'body' }],
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/v1/characters/char-1/prompts')
    expect(init?.method).toBe('POST')
    expect(JSON.parse(init?.body as string)).toEqual({ name: 'Refined', content: 'body' })
  })
})
