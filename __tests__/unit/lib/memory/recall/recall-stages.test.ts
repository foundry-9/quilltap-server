/**
 * The pure recall stages, table by table: `score` (floor, window staging,
 * ranking), `select` (expansion, the cut) and `deliver`'s survival rule.
 */

import { score } from '@/lib/memory/recall/score'
import { select } from '@/lib/memory/recall/select'
import { survivingLines, ringFromDebugLog, withRecallLines, RECALL_RING_PREFIX } from '@/lib/memory/recall/deliver'
import type { HydratedHit } from '@/lib/memory/recall/types'
import type { RecallContext } from '@/lib/memory/recall/tags'
import type { Memory } from '@/lib/schemas/types'

const NOW = Date.parse('2026-09-10T12:00:00.000Z')
const DAY = 86_400_000

function row(id: string, over: Partial<Memory> = {}): Memory {
  return {
    id,
    characterId: 'char-1',
    content: `content ${id}`,
    summary: `summary ${id}`,
    keywords: [],
    tags: [],
    importance: 0.5,
    reinforcedImportance: 0.5,
    aboutCharacterId: null,
    chatId: null,
    projectId: null,
    source: 'AUTO',
    relatedMemoryIds: [],
    occurredAt: null,
    createdAt: new Date(NOW - 10 * DAY).toISOString(),
    updatedAt: new Date(NOW - 10 * DAY).toISOString(),
    ...over,
  } as Memory
}

const hit = (m: Memory, cosine: number): HydratedHit => ({ memory: m, rawScore: cosine, score: cosine, usedEmbedding: true })

const ctx = (over: Partial<RecallContext> = {}): RecallContext => ({
  currentProjectId: null,
  scopePolicy: 'down-weight',
  expandRelated: true,
  ...over,
})

const vector = { strategy: 'vector' as const, minScore: 0.3, provider: 'OPENAI' }
const text = { strategy: 'text' as const, minScore: 0, provider: null }

describe('score', () => {
  it.each([
    ['vector: the floor drops what sits under it', vector, [0.29, 0.3, 0.6], ['c0.6', 'c0.3']],
    ['text: only a zero score is dropped', text, [0, 0.01, 0.5], ['c0.5', 'c0.01']],
  ])('%s', (_label, gathered, cosines, expected) => {
    const scored = score(cosines.map(c => hit(row(`c${c}`), c)), gathered, { limit: 10, window: null, nowMs: NOW })
    expect(scored.ranked.map(r => r.memory.id)).toEqual(expected)
  })

  const window = { from: new Date(NOW - 5 * DAY).toISOString(), to: new Date(NOW - 1 * DAY).toISOString() }
  const inside = (id: string) => row(id, { occurredAt: new Date(NOW - 3 * DAY).toISOString() })
  const pool = () => [hit(inside('in-1'), 0.5), hit(inside('in-2'), 0.45), hit(row('out-1'), 0.7)]

  it.each([
    ['no context: a plain filter', undefined, 10, 'filter', ['in-1', 'in-2']],
    ['enough hits: hard', ctx(), 2, 'hard', ['in-1', 'in-2']],
    // The soft boost lands, but R1 fades it below the best match's gate.
    ['too few hits: the soft boost over the whole pool', ctx(), 3, 'soft', ['out-1', 'in-1', 'in-2']],
  ] as const)('the window — %s', (_label, recallContext, limit, mode, expected) => {
    const scored = score(pool(), vector, { limit, window, nowMs: NOW, recallContext: recallContext as RecallContext | undefined })
    expect(scored.windowMode).toBe(mode)
    expect(scored.ranked.map(r => r.memory.id)).toEqual(expected)
    if (mode === 'hard') expect(scored.outOfWindow.map(c => c.memory.id)).toEqual(['out-1'])
    if (mode === 'soft') expect(scored.ranked.find(r => r.memory.id === 'in-1')?.recallAdjustment?.fired).toContain('window↑')
  })

  it('turns the R1 gate off for a text score', () => {
    const scored = score([hit(row('a'), 0.2)], text, { limit: 5, window: null, nowMs: NOW, recallContext: ctx() })
    expect(scored.context?.tuning?.boostGate).toBeNull()
  })

  it('measures salience on the clock it is given', () => {
    const fresh = row('fresh', { createdAt: new Date(NOW).toISOString() })
    const scored = score([hit(fresh, 0.5)], vector, { limit: 5, window: null, nowMs: NOW })
    expect(scored.ranked[0].salience).toBeCloseTo(0.5, 9)
  })

  it('drops a cross-project narrow row under the exclude policy', () => {
    const narrow = row('narrow', { projectId: 'p2', keywords: ['scope: narrow'] })
    const scored = score([hit(narrow, 0.6), hit(row('wide'), 0.5)], vector, {
      limit: 5, window: null, nowMs: NOW, recallContext: ctx({ currentProjectId: 'p1', scopePolicy: 'exclude' }),
    })
    expect(scored.ranked.map(r => r.memory.id)).toEqual(['wide'])
  })
})

describe('select', () => {
  const q = new Float32Array([1, 0])
  it('merges a low-cosine neighbour by association, labelled, past the floor', () => {
    const seed = row('seed', { relatedMemoryIds: ['nb'] })
    const scored = score([hit(seed, 0.6)], vector, { limit: 5, window: null, nowMs: NOW, recallContext: ctx() })
    const neighbour = row('nb', { embedding: new Float32Array([0.1, 0.995]) } as Partial<Memory>)
    const out = select(scored, [neighbour], { limit: 5, queryEmbedding: q, nowMs: NOW })
    expect(out.map(r => r.memory.id)).toEqual(['seed', 'nb'])
    expect(out[1].recallAdjustment?.fired).toContain('related↗')
    expect(out[1].score).toBeLessThan(0.3)
  })

  it('never expands a text search', () => {
    const scored = score([hit(row('seed', { relatedMemoryIds: ['nb'] }), 0.6)], text, { limit: 5, window: null, nowMs: NOW, recallContext: ctx() })
    const out = select(scored, [row('nb', { embedding: new Float32Array([1, 0]) } as Partial<Memory>)], { limit: 5, queryEmbedding: q, nowMs: NOW })
    expect(out.map(r => r.memory.id)).toEqual(['seed'])
  })

  it('cuts at the limit, and records the cut', () => {
    const trace: never[] = []
    const scored = score([0.9, 0.8, 0.7, 0.6].map((c, i) => hit(row(`m${i}`), c)), vector, { limit: 2, window: null, nowMs: NOW })
    const out = select(scored, [], { limit: 2, queryEmbedding: q, nowMs: NOW }, trace)
    expect(out.map(r => r.memory.id)).toEqual(['m0', 'm1'])
    expect(trace).toEqual([expect.objectContaining({ stage: 'select', detail: expect.objectContaining({ cut: 2, returned: 2 }) })])
  })
})

describe('deliver — which lines reached the model', () => {
  const line = (memoryId: string, body: string) => ({ memoryId, line: `- ${body}`, body })
  const lines = [
    line('a', 'Lyra crossed the Shivering Bridge with Iris at dusk'),
    line('b', 'Iris hums when she is nervous'),
    line('c', 'The ledger is kept in the brass cabinet'),
  ]

  it.each([
    ['verbatim (no compression)', lines.map(l => l.line).join('\n'), false, ['a', 'b', 'c']],
    ['whitespace and case aside', '- LYRA crossed   the Shivering Bridge with Iris at dusk', false, ['a']],
    [
      'a compression rewrite keeps most of a line’s words',
      '- Crossed the Shivering Bridge with Iris (dusk).\n- Ledger: brass cabinet.',
      true,
      ['a', 'c'],
    ],
    ['a line compression dropped is not delivered', '- Iris hums when she is nervous', true, ['b']],
    ['nothing delivered', '', true, []],
    // An uncompressed section counts verbatim lines only: a body that turns up
    // inside some other text says nothing about its own line (review of PR 95).
    ['another text that happens to hold the words', 'Iris hums when she is nervous, Lyra noted.', false, []],
  ] as const)('%s', (_label, delivered, compressed, expected) => {
    expect(survivingLines(lines, delivered, { compressed }).map(l => l.memoryId)).toEqual(expected)
  })

  it('reads the ring line back, and keeps the recall record beside new lines', () => {
    const log = ['[Recall] deliver: head 2', `${RECALL_RING_PREFIX} m1 m2`]
    expect(ringFromDebugLog(log)).toEqual(['m1', 'm2'])
    expect(ringFromDebugLog([`${RECALL_RING_PREFIX}`])).toEqual([])
    expect(ringFromDebugLog(['[Memory] other'])).toBeNull()
    expect(withRecallLines([...log, '[Memory] stale'], ['[Memory] fresh'])).toEqual([...log, '[Memory] fresh'])
  })
})
