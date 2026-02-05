/**
 * Unit tests for native-tool-prompt.ts
 * Tests native tool instruction building
 */

import { buildNativeToolInstructions } from '@/lib/tools/native-tool-prompt'

describe('native-tool-prompt', () => {
  describe('buildNativeToolInstructions', () => {
    it('should return tool execution rules when hasTools is true', () => {
      const result = buildNativeToolInstructions(true)

      expect(result).toContain('Tool Execution Rules')
      expect(result).toContain('tool_use content block')
      expect(result).toContain('Never narrate tool use')
    })

    it('should return tool execution rules by default (no argument)', () => {
      const result = buildNativeToolInstructions()

      expect(result).toContain('Tool Execution Rules')
      expect(result).toContain('tool_use content block')
    })

    it('should return empty string when hasTools is false', () => {
      const result = buildNativeToolInstructions(false)

      expect(result).toBe('')
    })

    it('should include all five rules', () => {
      const result = buildNativeToolInstructions(true)

      expect(result).toContain('1.')
      expect(result).toContain('2.')
      expect(result).toContain('3.')
      expect(result).toContain('4.')
      expect(result).toContain('5.')
    })

    it('should include guidance about chaining tool calls', () => {
      const result = buildNativeToolInstructions(true)

      expect(result).toContain('Chain tool calls')
      expect(result).toContain('multiple tool calls')
    })

    it('should include self-check rule', () => {
      const result = buildNativeToolInstructions(true)

      expect(result).toContain('Self-check')
      expect(result).toContain('zero tool_use blocks')
    })
  })
})
