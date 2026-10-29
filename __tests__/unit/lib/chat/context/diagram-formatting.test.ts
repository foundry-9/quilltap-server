/**
 * The diagram formatting note in the system prompt.
 *
 * Load-bearing, and tested here:
 *  - **Only a drawing character hears it.** `canDrawDiagrams: true` in the
 *    character's vault `properties.json` adds the note; absent or false adds
 *    nothing, so every other character's prompt is byte-identical to one built
 *    before diagrams existed.
 *  - **Placement.** Directly after the universal math note, in the cacheable
 *    system block 1 — not in the identity stack, so neither the stack's
 *    builder version nor its goldens move.
 */

import {
  DIAGRAM_FORMATTING_INSTRUCTION,
  buildSystemPrompt,
  buildIdentityStack,
} from '@/lib/chat/context/system-prompt-builder'
import type { Character } from '@/lib/schemas/types'

const now = '2025-01-01T00:00:00.000Z'

const BASE = {
  id: 'char-1',
  name: 'Test Character',
  personality: 'Friendly and helpful',
  systemPrompts: [
    {
      id: 'prompt-1',
      name: 'Default',
      content: 'You are a helpful assistant.',
      isDefault: true,
      createdAt: now,
      updatedAt: now,
    },
  ],
  scenarios: [],
  createdAt: now,
  updatedAt: now,
}

const character = (extra: Record<string, unknown> = {}) => ({ ...BASE, ...extra }) as unknown as Character

const MATH_MARKER = '[FORMATTING: MATHEMATICAL NOTATION]'
const DIAGRAM_MARKER = '[FORMATTING: DIAGRAMS]'
const TABOO_MARKER = '[STYLE: FORBIDDEN PHRASES]'

describe('DIAGRAM_FORMATTING_INSTRUCTION', () => {
  it('names all three fences and nothing about style', () => {
    expect(DIAGRAM_FORMATTING_INSTRUCTION.startsWith(DIAGRAM_MARKER)).toBe(true)
    expect(DIAGRAM_FORMATTING_INSTRUCTION).toContain('```mermaid')
    expect(DIAGRAM_FORMATTING_INSTRUCTION).toContain('```dot')
    expect(DIAGRAM_FORMATTING_INSTRUCTION).toContain('```svg')
    expect(DIAGRAM_FORMATTING_INSTRUCTION).not.toMatch(/hand-?drawn|diagramStyle|clean/i)
  })
})

describe('buildSystemPrompt — diagram note', () => {
  it('is absent for a character without the flag', () => {
    expect(buildSystemPrompt({ character: character() })).not.toContain(DIAGRAM_MARKER)
    expect(buildSystemPrompt({ character: character({ canDrawDiagrams: false }) })).not.toContain(DIAGRAM_MARKER)
  })

  it('leaves the prompt byte-identical when the flag is off, whatever the style', () => {
    const plain = buildSystemPrompt({ character: character() })
    expect(buildSystemPrompt({ character: character({ canDrawDiagrams: false, diagramStyle: 'clean' }) })).toBe(plain)
    expect(buildSystemPrompt({ character: character({ diagramStyle: 'handDrawn' }) })).toBe(plain)
  })

  it('appears for a drawing character, directly after the math note', () => {
    const prompt = buildSystemPrompt({ character: character({ canDrawDiagrams: true }) })
    const mathIdx = prompt.indexOf(MATH_MARKER)
    const diagramIdx = prompt.indexOf(DIAGRAM_MARKER)
    expect(mathIdx).toBeGreaterThanOrEqual(0)
    expect(diagramIdx).toBeGreaterThan(mathIdx)
    // Nothing else between the two notes.
    const between = prompt.slice(mathIdx, diagramIdx)
    expect(between.indexOf('[', 1)).toBe(-1)
  })

  it('adds exactly the note and nothing else', () => {
    const without = buildSystemPrompt({ character: character() })
    const withNote = buildSystemPrompt({ character: character({ canDrawDiagrams: true }) })
    expect(withNote.replace(`\n\n${DIAGRAM_FORMATTING_INSTRUCTION}`, '')).toBe(without)
  })

  it('sits before the Taboo section and the tool instructions', () => {
    const prompt = buildSystemPrompt({
      character: character({ canDrawDiagrams: true }),
      tabooPhrases: ['weight-bearing'],
      toolInstructions: 'Tools available: foo.',
    })
    const diagramIdx = prompt.indexOf(DIAGRAM_MARKER)
    expect(prompt.indexOf(TABOO_MARKER)).toBeGreaterThan(diagramIdx)
    expect(prompt.indexOf('Tools available: foo.')).toBeGreaterThan(diagramIdx)
  })

  it('never enters the identity stack', () => {
    const stack = buildIdentityStack({ character: character({ canDrawDiagrams: true }) })
    expect(stack).not.toContain(DIAGRAM_MARKER)
  })

  it('still appears when a precompiled identity stack is supplied', () => {
    const prompt = buildSystemPrompt({
      character: character({ canDrawDiagrams: true }),
      precompiledIdentityStack: 'PRECOMPILED STACK',
    })
    expect(prompt).toContain(DIAGRAM_MARKER)
  })
})
