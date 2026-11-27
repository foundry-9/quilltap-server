/**
 * @jest-environment node
 *
 * Unit tests for lib/llm/tool-reliability.ts — reading whether native tool
 * calls have worked on a route from its LLM log rows.
 */

import {
  classifyNativeToolOutcome,
  describeToolReliability,
  hasSpokenToolCall,
  normalizeRouteBaseUrl,
  sameRouteProfileIds,
  summarizeToolReliability,
  type NativeToolSample,
} from '@/lib/llm/tool-reliability'

jest.mock('@/lib/logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}))

jest.mock('@/lib/repositories/factory', () => ({
  getRepositories: jest.fn(),
}))

const native = (overrides: Partial<NativeToolSample> = {}): NativeToolSample => ({
  toolCount: 10,
  toolCalls: [],
  finishReason: 'stop',
  content: 'The butler coughs discreetly.',
  ...overrides,
})

describe('classifyNativeToolOutcome', () => {
  it('ignores a request that sent no native tools', () => {
    expect(classifyNativeToolOutcome(native({ toolCount: 0, finishReason: 'MALFORMED_FUNCTION_CALL' }))).toBe('none')
  })

  it('counts a parsed native call as ok', () => {
    expect(classifyNativeToolOutcome(native({ toolCalls: [{ name: 'search' }], finishReason: 'STOP' }))).toBe('ok')
  })

  it("trusts a tool-call finish reason on a row logged before calls were recorded", () => {
    expect(classifyNativeToolOutcome(native({ toolCalls: undefined, finishReason: 'tool_calls' }))).toBe('ok')
    expect(classifyNativeToolOutcome(native({ toolCalls: undefined, finishReason: 'tool_use' }))).toBe('ok')
  })

  it('counts a tool-call finish whose call nothing could parse as failed', () => {
    expect(classifyNativeToolOutcome(native({ toolCalls: [], finishReason: 'tool_calls' }))).toBe('failed')
  })

  it("counts Gemini's malformed and unexpected calls as failed", () => {
    expect(classifyNativeToolOutcome(native({ finishReason: 'MALFORMED_FUNCTION_CALL' }))).toBe('failed')
    expect(classifyNativeToolOutcome(native({ finishReason: 'UNEXPECTED_TOOL_CALL' }))).toBe('failed')
  })

  it('counts a refusal of tool calling as failed, and any other error as no evidence', () => {
    expect(classifyNativeToolOutcome(native({ error: 'This model does not support function calling' }))).toBe('failed')
    expect(classifyNativeToolOutcome(native({ error: 'HTTP 429 rate limited' }))).toBe('none')
  })

  it('counts a tool call written into the prose as failed', () => {
    expect(classifyNativeToolOutcome(native({ content: '```tool_code\nprint(default_api.search(query="x"))\n```' }))).toBe('failed')
  })

  it('counts plain prose with no call as no evidence', () => {
    expect(classifyNativeToolOutcome(native())).toBe('none')
  })
})

describe('hasSpokenToolCall', () => {
  it.each([
    '<tool_call>{"name":"search","arguments":{}}</tool_call>',
    'print(default_api.wardrobe_wear(item="hat"))',
    '[TOOL_CALLS] [{"name": "search"}]',
    'Here: {"name": "search_memories", "arguments": {"query": "tea"}}',
    '<function_call>search</function_call>',
  ])('recognises %s', text => {
    expect(hasSpokenToolCall(text)).toBe(true)
  })

  it.each([
    'She called for tea and named the butler Arguments.',
    'The {"name": "Lady Agatha"} card lay on the salver.',
    '',
  ])('leaves ordinary prose alone: %s', text => {
    expect(hasSpokenToolCall(text)).toBe(false)
  })
})

describe('summarizeToolReliability', () => {
  const ok = native({ toolCalls: [{ name: 'search' }] })
  const bad = native({ finishReason: 'MALFORMED_FUNCTION_CALL' })
  const quiet = native()

  it('calls a route unreliable when enough calls failed', () => {
    const summary = summarizeToolReliability([bad, bad, bad, ok, ok, ok, quiet])
    expect(summary).toEqual({ sampled: 7, ok: 3, failed: 3, verdict: 'unreliable' })
  })

  it('calls a route reliable when nearly every call worked', () => {
    expect(summarizeToolReliability(Array.from({ length: 10 }, () => ok)).verdict).toBe('reliable')
  })

  it('stays inconclusive below the minimum sample, whatever the share', () => {
    expect(summarizeToolReliability([bad, bad, bad, bad, quiet, quiet]).verdict).toBe('inconclusive')
  })

  it('stays inconclusive on a middling record', () => {
    expect(summarizeToolReliability([bad, ok, ok, ok, ok, ok, ok, ok]).verdict).toBe('inconclusive')
  })

  it('needs three failures before it condemns a route', () => {
    expect(summarizeToolReliability([bad, bad, ok, ok, ok]).verdict).toBe('inconclusive')
  })

  it('labels the evidence with the decisive count', () => {
    expect(describeToolReliability({ sampled: 9, ok: 2, failed: 5, verdict: 'unreliable' }))
      .toBe('observed in your last 7 native tool calls on this route (5 failed)')
  })
})

describe('sameRouteProfileIds', () => {
  it('matches provider, model and base URL, folding trailing slashes and empty URLs', () => {
    const profiles = [
      { id: 'a', provider: 'GOOGLE', modelName: 'gemini-2.5-pro', baseUrl: null },
      { id: 'b', provider: 'GOOGLE', modelName: 'gemini-2.5-pro', baseUrl: '' },
      { id: 'c', provider: 'GOOGLE', modelName: 'gemini-2.5-flash', baseUrl: null },
      { id: 'd', provider: 'NANOGPT', modelName: 'gemini-2.5-pro', baseUrl: null },
      { id: 'e', provider: 'OPENAI_COMPATIBLE', modelName: 'm', baseUrl: 'https://Host.test/v1/' },
    ]
    expect(sameRouteProfileIds(profiles, { provider: 'GOOGLE', modelName: 'gemini-2.5-pro' })).toEqual(['a', 'b'])
    expect(sameRouteProfileIds(profiles, { provider: 'OPENAI_COMPATIBLE', modelName: 'm', baseUrl: 'https://host.test/v1' })).toEqual(['e'])
    expect(normalizeRouteBaseUrl('  https://x.test/  ')).toBe('https://x.test')
  })
})
