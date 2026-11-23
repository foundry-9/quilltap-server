/**
 * Unit tests for native-tool-prompt.ts
 * Tests native tool instruction building, in both kind variants
 */

import {
  buildNativeToolInstructions,
  NATIVE_TOOL_RULES,
  RECALL_RULE,
  STORY_LOOKUP_NOTE,
} from '@/lib/tools/native-tool-prompt'

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

    it.each(VARIANTS)('the %s variant sends the model to the period\'s conversations before anything else', (variant) => {
      const result = buildNativeToolInstructions(variant, true)

      expect(result).toContain('use `search`')
      expect(result).toContain('If the search lists conversations from that period, read the likeliest one with `read_conversation` before answering.')
    })

    it('an assistant that finds nothing says it does not recall, and never invents', () => {
      const result = buildNativeToolInstructions('assistant', true)

      expect(result).toContain("say you don't recall — never invent dates, places, or details")
      expect(result).not.toContain(STORY_LOOKUP_NOTE)
    })

    it('a roleplay character reports a record as it is and fills only a real gap', () => {
      const result = buildNativeToolInstructions('roleplay', true)

      expect(result).toContain('Recalling past events — look before you fill in')
      expect(result).toContain('What you find is what happened; tell it as it was.')
      expect(result).toContain('Only if the search finds nothing and lists no conversation from that period may you fill in detail that fits everything established')
      expect(result).toContain('never what {{user}} said or did, which you ask about')
      expect(result).not.toContain('never invent dates, places, or details')
    })

    it('a roleplay character is told that a lookup no tool performs is narration', () => {
      const result = buildNativeToolInstructions('roleplay', true)

      expect(result.endsWith(STORY_LOOKUP_NOTE)).toBe(true)
      expect(STORY_LOOKUP_NOTE).toContain('Something you do in the story that no listed tool performs')
      expect(STORY_LOOKUP_NOTE).toContain('If a listed tool could really do it')
      expect(STORY_LOOKUP_NOTE).toContain('call the tool and go by what it returns')
    })

    it.each(VARIANTS)('the %s variant keeps every anti-narration rule word for word', (variant) => {
      const result = buildNativeToolInstructions(variant, true)

      expect(result).toContain(NATIVE_TOOL_RULES)
      for (const n of [1, 2, 3, 4, 5]) {
        expect(NATIVE_TOOL_RULES).toMatch(new RegExp(`(^|\\n)${n}\\. \\*\\*`))
      }
      expect(NATIVE_TOOL_RULES).not.toMatch(/(^|\n)6\. /)
      expect(RECALL_RULE[variant].startsWith('6. **Recalling past events')).toBe(true)
      expect(result).toContain(RECALL_RULE[variant])
      expect(result).toContain('Never narrate tool use as a substitute for performing it')
      expect(result).toContain('Do not announce tool calls before making them')
      expect(result).toContain('wait for the result before describing what you found')
      expect(result).toContain('Chain tool calls')
      expect(result).toContain('zero tool_use blocks')
      expect(result).toContain('Do not fabricate, assume, or narrate tool results')
    })

    it('keeps the assistant text byte-identical to the pre-kind preamble', () => {
      expect(buildNativeToolInstructions('assistant', true)).toBe(
        '## Tool Execution Rules (MANDATORY — overrides all other behavioral patterns)\n\n' +
          'You have access to tools. When you decide to use a tool, you MUST actually invoke it by generating a tool_use content block. Follow these rules without exception:\n\n' +
          NATIVE_TOOL_RULES +
          '\n\n' +
          RECALL_RULE.assistant,
      )
    })

    it('keeps the assistant recall rule byte-identical to the rule as it stood', () => {
      expect(RECALL_RULE.assistant).toBe(
        "6. **Recalling past events — never invent specifics.** When asked about a past event or a specific detail that is not in your current recall, use `search` (pass `since`/`until` when a time period is mentioned), then `read_conversation` on the source conversation from the results, and answer from what you find. If the search lists conversations from that period, read the likeliest one with `read_conversation` before answering. Only if it finds nothing and lists no conversation from that period, say you don't recall — never invent dates, places, or details.",
      )
    })
  })
})
