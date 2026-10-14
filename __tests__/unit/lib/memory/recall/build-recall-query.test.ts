/**
 * `buildRecallQuery` — the first recall stage: the turn's text, its signals
 * and its ONE embedding (plus a retrospective turn's probes), never thrown.
 */

jest.mock('@/lib/embedding/embedding-service', () => ({
  generateEmbeddingForUser: jest.fn(),
}))
jest.mock('@/lib/memory/cheap-llm-tasks/core-execution', () => ({
  executeCheapLLMTask: jest.fn(),
}))
jest.mock('@/lib/memory/time/calendar-refresh', () => ({
  refreshMemoryTimeZone: jest.fn(async () => 'UTC'),
}))

import { buildRecallQuery, recallQueryText } from '@/lib/memory/recall/query'
import { generateEmbeddingForUser } from '@/lib/embedding/embedding-service'
import { executeCheapLLMTask } from '@/lib/memory/cheap-llm-tasks/core-execution'
import type { RecallTrace } from '@/lib/memory/recall/types'

const mockEmbed = generateEmbeddingForUser as jest.Mock
const mockTask = executeCheapLLMTask as jest.Mock

const vector = (n: number) => ({ embedding: new Float32Array([n, 0, 0]), provider: 'OPENAI', model: 'm', dimensions: 3 })

beforeEach(() => {
  jest.clearAllMocks()
  mockEmbed.mockImplementation(async (text: string) => vector(text.length))
})

describe('recallQueryText', () => {
  it('prefers the paraphrase, then the keywords, then the fallback text', () => {
    expect(recallQueryText({ keywords: ['a', 'b'], paraphrase: 'They argue.' }, 'window')).toBe('They argue.')
    expect(recallQueryText({ keywords: ['a', 'b'] }, 'window')).toBe('a b')
    expect(recallQueryText({ keywords: [] }, 'window')).toBe('window')
    expect(recallQueryText(null, 'window')).toBe('window')
  })
})

describe('buildRecallQuery', () => {
  it('embeds an ordinary turn exactly once', async () => {
    const trace: RecallTrace = []
    const query = await buildRecallQuery({ userId: 'u1', text: 'the recent window', signals: { keywords: ['x'], paraphrase: 'They talk of the fair.' } }, trace)
    expect(mockEmbed).toHaveBeenCalledTimes(1)
    expect(mockEmbed).toHaveBeenCalledWith('They talk of the fair.', 'u1', undefined)
    expect(query.text).toBe('They talk of the fair.')
    expect(query.embedding).not.toBeNull()
    expect(query.probes).toEqual([])
    expect(trace).toEqual([expect.objectContaining({ stage: 'query', detail: expect.objectContaining({ embeddingCalls: 1, distilled: 'given' }) })])
  })

  it('embeds a retrospective turn’s probes beside the query, once each', async () => {
    const query = await buildRecallQuery({
      userId: 'u1',
      text: 'w',
      signals: {
        keywords: ['fair'],
        paraphrase: 'They remember the fair.',
        retrospective: true,
        timeRange: { from: '2026-06-01T00:00:00.000Z', to: '2026-06-07T23:59:59.999Z' },
        entities: ['Lighthouse Point'],
      },
    })
    expect(query.retrospective).toBe(true)
    expect(query.anchors).toEqual(['Lighthouse Point'])
    expect(query.window).toEqual({ from: '2026-06-01T00:00:00.000Z', to: '2026-06-07T23:59:59.999Z' })
    expect(query.probes.map(p => p.text)).toEqual([
      'Lighthouse Point',
      'They remember the fair. (around 2026-06-01 to 2026-06-07)',
    ])
    expect(mockEmbed).toHaveBeenCalledTimes(3)
  })

  it('keeps the text and leaves the embedding null when the provider fails', async () => {
    mockEmbed.mockRejectedValueOnce(new Error('provider down'))
    const query = await buildRecallQuery({ userId: 'u1', text: 'the window' })
    expect(query.text).toBe('the window')
    expect(query.embedding).toBeNull()
    expect(query.embeddingError).toBe('provider down')
  })

  it('reuses a memo so a text is embedded once across calls', async () => {
    const memo = new Map()
    await buildRecallQuery({ userId: 'u1', text: 'same words', embeddingMemo: memo })
    await buildRecallQuery({ userId: 'u1', text: 'same words', embeddingMemo: memo })
    expect(mockEmbed).toHaveBeenCalledTimes(1)
  })

  it('distils when asked and falls back to the given text when distillation fails', async () => {
    mockTask.mockResolvedValueOnce({ success: false, error: 'nope' })
    const trace: RecallTrace = []
    const query = await buildRecallQuery({
      userId: 'u1',
      text: 'the recent window',
      distill: { messages: [{ role: 'user', content: 'hi' }], characterName: 'Friday', selection: {} as never },
    }, trace)
    expect(mockTask).toHaveBeenCalledTimes(1)
    expect(query.text).toBe('the recent window')
    expect(trace[0].detail.distilled).toBe('failed')
  })

  it('embeds nothing for an empty query', async () => {
    const query = await buildRecallQuery({ userId: 'u1', text: '   ' })
    expect(query.text).toBe('')
    expect(query.embedding).toBeNull()
    expect(mockEmbed).not.toHaveBeenCalled()
  })
})
