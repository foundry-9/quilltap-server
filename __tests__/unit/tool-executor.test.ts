/**
 * Unit Tests for Tool Executor
 * Tests lib/chat/tool-executor.ts
 *
 * Note: detectToolCalls now delegates entirely to provider plugins via
 * providerRegistry.getProvider(provider).parseToolCalls(). These tests
 * verify the delegation behavior and error handling.
 */

import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals'
import {
  detectToolCalls,
  type ToolResult,
} from '@/lib/chat/tool-executor'

describe('Tool Executor', () => {
  let consoleErrorSpy: jest.SpiedFunction<typeof console.error>

  beforeEach(() => {
    jest.clearAllMocks()
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    consoleErrorSpy.mockRestore()
  })

  // ============================================================================
  // detectToolCalls - Plugin Delegation Tests
  // ============================================================================

  describe('detectToolCalls - plugin delegation', () => {
    it('should return empty array for null response', () => {
      const toolCalls = detectToolCalls(null, 'OPENAI')
      expect(toolCalls).toEqual([])
    })

    it('should return empty array for undefined response', () => {
      const toolCalls = detectToolCalls(undefined, 'OPENAI')
      expect(toolCalls).toEqual([])
    })

    it('should handle non-existent provider gracefully', () => {
      const response = {
        tool_calls: [
          {
            type: 'function',
            function: {
              name: 'test_tool',
              arguments: '{}',
            },
          },
        ],
      }

      const toolCalls = detectToolCalls(response, 'NONEXISTENT')
      expect(toolCalls).toEqual([])
    })

    it('should handle response with unexpected structure', () => {
      const response = {
        unexpectedKey: 'unexpected value',
        anotherKey: { nested: true },
      }

      const toolCalls = detectToolCalls(response, 'OPENAI')
      expect(toolCalls).toEqual([])
    })
  })
})
