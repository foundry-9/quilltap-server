/**
 * Unit tests for tool support functions in pseudo-tool.service.ts
 * Tests determineEnabledToolOptions and buildNativeToolSystemInstructions
 */

import {
  buildNativeToolSystemInstructions,
  determineEnabledToolOptions,
} from '@/lib/services/chat-message/pseudo-tool.service'
import * as tools from '@/lib/tools'

jest.mock('@/lib/logging/create-logger', () => ({
  createServiceLogger: jest.fn(() => ({
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  })),
  createLogger: jest.fn(() => ({
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  })),
}))
jest.mock('@/lib/tools')

const mockedBuildNativeToolInstructions = tools.buildNativeToolInstructions as jest.MockedFunction<typeof tools.buildNativeToolInstructions>

describe('tool-support.service', () => {
  beforeEach(() => {
    jest.clearAllMocks()
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

  describe('determineEnabledToolOptions', () => {
    it('should enable image generation when image profile is provided', () => {
      const result = determineEnabledToolOptions('image-profile-1', false)

      expect(result).toEqual({
        imageGeneration: true,
        search: true,
        webSearch: false,
      })
    })

    it('should enable web search when allowed', () => {
      const result = determineEnabledToolOptions(null, true)

      expect(result).toEqual({
        imageGeneration: false,
        search: true,
        webSearch: true,
      })
    })

    it('should always enable search', () => {
      const result1 = determineEnabledToolOptions(null, false)
      const result2 = determineEnabledToolOptions('img-1', true)

      expect(result1.search).toBe(true)
      expect(result2.search).toBe(true)
    })

    it('should enable all tools when both options provided', () => {
      const result = determineEnabledToolOptions('image-profile-1', true)

      expect(result).toEqual({
        imageGeneration: true,
        search: true,
        webSearch: true,
      })
    })

    it('should disable all optional tools when none provided', () => {
      const result = determineEnabledToolOptions(null, false)

      expect(result).toEqual({
        imageGeneration: false,
        search: true,
        webSearch: false,
      })
    })

    it('should handle empty string image profile ID', () => {
      const result = determineEnabledToolOptions('', false)

      expect(result.imageGeneration).toBe(false)
    })
  })
})
