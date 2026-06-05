/**
 * Simple-JSON Prompt Builder Tests
 */

import {
  buildSimpleJsonToolInstructions,
  describeToolSignature,
} from '../simple-json-prompt'

jest.mock('@/lib/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}))

describe('describeToolSignature', () => {
  it('renders a simple tool with required and optional params', () => {
    const sig = describeToolSignature({
      function: {
        name: 'rng',
        parameters: {
          type: 'object',
          properties: {
            type: { type: 'string' },
            rolls: { type: 'integer' },
          },
          required: ['type'],
        },
      },
    })
    expect(sig).toBe('rng(type: string, rolls?: number)')
  })

  it('renders enum values inline', () => {
    const sig = describeToolSignature({
      function: {
        name: 'state',
        parameters: {
          type: 'object',
          properties: {
            operation: { type: 'string', enum: ['get', 'set', 'list'] },
          },
          required: ['operation'],
        },
      },
    })
    expect(sig).toBe('state(operation: "get" | "set" | "list")')
  })

  it('renders array types', () => {
    const sig = describeToolSignature({
      function: {
        name: 'foo',
        parameters: {
          type: 'object',
          properties: {
            tags: { type: 'array', items: { type: 'string' } },
          },
          required: ['tags'],
        },
      },
    })
    expect(sig).toBe('foo(tags: string[])')
  })

  it('renders oneOf as a union', () => {
    const sig = describeToolSignature({
      function: {
        name: 'rng',
        parameters: {
          type: 'object',
          properties: {
            type: {
              oneOf: [
                { type: 'integer' },
                { type: 'string', enum: ['flip_coin', 'spin_the_bottle'] },
              ],
            },
          },
          required: ['type'],
        },
      },
    })
    expect(sig).toBe('rng(type: number | "flip_coin" | "spin_the_bottle")')
  })

  it('renders zero-parameter tools', () => {
    const sig = describeToolSignature({
      function: {
        name: 'request_full_context',
        parameters: { type: 'object', properties: {}, required: [] },
      },
    })
    expect(sig).toBe('request_full_context()')
  })

  it('falls back to `unknown` for unrecognised schemas', () => {
    const sig = describeToolSignature({
      function: {
        name: 'foo',
        parameters: {
          type: 'object',
          properties: {
            // No type, no enum, no oneOf — should fall back.
            mystery: {},
          },
          required: ['mystery'],
        },
      },
    })
    expect(sig).toBe('foo(mystery: unknown)')
  })
})

describe('buildSimpleJsonToolInstructions', () => {
  it('returns empty string when no tools are enabled', () => {
    expect(buildSimpleJsonToolInstructions({ search: false })).toBe('')
  })

  it('includes search by default', () => {
    const prompt = buildSimpleJsonToolInstructions({})
    expect(prompt).toContain('## Available tools')
    expect(prompt).toContain('- search(')
  })

  it('includes only the enabled tools', () => {
    const prompt = buildSimpleJsonToolInstructions({
      search: false,
      rng: true,
      whisper: true,
    })
    expect(prompt).toContain('- rng(')
    expect(prompt).toContain('- whisper(')
    expect(prompt).not.toContain('- search(')
    expect(prompt).not.toContain('- generate_image(')
  })

  it('teaches the model the <tool_call> shape and the stop rule', () => {
    const prompt = buildSimpleJsonToolInstructions({ search: true, rng: true })
    expect(prompt).toContain('<tool_call>')
    expect(prompt).toContain('"name"')
    expect(prompt).toContain('"arguments"')
    expect(prompt).toContain('</tool_call>')
    expect(prompt).toMatch(/at most ONE/i)
    expect(prompt).toMatch(/<tool_result/)
  })

  it('renders signatures uniformly — every entry starts with `- `', () => {
    const prompt = buildSimpleJsonToolInstructions({
      search: true,
      rng: true,
      whisper: true,
      state: true,
      projectInfo: true,
    })
    // Tool-entry lines are bullets that look like `- name(...)`. Other bullet
    // points (the "Rules:" list) start with `- ` followed by prose.
    const toolLines = prompt.split('\n').filter((l) => /^- \w+\(/.test(l))
    expect(toolLines.length).toBeGreaterThanOrEqual(5)
  })
})
