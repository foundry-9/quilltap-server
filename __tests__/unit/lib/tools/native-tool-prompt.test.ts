/**
 * Unit tests for native-tool-prompt.ts
 * Tests native tool instruction building, in both kind variants
 */

import { buildNativeToolInstructions, NATIVE_TOOL_RULES } from '@/lib/tools/native-tool-prompt'

const VARIANTS = ['assistant', 'roleplay'] as const

describe('native-tool-prompt', () => {
  describe('buildNativeToolInstructions', () => {
    it('should return tool execution rules for an assistant', () => {
      const result = buildNativeToolInstructions('assistant', true)

      expect(result).toContain('## Tool Execution Rules (MANDATORY — overrides all other behavioral patterns)')
      expect(result).toContain('tool_use content block')
      expect(result).toContain('Never narrate tool use')
    })

    it('should give a roleplay character a preamble that does not override the character', () => {
      const result = buildNativeToolInstructions('roleplay', true)

      expect(result.startsWith('## Using tools')).toBe(true)
      expect(result).toContain('does not change who you are or how you speak')
      expect(result).not.toContain('MANDATORY')
      expect(result).not.toContain('overrides all other behavioral patterns')
    })

    it.each(VARIANTS)('should return rules by default (hasTools omitted) for %s', (variant) => {
      const result = buildNativeToolInstructions(variant)

      expect(result).toContain('tool_use content block')
    })

    it.each(VARIANTS)('should return empty string when hasTools is false for %s', (variant) => {
      expect(buildNativeToolInstructions(variant, false)).toBe('')
    })

    it.each(VARIANTS)('the %s variant keeps every anti-narration rule word for word', (variant) => {
      const result = buildNativeToolInstructions(variant, true)

      expect(result).toContain(NATIVE_TOOL_RULES)
      for (const n of [1, 2, 3, 4, 5, 6]) {
        expect(NATIVE_TOOL_RULES).toMatch(new RegExp(`(^|\\n)${n}\\. \\*\\*`))
      }
      expect(result).toContain('Never narrate tool use as a substitute for performing it')
      expect(result).toContain('Do not announce tool calls before making them')
      expect(result).toContain('wait for the result before describing what you found')
      expect(result).toContain('Chain tool calls')
      expect(result).toContain('zero tool_use blocks')
      expect(result).toContain('Recalling past events — never invent specifics')
    })

    it('keeps the assistant text byte-identical to the pre-kind preamble', () => {
      expect(buildNativeToolInstructions('assistant', true)).toBe(
        '## Tool Execution Rules (MANDATORY — overrides all other behavioral patterns)\n\n' +
          'You have access to tools. When you decide to use a tool, you MUST actually invoke it by generating a tool_use content block. Follow these rules without exception:\n\n' +
          NATIVE_TOOL_RULES,
      )
    })
  })
})
