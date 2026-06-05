/**
 * Simple-JSON Parser Tests
 */

import {
  parseSimpleJsonCalls,
  convertSimpleJsonToToolCallRequest,
  stripSimpleJsonMarkers,
  hasSimpleJsonMarkers,
  mapSimpleJsonToolName,
  escapeXmlAttribute,
  SIMPLE_JSON_STOP_SEQUENCES,
} from '../simple-json-parser'

jest.mock('@/lib/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}))

describe('hasSimpleJsonMarkers', () => {
  it('detects canonical <tool_call> tag', () => {
    expect(hasSimpleJsonMarkers('<tool_call>{}</tool_call>')).toBe(true)
  })

  it('detects each accepted alias', () => {
    expect(hasSimpleJsonMarkers('prose <toolcall>{}</toolcall>')).toBe(true)
    expect(hasSimpleJsonMarkers('<tool>{}</tool>')).toBe(true)
    expect(hasSimpleJsonMarkers('<call>{}</call>')).toBe(true)
    expect(hasSimpleJsonMarkers('<function_call>{}</function_call>')).toBe(true)
  })

  it('is case-insensitive', () => {
    expect(hasSimpleJsonMarkers('<TOOL_CALL>{}</TOOL_CALL>')).toBe(true)
  })

  it('returns false on plain prose', () => {
    expect(hasSimpleJsonMarkers('just some prose')).toBe(false)
    expect(hasSimpleJsonMarkers('')).toBe(false)
  })

  it('does not false-positive on similar substrings', () => {
    expect(hasSimpleJsonMarkers('<tools>{}</tools>')).toBe(false)
    expect(hasSimpleJsonMarkers('mention of tool_call without tags')).toBe(false)
  })
})

describe('parseSimpleJsonCalls — strict tier', () => {
  it('parses a clean canonical call', () => {
    const response = '<tool_call>{"name":"search","arguments":{"query":"x"}}</tool_call>'
    const results = parseSimpleJsonCalls(response)

    expect(results).toHaveLength(1)
    expect(results[0].toolName).toBe('search')
    expect(results[0].arguments).toEqual({ query: 'x' })
    expect(results[0].parserTier).toBe('strict')
  })

  it('tolerates whitespace and newlines between tags and JSON', () => {
    const response = `<tool_call>
{"name": "search", "arguments": {"query": "x"}}
</tool_call>`
    const results = parseSimpleJsonCalls(response)

    expect(results).toHaveLength(1)
    expect(results[0].parserTier).toBe('strict')
  })

  it('parses prose before the tool call', () => {
    const response = 'Let me look that up.\n\n<tool_call>{"name":"search","arguments":{"query":"x"}}</tool_call>'
    const results = parseSimpleJsonCalls(response)

    expect(results).toHaveLength(1)
    expect(results[0].toolName).toBe('search')
  })

  it('takes only the first block when multiple are emitted', () => {
    const response =
      '<tool_call>{"name":"search","arguments":{"query":"a"}}</tool_call>' +
      '<tool_call>{"name":"rng","arguments":{"type":"d20"}}</tool_call>'
    const results = parseSimpleJsonCalls(response)

    expect(results).toHaveLength(1)
    expect(results[0].toolName).toBe('search')
  })

  it('handles arguments-less calls', () => {
    const response = '<tool_call>{"name":"request_full_context","arguments":{}}</tool_call>'
    const results = parseSimpleJsonCalls(response)

    expect(results).toHaveLength(1)
    expect(results[0].arguments).toEqual({})
  })

  it('tolerates unknown top-level keys', () => {
    const response = '<tool_call>{"name":"rng","arguments":{"type":"d6"},"extra":"ignored"}</tool_call>'
    const results = parseSimpleJsonCalls(response)

    expect(results).toHaveLength(1)
    expect(results[0].toolName).toBe('rng')
    expect(results[0].arguments).toEqual({ type: 'd6' })
  })
})

describe('parseSimpleJsonCalls — alias tags', () => {
  it.each([
    ['<toolcall>', '</toolcall>'],
    ['<tool>', '</tool>'],
    ['<call>', '</call>'],
    ['<function_call>', '</function_call>'],
  ])('parses block with %s ... %s', (open, close) => {
    const response = `${open}{"name":"rng","arguments":{"type":"d20"}}${close}`
    const results = parseSimpleJsonCalls(response)

    expect(results).toHaveLength(1)
    expect(results[0].toolName).toBe('rng')
  })
})

describe('parseSimpleJsonCalls — repaired tier', () => {
  it('handles single quotes via jsonrepair', () => {
    const response = "<tool_call>{'name':'search','arguments':{'query':'x'}}</tool_call>"
    const results = parseSimpleJsonCalls(response)

    expect(results).toHaveLength(1)
    expect(results[0].toolName).toBe('search')
    expect(results[0].arguments).toEqual({ query: 'x' })
    expect(results[0].parserTier).toBe('repaired')
  })

  it('handles trailing commas', () => {
    const response = '<tool_call>{"name":"search","arguments":{"query":"x",},}</tool_call>'
    const results = parseSimpleJsonCalls(response)

    expect(results).toHaveLength(1)
    expect(results[0].parserTier).toBe('repaired')
  })

  it('handles unquoted keys', () => {
    const response = '<tool_call>{name:"search",arguments:{query:"x"}}</tool_call>'
    const results = parseSimpleJsonCalls(response)

    expect(results).toHaveLength(1)
    expect(results[0].parserTier).toBe('repaired')
    expect(results[0].arguments).toEqual({ query: 'x' })
  })

  it('handles smart quotes', () => {
    const response = '<tool_call>{“name”:“search”,“arguments”:{“query”:“x”}}</tool_call>'
    const results = parseSimpleJsonCalls(response)

    expect(results).toHaveLength(1)
    expect(results[0].parserTier).toBe('repaired')
  })
})

describe('parseSimpleJsonCalls — brace tier', () => {
  it('parses when the closing tag is missing but body is well-formed (tier 1 via $-anchor)', () => {
    const response = '<tool_call>{"name":"search","arguments":{"query":"x"}}'
    const results = parseSimpleJsonCalls(response)

    expect(results).toHaveLength(1)
    expect(results[0].toolName).toBe('search')
    // Regex captures to end-of-string and strict parse succeeds.
    expect(results[0].parserTier).toBe('strict')
  })

  it('recovers via tier 3 when closing tag is missing and prose bled past the JSON', () => {
    const response = '<tool_call>{"name":"search","arguments":{"query":"x"}} and then some trailing prose'
    const results = parseSimpleJsonCalls(response)

    expect(results).toHaveLength(1)
    expect(results[0].toolName).toBe('search')
    // Tier 1 fails (body is `{...} and then some...` — not valid JSON), tier 2
    // jsonrepair can't recover, tier 3 finds the balanced object.
    expect(results[0].parserTier).toBe('brace')
  })

  it('handles nested objects in arguments under brace walk', () => {
    const response = '<tool_call>{"name":"foo","arguments":{"a":{"b":{"c":1}}}}'
    const results = parseSimpleJsonCalls(response)

    expect(results).toHaveLength(1)
    expect(results[0].arguments).toEqual({ a: { b: { c: 1 } } })
  })

  it('respects string literals when walking braces', () => {
    const response = '<tool_call>{"name":"foo","arguments":{"msg":"} not a closer "}}</tool_call>'
    const results = parseSimpleJsonCalls(response)

    expect(results).toHaveLength(1)
    expect(results[0].arguments).toEqual({ msg: '} not a closer ' })
  })
})

describe('parseSimpleJsonCalls — failure modes', () => {
  it('returns empty array when no markers are present', () => {
    expect(parseSimpleJsonCalls('plain prose only')).toEqual([])
    expect(parseSimpleJsonCalls('')).toEqual([])
  })

  it('returns empty array when JSON is malformed beyond repair', () => {
    const response = '<tool_call>this is not json at all and never will be</tool_call>'
    expect(parseSimpleJsonCalls(response)).toEqual([])
  })

  it('returns empty array when `name` is missing', () => {
    const response = '<tool_call>{"arguments":{"query":"x"}}</tool_call>'
    expect(parseSimpleJsonCalls(response)).toEqual([])
  })

  it('returns empty array when `name` is non-string', () => {
    const response = '<tool_call>{"name":42,"arguments":{}}</tool_call>'
    expect(parseSimpleJsonCalls(response)).toEqual([])
  })

  it('defaults arguments to {} when not provided', () => {
    const response = '<tool_call>{"name":"request_full_context"}</tool_call>'
    const results = parseSimpleJsonCalls(response)

    expect(results).toHaveLength(1)
    expect(results[0].arguments).toEqual({})
  })

  it('defaults arguments to {} when arguments is non-object', () => {
    const response = '<tool_call>{"name":"foo","arguments":"bar"}</tool_call>'
    const results = parseSimpleJsonCalls(response)

    expect(results).toHaveLength(1)
    expect(results[0].arguments).toEqual({})
  })

  it('survives a JSON inside a code fence the model added unprompted', () => {
    // Note: the strict tier will fail because the body starts with ``` —
    // jsonrepair handles this in tier 2 for many but not all shapes. This
    // test exercises that fallback path; the result may be tier 'repaired'
    // or 'brace' depending on jsonrepair's heuristics.
    const response = '<tool_call>\n```json\n{"name":"search","arguments":{"query":"x"}}\n```\n</tool_call>'
    const results = parseSimpleJsonCalls(response)

    if (results.length > 0) {
      expect(results[0].toolName).toBe('search')
      expect(['repaired', 'brace']).toContain(results[0].parserTier)
    }
    // If jsonrepair can't recover, we accept that — a `warn` is logged and
    // the response degrades to prose. The test asserts only that we don't
    // crash.
  })
})

describe('convertSimpleJsonToToolCallRequest', () => {
  it('passes through the canonical name unchanged', () => {
    const parsed = {
      toolName: 'search',
      arguments: { query: 'x' },
      fullMatch: '',
      startIndex: 0,
      endIndex: 0,
      parserTier: 'strict' as const,
    }
    expect(convertSimpleJsonToToolCallRequest(parsed)).toEqual({
      name: 'search',
      arguments: { query: 'x' },
    })
  })

  it('maps aliases to canonical names', () => {
    const parsed = {
      toolName: 'dice',
      arguments: { type: 'd20' },
      fullMatch: '',
      startIndex: 0,
      endIndex: 0,
      parserTier: 'strict' as const,
    }
    expect(convertSimpleJsonToToolCallRequest(parsed).name).toBe('rng')
  })
})

describe('mapSimpleJsonToolName', () => {
  it('passes canonical names through', () => {
    expect(mapSimpleJsonToolName('search')).toBe('search')
    expect(mapSimpleJsonToolName('rng')).toBe('rng')
  })

  it('maps known aliases', () => {
    expect(mapSimpleJsonToolName('dice')).toBe('rng')
    expect(mapSimpleJsonToolName('memory')).toBe('search')
    expect(mapSimpleJsonToolName('navigate')).toBe('help_navigate')
  })

  it('returns the input lowercased for unknown names', () => {
    expect(mapSimpleJsonToolName('UNKNOWN_TOOL')).toBe('unknown_tool')
  })
})

describe('stripSimpleJsonMarkers', () => {
  it('removes a well-formed block', () => {
    const response = 'before <tool_call>{"name":"search","arguments":{}}</tool_call> after'
    expect(stripSimpleJsonMarkers(response)).toBe('before  after')
  })

  it('removes blocks under each alias', () => {
    expect(stripSimpleJsonMarkers('a <toolcall>{}</toolcall> b')).toBe('a  b')
    expect(stripSimpleJsonMarkers('a <function_call>{}</function_call> b')).toBe('a  b')
  })

  it('is idempotent', () => {
    const stripped = stripSimpleJsonMarkers('before <tool_call>{"name":"x"}</tool_call> after')
    expect(stripSimpleJsonMarkers(stripped)).toBe(stripped)
  })

  it('removes a dangling opening tag with balanced object', () => {
    const response = 'prose <tool_call>{"name":"search","arguments":{"query":"x"}} trailing'
    const stripped = stripSimpleJsonMarkers(response)
    expect(stripped).not.toContain('<tool_call>')
    expect(stripped).not.toContain('{"name"')
    expect(stripped).toContain('prose')
    expect(stripped).toContain('trailing')
  })

  it('collapses excess blank lines', () => {
    const response = 'a\n\n\n\n<tool_call>{}</tool_call>\n\n\nb'
    expect(stripSimpleJsonMarkers(response)).toBe('a\n\n\n\nb'.replace(/\n{3,}/g, '\n\n'))
  })

  it('returns the input unchanged when no markers', () => {
    expect(stripSimpleJsonMarkers('plain prose')).toBe('plain prose')
  })
})

describe('escapeXmlAttribute', () => {
  it('escapes quotes, angles, and ampersands', () => {
    expect(escapeXmlAttribute('a"b<c>d&e\'f')).toBe('a&quot;b&lt;c&gt;d&amp;e&apos;f')
  })

  it('leaves plain text alone', () => {
    expect(escapeXmlAttribute('search')).toBe('search')
  })
})

describe('SIMPLE_JSON_STOP_SEQUENCES', () => {
  it('exports the canonical stop sequence', () => {
    expect(SIMPLE_JSON_STOP_SEQUENCES).toEqual(['</tool_call>'])
  })
})
