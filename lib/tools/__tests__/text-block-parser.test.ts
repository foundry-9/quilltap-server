/**
 * Text-Block Parser Tests
 */

import {
  parseTextBlockCalls,
  convertTextBlockToToolCallRequest,
  stripTextBlockMarkers,
  hasTextBlockMarkers,
  mapTextBlockToolName,
} from '../text-block-parser'

// Mock logger
jest.mock('@/lib/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}))

describe('parseTextBlockCalls', () => {
  it('parses a simple content-form block', () => {
    const response = 'Hello [[WHISPER to="Elena"]]secret message[[/WHISPER]] world'
    const results = parseTextBlockCalls(response)

    expect(results).toHaveLength(1)
    expect(results[0].toolName).toBe('WHISPER')
    expect(results[0].params).toEqual({ to: 'Elena' })
    expect(results[0].content).toBe('secret message')
    expect(results[0].fullMatch).toBe('[[WHISPER to="Elena"]]secret message[[/WHISPER]]')
  })

  it('parses a self-closing block', () => {
    const response = 'Roll dice: [[RNG type="d20" /]]'
    const results = parseTextBlockCalls(response)

    expect(results).toHaveLength(1)
    expect(results[0].toolName).toBe('RNG')
    expect(results[0].params).toEqual({ type: 'd20' })
    expect(results[0].content).toBe('')
  })

  it('parses multiple parameters', () => {
    const response = '[[RNG type="d6" count="3" /]]'
    const results = parseTextBlockCalls(response)

    expect(results).toHaveLength(1)
    expect(results[0].params).toEqual({ type: 'd6', count: '3' })
  })

  it('parses multi-line content', () => {
    const response = `[[GENERATE_IMAGE]]
a cozy coffee shop
on a rainy day
warm lighting
[[/GENERATE_IMAGE]]`
    const results = parseTextBlockCalls(response)

    expect(results).toHaveLength(1)
    expect(results[0].content).toBe('a cozy coffee shop\non a rainy day\nwarm lighting')
  })

  it('is case-insensitive for tool names', () => {
    const response = '[[whisper to="Elena"]]hello[[/whisper]]'
    const results = parseTextBlockCalls(response)

    expect(results).toHaveLength(1)
    expect(results[0].toolName).toBe('whisper')
  })

  it('parses multiple blocks in one response', () => {
    const response = `Let me search for that.
[[SEARCH_MEMORIES]]favorite food[[/SEARCH_MEMORIES]]
And also check the web.
[[SEARCH_WEB]]latest recipes[[/SEARCH_WEB]]`
    const results = parseTextBlockCalls(response)

    expect(results).toHaveLength(2)
    expect(results[0].toolName).toBe('SEARCH_MEMORIES')
    expect(results[1].toolName).toBe('SEARCH_WEB')
  })

  it('returns empty array for no matches', () => {
    const response = 'Just a normal response with no tools.'
    const results = parseTextBlockCalls(response)
    expect(results).toHaveLength(0)
  })

  it('does not match malformed tags', () => {
    // Missing closing tag
    const response1 = '[[WHISPER to="Elena"]]hello'
    expect(parseTextBlockCalls(response1)).toHaveLength(0)

    // Mismatched tag names
    const response2 = '[[WHISPER to="Elena"]]hello[[/SEARCH_WEB]]'
    expect(parseTextBlockCalls(response2)).toHaveLength(0)
  })

  it('does not false-positive on markdown brackets', () => {
    const response = 'Check out [this link](http://example.com) and [another one](http://test.com)'
    expect(parseTextBlockCalls(response)).toHaveLength(0)
  })

  it('does not false-positive on single-bracket content', () => {
    const response = '[TOOL:memory]search query[/TOOL]'
    expect(parseTextBlockCalls(response)).toHaveLength(0)
  })

  it('handles single-quoted parameter values', () => {
    const response = "[[WHISPER to='Elena']]hello[[/WHISPER]]"
    const results = parseTextBlockCalls(response)
    expect(results).toHaveLength(1)
    expect(results[0].params).toEqual({ to: 'Elena' })
  })

  it('handles content block with params', () => {
    const response = '[[SEARCH_MEMORIES limit="5"]]garden plans[[/SEARCH_MEMORIES]]'
    const results = parseTextBlockCalls(response)

    expect(results).toHaveLength(1)
    expect(results[0].params).toEqual({ limit: '5' })
    expect(results[0].content).toBe('garden plans')
  })

  it('records correct start and end indices', () => {
    const response = 'prefix [[RNG type="d20" /]] suffix'
    const results = parseTextBlockCalls(response)

    expect(results).toHaveLength(1)
    expect(results[0].startIndex).toBe(7)
    expect(results[0].endIndex).toBe(27)
    expect(response.substring(results[0].startIndex, results[0].endIndex)).toBe('[[RNG type="d20" /]]')
  })
})

describe('mapTextBlockToolName', () => {
  it('maps whisper correctly', () => {
    expect(mapTextBlockToolName('WHISPER')).toBe('whisper')
    expect(mapTextBlockToolName('whisper')).toBe('whisper')
  })

  it('maps memory aliases', () => {
    expect(mapTextBlockToolName('MEMORY')).toBe('search_memories')
    expect(mapTextBlockToolName('SEARCH_MEMORIES')).toBe('search_memories')
    expect(mapTextBlockToolName('memories')).toBe('search_memories')
  })

  it('maps image aliases', () => {
    expect(mapTextBlockToolName('IMAGE')).toBe('generate_image')
    expect(mapTextBlockToolName('GENERATE_IMAGE')).toBe('generate_image')
    expect(mapTextBlockToolName('create_image')).toBe('generate_image')
  })

  it('maps search aliases', () => {
    expect(mapTextBlockToolName('SEARCH')).toBe('search_web')
    expect(mapTextBlockToolName('SEARCH_WEB')).toBe('search_web')
    expect(mapTextBlockToolName('web_search')).toBe('search_web')
  })

  it('maps rng aliases', () => {
    expect(mapTextBlockToolName('RNG')).toBe('rng')
    expect(mapTextBlockToolName('dice')).toBe('rng')
    expect(mapTextBlockToolName('roll')).toBe('rng')
  })

  it('passes through unknown names', () => {
    expect(mapTextBlockToolName('unknown_tool')).toBe('unknown_tool')
  })
})

describe('convertTextBlockToToolCallRequest', () => {
  it('converts whisper with content as message', () => {
    const result = convertTextBlockToToolCallRequest({
      toolName: 'WHISPER',
      params: { to: 'Elena' },
      content: 'secret message',
      fullMatch: '',
      startIndex: 0,
      endIndex: 0,
    })

    expect(result.name).toBe('whisper')
    expect(result.arguments).toEqual({
      target: 'Elena',
      message: 'secret message',
    })
  })

  it('converts memory search with content as query', () => {
    const result = convertTextBlockToToolCallRequest({
      toolName: 'SEARCH_MEMORIES',
      params: { limit: '5' },
      content: 'favorite food',
      fullMatch: '',
      startIndex: 0,
      endIndex: 0,
    })

    expect(result.name).toBe('search_memories')
    expect(result.arguments.query).toBe('favorite food')
    expect(result.arguments.limit).toBe(5) // numeric conversion
  })

  it('converts image generation with content as prompt', () => {
    const result = convertTextBlockToToolCallRequest({
      toolName: 'GENERATE_IMAGE',
      params: {},
      content: 'a sunset over mountains',
      fullMatch: '',
      startIndex: 0,
      endIndex: 0,
    })

    expect(result.name).toBe('generate_image')
    expect(result.arguments.prompt).toBe('a sunset over mountains')
  })

  it('converts web search with content as query', () => {
    const result = convertTextBlockToToolCallRequest({
      toolName: 'SEARCH_WEB',
      params: {},
      content: 'latest news',
      fullMatch: '',
      startIndex: 0,
      endIndex: 0,
    })

    expect(result.name).toBe('search_web')
    expect(result.arguments.query).toBe('latest news')
  })

  it('resolves parameter aliases', () => {
    const result = convertTextBlockToToolCallRequest({
      toolName: 'WHISPER',
      params: { recipient: 'Bob', msg: 'hello' },
      content: '',
      fullMatch: '',
      startIndex: 0,
      endIndex: 0,
    })

    expect(result.name).toBe('whisper')
    expect(result.arguments.target).toBe('Bob')
    // msg alias should map to message, but content is empty so message comes from params
    expect(result.arguments.message).toBe('hello')
  })

  it('converts boolean string values', () => {
    const result = convertTextBlockToToolCallRequest({
      toolName: 'STATE',
      params: { operation: 'set', key: 'active', value: 'true' },
      content: '',
      fullMatch: '',
      startIndex: 0,
      endIndex: 0,
    })

    expect(result.arguments.value).toBe(true)
  })

  it('does not convert text params to numbers', () => {
    const result = convertTextBlockToToolCallRequest({
      toolName: 'SEARCH_WEB',
      params: {},
      content: '42',
      fullMatch: '',
      startIndex: 0,
      endIndex: 0,
    })

    // Query content should stay as string even if numeric
    expect(result.arguments.query).toBe('42')
  })

  it('content does not override explicit param', () => {
    const result = convertTextBlockToToolCallRequest({
      toolName: 'WHISPER',
      params: { to: 'Elena', message: 'from param' },
      content: 'from content',
      fullMatch: '',
      startIndex: 0,
      endIndex: 0,
    })

    // Explicit message param should win over content
    expect(result.arguments.message).toBe('from param')
  })
})

describe('stripTextBlockMarkers', () => {
  it('strips content-form blocks', () => {
    const response = 'Hello [[WHISPER to="Elena"]]secret[[/WHISPER]] world'
    expect(stripTextBlockMarkers(response)).toBe('Hello world')
  })

  it('strips self-closing blocks', () => {
    const response = 'Roll: [[RNG type="d20" /]] result'
    expect(stripTextBlockMarkers(response)).toBe('Roll: result')
  })

  it('strips multiple blocks', () => {
    const response = 'A [[SEARCH_MEMORIES]]query[[/SEARCH_MEMORIES]] B [[RNG type="d6" /]] C'
    expect(stripTextBlockMarkers(response)).toBe('A B C')
  })

  it('collapses excess whitespace', () => {
    const response = 'Before\n\n\n[[WHISPER to="x"]]msg[[/WHISPER]]\n\n\nAfter'
    const stripped = stripTextBlockMarkers(response)
    expect(stripped).not.toContain('\n\n\n')
  })

  it('returns unchanged text with no markers', () => {
    const response = 'Just normal text.'
    expect(stripTextBlockMarkers(response)).toBe('Just normal text.')
  })
})

describe('hasTextBlockMarkers', () => {
  it('returns true for content-form blocks', () => {
    expect(hasTextBlockMarkers('[[WHISPER to="Elena"]]hello[[/WHISPER]]')).toBe(true)
  })

  it('returns true for self-closing blocks', () => {
    expect(hasTextBlockMarkers('[[RNG type="d20" /]]')).toBe(true)
  })

  it('returns false for normal text', () => {
    expect(hasTextBlockMarkers('Just normal text.')).toBe(false)
  })

  it('returns false for markdown links', () => {
    expect(hasTextBlockMarkers('[click here](http://example.com)')).toBe(false)
  })

  it('returns false for pseudo-tool markers', () => {
    expect(hasTextBlockMarkers('[TOOL:memory]query[/TOOL]')).toBe(false)
  })

  it('returns true for blocks without params', () => {
    expect(hasTextBlockMarkers('[[SEARCH_MEMORIES]]food[[/SEARCH_MEMORIES]]')).toBe(true)
  })
})
