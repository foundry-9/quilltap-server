import { buildInterspersedToolLayout, readToolAnchorOffset } from './intersperse-tool-messages'
import type { Message } from './types'

let seq = 0
function tool(anchorOffset: number | undefined, extra: Record<string, unknown> = {}): Message {
  seq += 1
  const payload: Record<string, unknown> = { toolName: 'rng', success: true, result: '17', ...extra }
  if (typeof anchorOffset === 'number') payload.anchorOffset = anchorOffset
  return {
    id: `tool${seq}`,
    role: 'TOOL',
    content: JSON.stringify(payload),
    createdAt: new Date(seq * 1000).toISOString(),
  }
}

describe('readToolAnchorOffset', () => {
  it('reads a finite numeric anchorOffset', () => {
    expect(readToolAnchorOffset(JSON.stringify({ anchorOffset: 12 }))).toBe(12)
    expect(readToolAnchorOffset(JSON.stringify({ anchorOffset: 0 }))).toBe(0)
  })

  it('returns undefined for missing, non-numeric, or non-finite offsets', () => {
    expect(readToolAnchorOffset(JSON.stringify({ toolName: 'rng' }))).toBeUndefined()
    expect(readToolAnchorOffset(JSON.stringify({ anchorOffset: 'x' }))).toBeUndefined()
    expect(readToolAnchorOffset(JSON.stringify({ anchorOffset: null }))).toBeUndefined()
    expect(readToolAnchorOffset('not json')).toBeUndefined()
  })
})

describe('buildInterspersedToolLayout', () => {
  it('splits prose at the anchor and places the tool block between', () => {
    const content = 'Before the call.After the call.'
    const splitAt = 'Before the call.'.length
    const { parts, trailingTools } = buildInterspersedToolLayout(content, [tool(splitAt)])

    expect(trailingTools).toHaveLength(0)
    expect(parts).toHaveLength(3)
    expect(parts[0]).toEqual({ kind: 'text', text: 'Before the call.' })
    expect(parts[1].kind).toBe('tools')
    expect(parts[2]).toEqual({ kind: 'text', text: 'After the call.' })
  })

  it('stacks multiple calls sharing an offset in original order', () => {
    const content = 'one two'
    const at = 'one'.length
    const a = tool(at)
    const b = tool(at)
    const { parts } = buildInterspersedToolLayout(content, [a, b])

    const toolParts = parts.filter(p => p.kind === 'tools')
    expect(toolParts).toHaveLength(1)
    expect((toolParts[0] as { messages: Message[] }).messages.map(m => m.id)).toEqual([a.id, b.id])
  })

  it('orders interspersed calls by offset, not array order', () => {
    const content = 'AAABBBCCC'
    const late = tool(6)
    const early = tool(3)
    const { parts } = buildInterspersedToolLayout(content, [late, early])

    // text "AAA", tools(early), text "BBB", tools(late), text "CCC"
    expect(parts.map(p => (p.kind === 'text' ? p.text : 'TOOLS'))).toEqual([
      'AAA', 'TOOLS', 'BBB', 'TOOLS', 'CCC',
    ])
    expect((parts[1] as { messages: Message[] }).messages[0].id).toBe(early.id)
    expect((parts[3] as { messages: Message[] }).messages[0].id).toBe(late.id)
  })

  it('renders a tool at offset 0 before any prose (no leading empty text part)', () => {
    const content = 'all after'
    const { parts } = buildInterspersedToolLayout(content, [tool(0)])

    expect(parts[0].kind).toBe('tools')
    expect(parts[1]).toEqual({ kind: 'text', text: 'all after' })
  })

  it('routes calls with no usable anchor to trailingTools and keeps the prose whole', () => {
    const content = 'untouched prose'
    const noAnchor = tool(undefined)
    const { parts, trailingTools } = buildInterspersedToolLayout(content, [noAnchor])

    expect(parts).toEqual([{ kind: 'text', text: 'untouched prose' }])
    expect(trailingTools.map(m => m.id)).toEqual([noAnchor.id])
  })

  it('routes out-of-range offsets to trailingTools', () => {
    const content = 'short'
    const past = tool(999)
    const negative = tool(-1)
    const { parts, trailingTools } = buildInterspersedToolLayout(content, [past, negative])

    expect(parts).toEqual([{ kind: 'text', text: 'short' }])
    expect(trailingTools.map(m => m.id)).toEqual([past.id, negative.id])
  })

  it('mixes anchored and unanchored calls', () => {
    const content = 'Hello world'
    const anchored = tool('Hello'.length)
    const unanchored = tool(undefined)
    const { parts, trailingTools } = buildInterspersedToolLayout(content, [anchored, unanchored])

    expect(parts.map(p => (p.kind === 'text' ? p.text : 'TOOLS'))).toEqual(['Hello', 'TOOLS', ' world'])
    expect(trailingTools.map(m => m.id)).toEqual([unanchored.id])
  })

  it('drops whitespace-only segments produced by adjacent anchors', () => {
    const content = 'abcdef'
    // Two calls at the same boundary plus one at the very end.
    const { parts } = buildInterspersedToolLayout(content, [tool(3), tool(6)])

    // text "abc", tools, text "def", tools(at end, no trailing text part)
    expect(parts.map(p => (p.kind === 'text' ? p.text : 'TOOLS'))).toEqual(['abc', 'TOOLS', 'def', 'TOOLS'])
  })
})
