import {
  parseXMLToolCalls,
  convertXMLToToolCallRequest,
  stripXMLToolMarkers,
  hasXMLToolMarkers,
  mapXMLToolName,
  ParsedXMLTool,
} from '@/lib/tools/xml-tool-parser'

describe('XML Tool Parser', () => {
  describe('parseXMLToolCalls', () => {
    it('parses DeepSeek format with string attribute', () => {
      const response = `
I'll search for that information.

<function_calls>
<invoke name="search_memories">
<parameter name="query" string="true">Laura and Elizabeth wedding night</parameter>
<parameter name="limit" string="false">5</parameter>
</invoke>
</function_calls>

Let me find that for you.
`
      const parsed = parseXMLToolCalls(response)
      expect(parsed).toHaveLength(1)
      expect(parsed[0].toolName).toBe('search_memories')
      expect(parsed[0].arguments).toEqual({
        query: 'Laura and Elizabeth wedding night',
        limit: 5,
      })
      expect(parsed[0].format).toBe('deepseek')
    })

    it('parses Claude format with content value', () => {
      const response = `
<function_calls>
<invoke name="generate_image">
<parameter name="prompt">a sunset over mountains with a lake in the foreground</parameter>
</invoke>
</function_calls>
`
      const parsed = parseXMLToolCalls(response)
      expect(parsed).toHaveLength(1)
      expect(parsed[0].toolName).toBe('generate_image')
      expect(parsed[0].arguments).toEqual({
        prompt: 'a sunset over mountains with a lake in the foreground',
      })
      expect(parsed[0].format).toBe('claude')
    })

    it('parses generic <tool_call> format', () => {
      const response = `
<tool_call>
<name>search_web</name>
<arguments>
<query>latest AI news 2024</query>
</arguments>
</tool_call>
`
      const parsed = parseXMLToolCalls(response)
      expect(parsed).toHaveLength(1)
      expect(parsed[0].toolName).toBe('search_web')
      expect(parsed[0].arguments).toEqual({
        query: 'latest AI news 2024',
      })
      expect(parsed[0].format).toBe('generic')
    })

    it('parses <function_call> format with name attribute', () => {
      const response = `
<function_call name="search_memories">
<param name="query">user preferences</param>
</function_call>
`
      const parsed = parseXMLToolCalls(response)
      expect(parsed).toHaveLength(1)
      expect(parsed[0].toolName).toBe('search_memories')
      expect(parsed[0].arguments).toEqual({
        query: 'user preferences',
      })
      expect(parsed[0].format).toBe('function_call')
    })

    it('handles multiple tool calls in one response', () => {
      const response = `
Let me do a few things for you.

<function_calls>
<invoke name="search_memories">
<parameter name="query">favorite color</parameter>
</invoke>
</function_calls>

And also:

<function_calls>
<invoke name="generate_image">
<parameter name="prompt">a beautiful landscape</parameter>
</invoke>
</function_calls>
`
      const parsed = parseXMLToolCalls(response)
      expect(parsed).toHaveLength(2)
      expect(parsed[0].toolName).toBe('search_memories')
      expect(parsed[1].toolName).toBe('generate_image')
    })

    it('handles multiple invokes within one function_calls block', () => {
      const response = `
<function_calls>
<invoke name="search_memories">
<parameter name="query">first meeting</parameter>
</invoke>
<invoke name="search_memories">
<parameter name="query">favorite restaurant</parameter>
</invoke>
</function_calls>
`
      const parsed = parseXMLToolCalls(response)
      expect(parsed).toHaveLength(2)
      expect(parsed[0].arguments.query).toBe('first meeting')
      expect(parsed[1].arguments.query).toBe('favorite restaurant')
    })

    it('handles mixed text and XML content', () => {
      const response = `
Sure, I can help with that! Let me search for some information first.

<function_calls>
<invoke name="search_memories">
<parameter name="query">vacation plans</parameter>
</invoke>
</function_calls>

Once I have that information, I'll be able to give you a better answer.
`
      const parsed = parseXMLToolCalls(response)
      expect(parsed).toHaveLength(1)
      expect(parsed[0].toolName).toBe('search_memories')
    })

    it('returns empty array for no XML patterns', () => {
      const response = 'This is just a normal response with no tool calls.'
      const parsed = parseXMLToolCalls(response)
      expect(parsed).toHaveLength(0)
    })

    it('handles malformed/incomplete XML gracefully', () => {
      const response = `
<function_calls>
<invoke name="search_memories">
This is incomplete...
`
      const parsed = parseXMLToolCalls(response)
      expect(parsed).toHaveLength(0)
    })

    it('handles special characters in arguments', () => {
      const response = `
<function_calls>
<invoke name="search_memories">
<parameter name="query">What did she say about "the incident" & other events?</parameter>
</invoke>
</function_calls>
`
      const parsed = parseXMLToolCalls(response)
      expect(parsed).toHaveLength(1)
      expect(parsed[0].arguments.query).toBe('What did she say about "the incident" & other events?')
    })

    it('handles unicode in tool arguments', () => {
      const response = `
<function_calls>
<invoke name="generate_image">
<parameter name="prompt">A beautiful garden with cherry blossoms</parameter>
</invoke>
</function_calls>
`
      const parsed = parseXMLToolCalls(response)
      expect(parsed).toHaveLength(1)
      expect(parsed[0].arguments.prompt).toBe('A beautiful garden with cherry blossoms')
    })

    it('handles boolean values in DeepSeek format', () => {
      const response = `
<function_calls>
<invoke name="search_memories">
<parameter name="query" string="true">test query</parameter>
<parameter name="exact" string="false">true</parameter>
</invoke>
</function_calls>
`
      const parsed = parseXMLToolCalls(response)
      expect(parsed).toHaveLength(1)
      expect(parsed[0].arguments.exact).toBe(true)
    })

    it('parses Gemini <tool_use> with bare JSON content', () => {
      const response = `*I adjust my cuffs.* "Understood, Charlie."

<tool_use>
{"name": "submit_final_response", "input": {"response": "Here is my final response text."}}
</tool_use>`
      const parsed = parseXMLToolCalls(response)
      expect(parsed).toHaveLength(1)
      expect(parsed[0].toolName).toBe('submit_final_response')
      expect(parsed[0].arguments).toEqual({ response: 'Here is my final response text.' })
      expect(parsed[0].format).toBe('tool_use')
    })

    it('parses <tool_use> with XML child elements', () => {
      const response = `
<tool_use>
<name>search_memories</name>
<arguments>
<query>previous conversation about cats</query>
<limit>5</limit>
</arguments>
</tool_use>
`
      const parsed = parseXMLToolCalls(response)
      expect(parsed).toHaveLength(1)
      expect(parsed[0].toolName).toBe('search_memories')
      expect(parsed[0].arguments).toEqual({
        query: 'previous conversation about cats',
        limit: '5',
      })
      expect(parsed[0].format).toBe('tool_use')
    })

    it('parses <tool_use> with JSON inside <arguments>', () => {
      const response = `
<tool_use>
<name>generate_image</name>
<arguments>{"prompt": "a cat sitting on a windowsill"}</arguments>
</tool_use>
`
      const parsed = parseXMLToolCalls(response)
      expect(parsed).toHaveLength(1)
      expect(parsed[0].toolName).toBe('generate_image')
      expect(parsed[0].arguments).toEqual({ prompt: 'a cat sitting on a windowsill' })
      expect(parsed[0].format).toBe('tool_use')
    })

    it('parses <tool_use> with name attribute', () => {
      const response = `
<tool_use name="search_web">
<arguments>{"query": "weather today"}</arguments>
</tool_use>
`
      const parsed = parseXMLToolCalls(response)
      expect(parsed).toHaveLength(1)
      expect(parsed[0].toolName).toBe('search_web')
      expect(parsed[0].arguments).toEqual({ query: 'weather today' })
      expect(parsed[0].format).toBe('tool_use')
    })

    it('parses <tool_use> with <input> instead of <arguments>', () => {
      const response = `
<tool_use>
<name>search_memories</name>
<input>{"query": "favorite food"}</input>
</tool_use>
`
      const parsed = parseXMLToolCalls(response)
      expect(parsed).toHaveLength(1)
      expect(parsed[0].toolName).toBe('search_memories')
      expect(parsed[0].arguments).toEqual({ query: 'favorite food' })
    })

    it('handles multiple <tool_use> blocks', () => {
      const response = `
<tool_use>
{"name": "search_memories", "input": {"query": "test"}}
</tool_use>

Some text in between.

<tool_use>
{"name": "generate_image", "input": {"prompt": "a sunset"}}
</tool_use>
`
      const parsed = parseXMLToolCalls(response)
      expect(parsed).toHaveLength(2)
      expect(parsed[0].toolName).toBe('search_memories')
      expect(parsed[1].toolName).toBe('generate_image')
    })
  })

  describe('convertXMLToToolCallRequest', () => {
    it('converts search_memories tool correctly', () => {
      const parsed: ParsedXMLTool = {
        toolName: 'search_memories',
        arguments: { query: 'test query', limit: 5 },
        fullMatch: '',
        startIndex: 0,
        endIndex: 0,
        format: 'deepseek',
      }

      const request = convertXMLToToolCallRequest(parsed)
      expect(request).toEqual({
        name: 'search_memories',
        arguments: { query: 'test query', limit: 5 },
      })
    })

    it('converts generate_image tool correctly', () => {
      const parsed: ParsedXMLTool = {
        toolName: 'generate_image',
        arguments: { prompt: 'a sunset' },
        fullMatch: '',
        startIndex: 0,
        endIndex: 0,
        format: 'claude',
      }

      const request = convertXMLToToolCallRequest(parsed)
      expect(request).toEqual({
        name: 'generate_image',
        arguments: { prompt: 'a sunset' },
      })
    })

    it('converts search_web tool correctly', () => {
      const parsed: ParsedXMLTool = {
        toolName: 'search_web',
        arguments: { query: 'latest news' },
        fullMatch: '',
        startIndex: 0,
        endIndex: 0,
        format: 'generic',
      }

      const request = convertXMLToToolCallRequest(parsed)
      expect(request).toEqual({
        name: 'search_web',
        arguments: { query: 'latest news' },
      })
    })

    it('handles alternative argument names', () => {
      const parsed: ParsedXMLTool = {
        toolName: 'search_memories',
        arguments: { search: 'alternative key' },
        fullMatch: '',
        startIndex: 0,
        endIndex: 0,
        format: 'claude',
      }

      const request = convertXMLToToolCallRequest(parsed)
      expect(request.arguments.query).toBe('alternative key')
    })

    it('handles unknown tool names by passing through', () => {
      const parsed: ParsedXMLTool = {
        toolName: 'unknown_tool',
        arguments: { foo: 'bar' },
        fullMatch: '',
        startIndex: 0,
        endIndex: 0,
        format: 'generic',
      }

      const request = convertXMLToToolCallRequest(parsed)
      expect(request.name).toBe('unknown_tool')
      expect(request.arguments).toEqual({ foo: 'bar' })
    })
  })

  describe('stripXMLToolMarkers', () => {
    it('removes all XML tool markers', () => {
      const response = `
Here's what I found:

<function_calls>
<invoke name="search_memories">
<parameter name="query">test</parameter>
</invoke>
</function_calls>

That's the result!
`
      const stripped = stripXMLToolMarkers(response)
      expect(stripped).not.toContain('<function_calls>')
      expect(stripped).not.toContain('</function_calls>')
      expect(stripped).toContain("Here's what I found:")
      expect(stripped).toContain("That's the result!")
    })

    it('preserves surrounding text', () => {
      const response = 'Before <function_calls><invoke name="test"><parameter name="x">y</parameter></invoke></function_calls> After'
      const stripped = stripXMLToolMarkers(response)
      expect(stripped).toBe('Before After')
    })

    it('cleans up extra whitespace', () => {
      const response = `
Text before


<function_calls>
<invoke name="test">
<parameter name="x">y</parameter>
</invoke>
</function_calls>


Text after
`
      const stripped = stripXMLToolMarkers(response)
      // Should collapse multiple newlines
      expect(stripped).not.toMatch(/\n{3,}/)
    })

    it('handles multiple XML blocks', () => {
      const response = `
<function_calls><invoke name="a"><parameter name="x">1</parameter></invoke></function_calls>
Middle text
<tool_call><name>b</name><arguments><y>2</y></arguments></tool_call>
`
      const stripped = stripXMLToolMarkers(response)
      expect(stripped).not.toContain('<function_calls>')
      expect(stripped).not.toContain('<tool_call>')
      expect(stripped).toContain('Middle text')
    })

    it('removes function_call format', () => {
      const response = 'Text <function_call name="test"><param name="x">y</param></function_call> more'
      const stripped = stripXMLToolMarkers(response)
      expect(stripped).toBe('Text more')
    })

    it('removes tool_use format', () => {
      const response = 'Before <tool_use>\n{"name": "test", "input": {}}\n</tool_use> After'
      const stripped = stripXMLToolMarkers(response)
      expect(stripped).toBe('Before After')
    })

    it('removes tool_use with name attribute', () => {
      const response = 'Text <tool_use name="test"><arguments>{"q":"v"}</arguments></tool_use> more'
      const stripped = stripXMLToolMarkers(response)
      expect(stripped).toBe('Text more')
    })
  })

  describe('hasXMLToolMarkers', () => {
    it('returns true for function_calls format', () => {
      expect(hasXMLToolMarkers('<function_calls><invoke name="test"></invoke></function_calls>')).toBe(true)
    })

    it('returns true for tool_call format', () => {
      expect(hasXMLToolMarkers('<tool_call><name>test</name></tool_call>')).toBe(true)
    })

    it('returns true for function_call format', () => {
      expect(hasXMLToolMarkers('<function_call name="test"></function_call>')).toBe(true)
    })

    it('returns true for tool_use format', () => {
      expect(hasXMLToolMarkers('<tool_use>{"name":"test"}</tool_use>')).toBe(true)
    })

    it('returns true for tool_use with attribute', () => {
      expect(hasXMLToolMarkers('<tool_use name="test"><arguments>{}</arguments></tool_use>')).toBe(true)
    })

    it('returns false for plain text', () => {
      expect(hasXMLToolMarkers('This is just plain text')).toBe(false)
    })

    it('returns false for non-tool XML', () => {
      expect(hasXMLToolMarkers('<div>Some HTML</div>')).toBe(false)
    })

    it('is case insensitive', () => {
      expect(hasXMLToolMarkers('<FUNCTION_CALLS></FUNCTION_CALLS>')).toBe(true)
      expect(hasXMLToolMarkers('<Tool_Call></Tool_Call>')).toBe(true)
    })
  })

  describe('mapXMLToolName', () => {
    it('maps known tool names correctly', () => {
      expect(mapXMLToolName('search_memories')).toBe('search_memories')
      expect(mapXMLToolName('generate_image')).toBe('generate_image')
      expect(mapXMLToolName('search_web')).toBe('search_web')
    })

    it('maps aliases to canonical names', () => {
      expect(mapXMLToolName('memory')).toBe('search_memories')
      expect(mapXMLToolName('memory_search')).toBe('search_memories')
      expect(mapXMLToolName('image')).toBe('generate_image')
      expect(mapXMLToolName('create_image')).toBe('generate_image')
      expect(mapXMLToolName('search')).toBe('search_web')
      expect(mapXMLToolName('web_search')).toBe('search_web')
    })

    it('returns original name for unknown tools', () => {
      expect(mapXMLToolName('unknown_tool')).toBe('unknown_tool')
      expect(mapXMLToolName('custom_function')).toBe('custom_function')
    })

    it('handles case variations', () => {
      expect(mapXMLToolName('SEARCH_MEMORIES')).toBe('search_memories')
      expect(mapXMLToolName('Memory')).toBe('search_memories')
      expect(mapXMLToolName('IMAGE')).toBe('generate_image')
    })

    it('trims whitespace', () => {
      expect(mapXMLToolName('  search_memories  ')).toBe('search_memories')
    })
  })
})
