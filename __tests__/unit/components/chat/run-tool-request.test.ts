/**
 * run-tool-request: the one built-in tool run request, and the empty-field
 * filter both the Run Tool dialog's run and its preview use.
 */

import { runBuiltInTool, cleanArgs } from '@/components/chat/run-tool-request'
import { ApiFetchError } from '@/lib/query/fetcher'

describe('cleanArgs', () => {
  it('drops undefined, null and empty-string values and keeps everything else', () => {
    expect(cleanArgs({ a: 'x', b: '', c: null, d: undefined, e: 0, f: false, g: [] })).toEqual({
      a: 'x',
      e: 0,
      f: false,
      g: [],
    })
  })
})

describe('runBuiltInTool', () => {
  let fetchMock: jest.SpiedFunction<typeof global.fetch>

  beforeEach(() => {
    fetchMock = jest.spyOn(global, 'fetch') as jest.SpiedFunction<typeof global.fetch>
    fetchMock.mockClear()
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  function respond(body: unknown, ok = true, status = ok ? 200 : 400) {
    fetchMock.mockResolvedValueOnce({ ok, status, statusText: '', json: async () => body } as Response)
  }

  it('posts the run and resolves on success', async () => {
    respond({ success: true })
    await runBuiltInTool('chat-1', { toolName: 'rng', arguments: { sides: 6 }, characterId: 'c-1', private: true })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/v1/chats/chat-1?action=run-tool')
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({
      toolName: 'rng',
      arguments: { sides: 6 },
      characterId: 'c-1',
      private: true,
    })
  })

  it('leaves characterId out when none is chosen', async () => {
    respond({ success: true })
    await runBuiltInTool('chat-1', { toolName: 'rng', arguments: {}, characterId: null, private: false })
    const body = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body))
    expect('characterId' in body).toBe(false)
  })

  it('throws the server reason when a 2xx answer is not a success', async () => {
    respond({ success: false, error: 'No such tool' })
    await expect(
      runBuiltInTool('chat-1', { toolName: 'nope', arguments: {}, private: false }),
    ).rejects.toThrow('No such tool')
  })

  it('throws an ApiFetchError on a refusal', async () => {
    respond({ error: 'Bad input' }, false)
    await expect(
      runBuiltInTool('chat-1', { toolName: 'rng', arguments: {}, private: false }),
    ).rejects.toBeInstanceOf(ApiFetchError)
  })
})
