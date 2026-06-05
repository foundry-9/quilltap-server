import {
  buildInterleavedLayout,
  resolveReasoningSegments,
  readToolSeq,
  type ReasoningSegmentLike,
} from './intersperse-reasoning'
import type { Message } from './types'

let seq = 0
function tool(anchorOffset: number | undefined, toolSeq?: number): Message {
  seq += 1
  const payload: Record<string, unknown> = { toolName: 'rng', success: true, result: '17' }
  if (typeof anchorOffset === 'number') payload.anchorOffset = anchorOffset
  if (typeof toolSeq === 'number') payload.seq = toolSeq
  return {
    id: `tool${seq}`,
    role: 'TOOL',
    content: JSON.stringify(payload),
    createdAt: new Date(seq * 1000).toISOString(),
  }
}

function reasoning(anchorOffset: number, content: string, segSeq: number): ReasoningSegmentLike {
  return { anchorOffset, content, seq: segSeq }
}

describe('readToolSeq', () => {
  it('reads a finite numeric seq', () => {
    expect(readToolSeq(JSON.stringify({ seq: 3 }))).toBe(3)
    expect(readToolSeq(JSON.stringify({ seq: 0 }))).toBe(0)
  })
  it('returns undefined when absent or non-numeric', () => {
    expect(readToolSeq(JSON.stringify({ toolName: 'rng' }))).toBeUndefined()
    expect(readToolSeq(JSON.stringify({ seq: 'x' }))).toBeUndefined()
    expect(readToolSeq('not json')).toBeUndefined()
  })
})

describe('resolveReasoningSegments', () => {
  const base: Message = { id: 'm1', role: 'ASSISTANT', content: 'hi', createdAt: '2020-01-01' }

  it('prefers stored segments', () => {
    const segs = [{ anchorOffset: 0, content: 'thinking', seq: 0 }]
    expect(resolveReasoningSegments({ ...base, reasoningSegments: segs })).toEqual(segs)
  })

  it('falls back to a single offset-0 block (seq -1) from flat reasoningContent', () => {
    const out = resolveReasoningSegments({ ...base, reasoningContent: 'just thinking' })
    expect(out).toEqual([{ anchorOffset: 0, content: 'just thinking', seq: -1 }])
  })

  it('returns empty when there is no reasoning', () => {
    expect(resolveReasoningSegments(base)).toEqual([])
    expect(resolveReasoningSegments({ ...base, reasoningContent: '   ' })).toEqual([])
  })
})

describe('buildInterleavedLayout', () => {
  it('splices a single reasoning block at offset 0 before the prose', () => {
    const content = 'The answer is 42.'
    const { parts, trailingTools } = buildInterleavedLayout(content, [], [reasoning(0, 'let me think', 0)])
    expect(trailingTools).toHaveLength(0)
    expect(parts).toHaveLength(2)
    expect(parts[0]).toEqual({ kind: 'reasoning', content: 'let me think' })
    expect(parts[1]).toEqual({ kind: 'text', text: 'The answer is 42.' })
  })

  it('orders thinking → tool → thinking at the same offset by shared seq', () => {
    // Anthropic interleaved thinking: all three fired before any prose (offset 0).
    const content = 'Final prose.'
    const t = tool(0, 1)
    const parts = buildInterleavedLayout(
      content,
      [t],
      [reasoning(0, 'thinking1', 0), reasoning(0, 'thinking2', 2)],
    ).parts

    expect(parts).toEqual([
      { kind: 'reasoning', content: 'thinking1' },
      { kind: 'tools', messages: [t] },
      { kind: 'reasoning', content: 'thinking2' },
      { kind: 'text', text: 'Final prose.' },
    ])
  })

  it('splices reasoning and tools at distinct prose offsets', () => {
    const content = 'AAABBBCCC'
    const t = tool(6, 1)
    const parts = buildInterleavedLayout(content, [t], [reasoning(3, 'mid-thought', 0)]).parts
    expect(parts).toEqual([
      { kind: 'text', text: 'AAA' },
      { kind: 'reasoning', content: 'mid-thought' },
      { kind: 'text', text: 'BBB' },
      { kind: 'tools', messages: [t] },
      { kind: 'text', text: 'CCC' },
    ])
  })

  it('clamps an out-of-range reasoning offset to the end of the prose', () => {
    const content = 'short'
    const parts = buildInterleavedLayout(content, [], [reasoning(999, 'trailing thought', 0)]).parts
    expect(parts).toEqual([
      { kind: 'text', text: 'short' },
      { kind: 'reasoning', content: 'trailing thought' },
    ])
  })

  it('sends tools without a usable anchor to trailingTools (legacy fallback)', () => {
    const content = 'hello world'
    const anchored = tool(5, 0)
    const orphan = tool(undefined)
    const { parts, trailingTools } = buildInterleavedLayout(content, [anchored, orphan], [])
    expect(trailingTools).toEqual([orphan])
    expect(parts.some(p => p.kind === 'tools')).toBe(true)
  })

  it('returns a single text part when there is nothing to interleave', () => {
    const { parts, trailingTools } = buildInterleavedLayout('just prose', [], [])
    expect(parts).toEqual([{ kind: 'text', text: 'just prose' }])
    expect(trailingTools).toHaveLength(0)
  })
})
