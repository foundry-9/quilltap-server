/**
 * Unit tests for pseudo-tool.service.ts
 * Tests pseudo-tool parsing and configuration
 */

import {
  checkShouldUsePseudoTools,
  buildPseudoToolSystemInstructions,
  buildNativeToolSystemInstructions,
  parsePseudoToolsFromResponse,
  stripPseudoToolMarkersFromResponse,
  determineEnabledToolOptions,
  logPseudoToolUsage,
} from '@/lib/services/chat-message/pseudo-tool.service'
import * as tools from '@/lib/tools'

jest.mock('@/lib/logging/create-logger', () => ({
  createServiceLogger: jest.fn(() => ({
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  })),
}))
jest.mock('@/lib/tools')

const mockedShouldUsePseudoTools = tools.shouldUsePseudoTools as jest.MockedFunction<typeof tools.shouldUsePseudoTools>
const mockedBuildPseudoToolInstructions = tools.buildPseudoToolInstructions as jest.MockedFunction<typeof tools.buildPseudoToolInstructions>
const mockedBuildNativeToolInstructions = tools.buildNativeToolInstructions as jest.MockedFunction<typeof tools.buildNativeToolInstructions>
const mockedParsePseudoToolCalls = tools.parsePseudoToolCalls as jest.MockedFunction<typeof tools.parsePseudoToolCalls>
const mockedConvertToToolCallRequest = tools.convertToToolCallRequest as jest.MockedFunction<typeof tools.convertToToolCallRequest>
const mockedStripPseudoToolMarkers = tools.stripPseudoToolMarkers as jest.MockedFunction<typeof tools.stripPseudoToolMarkers>

describe('pseudo-tool.service', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('checkShouldUsePseudoTools', () => {
    it('should use pseudo-tools when model does not support native tools', () => {
      mockedShouldUsePseudoTools.mockReturnValue(true)

      const result = checkShouldUsePseudoTools(false)

      expect(mockedShouldUsePseudoTools).toHaveBeenCalledWith(false)
      expect(result).toBe(true)
    })

    it('should not use pseudo-tools when model supports native tools', () => {
      mockedShouldUsePseudoTools.mockReturnValue(false)

      const result = checkShouldUsePseudoTools(true)

      expect(mockedShouldUsePseudoTools).toHaveBeenCalledWith(true)
      expect(result).toBe(false)
    })
  })

  describe('buildPseudoToolSystemInstructions', () => {
    it('should build instructions for all enabled tools', () => {
      const instructions = 'Use [TOOL:memory] for memories, [TOOL:image] for images'
      mockedBuildPseudoToolInstructions.mockReturnValue(instructions)

      const result = buildPseudoToolSystemInstructions({
        imageGeneration: true,
        memorySearch: true,
        webSearch: false,
      })

      expect(mockedBuildPseudoToolInstructions).toHaveBeenCalledWith({
        imageGeneration: true,
        memorySearch: true,
        webSearch: false,
      })
      expect(result).toBe(instructions)
    })

    it('should build instructions for only memory search', () => {
      const instructions = 'Use [TOOL:memory] to search memories'
      mockedBuildPseudoToolInstructions.mockReturnValue(instructions)

      const result = buildPseudoToolSystemInstructions({
        imageGeneration: false,
        memorySearch: true,
        webSearch: false,
      })

      expect(result).toContain('memory')
    })

    it('should return empty instructions when no tools enabled', () => {
      mockedBuildPseudoToolInstructions.mockReturnValue('')

      const result = buildPseudoToolSystemInstructions({
        imageGeneration: false,
        memorySearch: false,
        webSearch: false,
      })

      expect(result).toBe('')
    })

    it('should build instructions for only web search', () => {
      const instructions = 'Use [TOOL:search] for web searches'
      mockedBuildPseudoToolInstructions.mockReturnValue(instructions)

      const result = buildPseudoToolSystemInstructions({
        imageGeneration: false,
        memorySearch: false,
        webSearch: true,
      })

      expect(result).toContain('search')
    })
  })

  describe('buildNativeToolSystemInstructions', () => {
    it('should call buildNativeToolInstructions with hasTools=true', () => {
      const nativeInstructions = '## Tool Execution Rules\nNever narrate tool use.'
      mockedBuildNativeToolInstructions.mockReturnValue(nativeInstructions)

      const result = buildNativeToolSystemInstructions()

      expect(mockedBuildNativeToolInstructions).toHaveBeenCalledWith(true)
      expect(result).toBe(nativeInstructions)
    })

    it('should return the value from buildNativeToolInstructions', () => {
      const expected = 'Tool rules content here'
      mockedBuildNativeToolInstructions.mockReturnValue(expected)

      const result = buildNativeToolSystemInstructions()

      expect(result).toBe(expected)
    })
  })

  describe('parsePseudoToolsFromResponse', () => {
    it('should parse memory search tool', () => {
      const response = 'Let me check... [TOOL:memory]favorite color[/TOOL]'
      
      mockedParsePseudoToolCalls.mockReturnValue([
        {
          toolName: 'search_memories',
          argument: 'favorite color',
          fullMatch: '[TOOL:memory]favorite color[/TOOL]',
          startIndex: 16,
          endIndex: 52,
        },
      ])

      mockedConvertToToolCallRequest.mockReturnValue({
        name: 'search_memories',
        arguments: { query: 'favorite color' },
      })

      const result = parsePseudoToolsFromResponse(response)

      expect(mockedParsePseudoToolCalls).toHaveBeenCalledWith(response)
      expect(result).toHaveLength(1)
      expect(result[0]).toEqual({
        name: 'search_memories',
        arguments: { query: 'favorite color' },
      })
    })

    it('should parse image generation tool', () => {
      const response = 'Creating: [TOOL:image]a beautiful sunset[/TOOL]'
      
      mockedParsePseudoToolCalls.mockReturnValue([
        {
          toolName: 'generate_image',
          argument: 'a beautiful sunset',
          fullMatch: '[TOOL:image]a beautiful sunset[/TOOL]',
          startIndex: 10,
          endIndex: 48,
        },
      ])

      mockedConvertToToolCallRequest.mockReturnValue({
        name: 'generate_image',
        arguments: { prompt: 'a beautiful sunset' },
      })

      const result = parsePseudoToolsFromResponse(response)

      expect(result).toHaveLength(1)
      expect(result[0].name).toBe('generate_image')
      expect(result[0].arguments).toEqual({ prompt: 'a beautiful sunset' })
    })

    it('should parse web search tool', () => {
      const response = 'Searching: [TOOL:search]latest news[/TOOL]'
      
      mockedParsePseudoToolCalls.mockReturnValue([
        {
          toolName: 'search_web',
          argument: 'latest news',
          fullMatch: '[TOOL:search]latest news[/TOOL]',
          startIndex: 11,
          endIndex: 43,
        },
      ])

      mockedConvertToToolCallRequest.mockReturnValue({
        name: 'search_web',
        arguments: { query: 'latest news' },
      })

      const result = parsePseudoToolsFromResponse(response)

      expect(result).toHaveLength(1)
      expect(result[0].name).toBe('search_web')
    })

    it('should parse multiple tool calls', () => {
      const response = '[TOOL:memory]test[/TOOL] and [TOOL:image]cat[/TOOL]'
      
      mockedParsePseudoToolCalls.mockReturnValue([
        {
          toolName: 'search_memories',
          argument: 'test',
          fullMatch: '[TOOL:memory]test[/TOOL]',
          startIndex: 0,
          endIndex: 24,
        },
        {
          toolName: 'generate_image',
          argument: 'cat',
          fullMatch: '[TOOL:image]cat[/TOOL]',
          startIndex: 29,
          endIndex: 51,
        },
      ])

      mockedConvertToToolCallRequest
        .mockReturnValueOnce({
          name: 'search_memories',
          arguments: { query: 'test' },
        })
        .mockReturnValueOnce({
          name: 'generate_image',
          arguments: { prompt: 'cat' },
        })

      const result = parsePseudoToolsFromResponse(response)

      expect(result).toHaveLength(2)
      expect(result[0].name).toBe('search_memories')
      expect(result[1].name).toBe('generate_image')
    })

    it('should return empty array when no tools detected', () => {
      const response = 'Just a normal response'
      
      mockedParsePseudoToolCalls.mockReturnValue([])

      const result = parsePseudoToolsFromResponse(response)

      expect(result).toEqual([])
    })

    it('should handle multiline tool arguments', () => {
      const response = '[TOOL:image]a cat\nsitting on\na mat[/TOOL]'
      
      mockedParsePseudoToolCalls.mockReturnValue([
        {
          toolName: 'generate_image',
          argument: 'a cat\nsitting on\na mat',
          fullMatch: '[TOOL:image]a cat\nsitting on\na mat[/TOOL]',
          startIndex: 0,
          endIndex: 42,
        },
      ])

      mockedConvertToToolCallRequest.mockReturnValue({
        name: 'generate_image',
        arguments: { prompt: 'a cat\nsitting on\na mat' },
      })

      const result = parsePseudoToolsFromResponse(response)

      expect(result[0].arguments.prompt).toContain('\n')
    })

    it('should handle tool arguments with special characters', () => {
      const response = '[TOOL:search]"quotes" & <tags>[/TOOL]'
      
      mockedParsePseudoToolCalls.mockReturnValue([
        {
          toolName: 'search_web',
          argument: '"quotes" & <tags>',
          fullMatch: '[TOOL:search]"quotes" & <tags>[/TOOL]',
          startIndex: 0,
          endIndex: 37,
        },
      ])

      mockedConvertToToolCallRequest.mockReturnValue({
        name: 'search_web',
        arguments: { query: '"quotes" & <tags>' },
      })

      const result = parsePseudoToolsFromResponse(response)

      expect(result[0].arguments.query).toContain('"quotes"')
      expect(result[0].arguments.query).toContain('<tags>')
    })

    it('should handle empty tool arguments', () => {
      const response = '[TOOL:memory][/TOOL]'
      
      mockedParsePseudoToolCalls.mockReturnValue([
        {
          toolName: 'search_memories',
          argument: '',
          fullMatch: '[TOOL:memory][/TOOL]',
          startIndex: 0,
          endIndex: 20,
        },
      ])

      mockedConvertToToolCallRequest.mockReturnValue({
        name: 'search_memories',
        arguments: { query: '' },
      })

      const result = parsePseudoToolsFromResponse(response)

      expect(result[0].arguments.query).toBe('')
    })
  })

  describe('stripPseudoToolMarkersFromResponse', () => {
    it('should strip memory tool markers', () => {
      const response = 'Before [TOOL:memory]test[/TOOL] after'
      mockedStripPseudoToolMarkers.mockReturnValue('Before  after')

      const result = stripPseudoToolMarkersFromResponse(response)

      expect(mockedStripPseudoToolMarkers).toHaveBeenCalledWith(response)
      expect(result).not.toContain('[TOOL:')
    })

    it('should strip image tool markers', () => {
      const response = 'Creating [TOOL:image]cat[/TOOL] now'
      mockedStripPseudoToolMarkers.mockReturnValue('Creating  now')

      const result = stripPseudoToolMarkersFromResponse(response)

      expect(result).not.toContain('[TOOL:image]')
    })

    it('should strip search tool markers', () => {
      const response = 'Searching [TOOL:search]query[/TOOL] done'
      mockedStripPseudoToolMarkers.mockReturnValue('Searching  done')

      const result = stripPseudoToolMarkersFromResponse(response)

      expect(result).not.toContain('[TOOL:search]')
    })

    it('should strip multiple tool markers', () => {
      const response = '[TOOL:memory]a[/TOOL] text [TOOL:image]b[/TOOL]'
      mockedStripPseudoToolMarkers.mockReturnValue('text')

      const result = stripPseudoToolMarkersFromResponse(response)

      expect(result).not.toContain('[TOOL:')
      expect(result).not.toContain('[/TOOL]')
    })

    it('should handle response with no markers', () => {
      const response = 'Just normal text'
      mockedStripPseudoToolMarkers.mockReturnValue('Just normal text')

      const result = stripPseudoToolMarkersFromResponse(response)

      expect(result).toBe('Just normal text')
    })

    it('should handle empty response', () => {
      const response = ''
      mockedStripPseudoToolMarkers.mockReturnValue('')

      const result = stripPseudoToolMarkersFromResponse(response)

      expect(result).toBe('')
    })

    it('should handle response with only markers', () => {
      const response = '[TOOL:memory]test[/TOOL]'
      mockedStripPseudoToolMarkers.mockReturnValue('')

      const result = stripPseudoToolMarkersFromResponse(response)

      expect(result).toBe('')
    })
  })

  describe('determineEnabledToolOptions', () => {
    it('should enable image generation when image profile is provided', () => {
      const result = determineEnabledToolOptions('image-profile-1', false)

      expect(result).toEqual({
        imageGeneration: true,
        memorySearch: true,
        webSearch: false,
      })
    })

    it('should enable web search when allowed', () => {
      const result = determineEnabledToolOptions(null, true)

      expect(result).toEqual({
        imageGeneration: false,
        memorySearch: true,
        webSearch: true,
      })
    })

    it('should always enable memory search', () => {
      const result1 = determineEnabledToolOptions(null, false)
      const result2 = determineEnabledToolOptions('img-1', true)

      expect(result1.memorySearch).toBe(true)
      expect(result2.memorySearch).toBe(true)
    })

    it('should enable all tools when both options provided', () => {
      const result = determineEnabledToolOptions('image-profile-1', true)

      expect(result).toEqual({
        imageGeneration: true,
        memorySearch: true,
        webSearch: true,
      })
    })

    it('should disable all optional tools when none provided', () => {
      const result = determineEnabledToolOptions(null, false)

      expect(result).toEqual({
        imageGeneration: false,
        memorySearch: true,
        webSearch: false,
      })
    })

    it('should handle empty string image profile ID', () => {
      const result = determineEnabledToolOptions('', false)

      expect(result.imageGeneration).toBe(false)
    })
  })

  describe('logPseudoToolUsage', () => {
    it('should call function without throwing', () => {
      const enabledTools = {
        imageGeneration: true,
        memorySearch: true,
        webSearch: false,
      }

      logPseudoToolUsage('OPENAI', 'o1-mini', enabledTools)
      // Function completes without error
    })

    it('should handle different providers', () => {
      const enabledTools = {
        imageGeneration: false,
        memorySearch: true,
        webSearch: true,
      }

      logPseudoToolUsage('ANTHROPIC', 'claude-3-opus', enabledTools)
      // Function completes without error
    })

    it('should handle no tools enabled', () => {
      const enabledTools = {
        imageGeneration: false,
        memorySearch: false,
        webSearch: false,
      }

      logPseudoToolUsage('OPENAI', 'gpt-4', enabledTools)
      // Function completes without error
    })

    it('should handle all tools enabled', () => {
      const enabledTools = {
        imageGeneration: true,
        memorySearch: true,
        webSearch: true,
      }

      logPseudoToolUsage('GOOGLE', 'gemini-pro', enabledTools)
      // Function completes without error
    })
  })
})
