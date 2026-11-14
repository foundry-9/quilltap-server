/**
 * Tests for the AI Wizard's per-field prompts.
 *
 * Locks in the vantage-point split between identity, description, personality,
 * and physical description so the wizard can't drift back into the older
 * "description = appearance + behaviour" conflation.
 */

import { FIELD_PROMPTS, PROPERTIES_PROMPT, buildSystemPromptFieldPrompt, wizardFieldMaxTokens, wizardFieldPrompt } from '@/lib/services/character-wizard.service'
import {
  CONVERSATIONAL_VOICE_DIRECTION,
  EXAMPLE_DIALOGUE_COVERAGE,
  TRUST_SAFEGUARDS_DIRECTION,
  COMPANION_TRUST_DISPOSITION,
  COMPANION_TRUST_DISPOSITION_GATE,
  STAKES_AND_REACTION_DIRECTION,
  ASSISTANT_TASK_DIRECTION,
} from '@/lib/services/character-field-semantics'

describe('character-wizard FIELD_PROMPTS', () => {
  it('defines a prompt for the identity field', () => {
    expect(FIELD_PROMPTS.identity).toBeDefined()
    expect(typeof FIELD_PROMPTS.identity).toBe('string')
    expect(FIELD_PROMPTS.identity.length).toBeGreaterThan(0)
  })

  it('identity prompt names the IDENTITY vantage point and excludes appearance', () => {
    const p = FIELD_PROMPTS.identity
    expect(p).toContain('IDENTITY')
    // public-knowledge facts only
    expect(p.toLowerCase()).toContain('public')
    // appearance lives elsewhere
    expect(p.toLowerCase()).toContain('physical appearance')
    expect(p).toMatch(/never include physical appearance/i)
  })

  it('description prompt forbids physical appearance and points to physicalDescription', () => {
    const p = FIELD_PROMPTS.description
    // The old prompt had "Physical appearance (if visual reference available)"
    // as a positive bullet; that must be gone.
    expect(p).not.toMatch(/physical appearance \(if visual reference/i)
    expect(p).toMatch(/do not describe physical appearance/i)
    expect(p.toLowerCase()).toContain('physicaldescription')
  })

  it('description prompt focuses on behaviour and mannerisms', () => {
    const p = FIELD_PROMPTS.description.toLowerCase()
    expect(p).toContain('behaviour')
    expect(p).toContain('mannerisms')
  })

  it('personality prompt is scoped to self-knowledge, not observable behaviour', () => {
    const p = FIELD_PROMPTS.personality
    expect(p).toContain('PERSONALITY')
    expect(p.toLowerCase()).toContain('self-knowledge')
    expect(p).toMatch(/never put outward behaviour someone else would observe/i)
  })

  it('all three vantage-point prompts inject the shared FIELD_SEMANTICS_PREAMBLE', () => {
    for (const field of ['identity', 'description', 'personality'] as const) {
      const p = FIELD_PROMPTS[field]
      expect(p).toContain('IDENTITY')
      expect(p).toContain('DESCRIPTION')
      expect(p).toContain('PERSONALITY')
      expect(p).toContain('vantage point')
    }
  })

  it('defines a firstMessage prompt in the character voice', () => {
    const p = FIELD_PROMPTS.firstMessage
    expect(p).toBeDefined()
    expect(p.toLowerCase()).toContain('opening message')
    expect(p).toContain('{{user}}')
  })

  it('systemPrompt prompt carries the Prompt-bucket semantics', () => {
    const p = buildSystemPromptFieldPrompt('roleplay')
    expect(p).toContain('SYSTEM PROMPTS')
    expect(p.toLowerCase()).toContain('second person')
  })

  it('systemPrompt prompt directs listening and conversational register', () => {
    const p = buildSystemPromptFieldPrompt('roleplay')
    expect(p).toContain(CONVERSATIONAL_VOICE_DIRECTION)
    expect(p).toMatch(/listen like a person/i)
    expect(p).toMatch(/seasoning/i)
  })

  it('systemPrompt prompt carries the trust safeguards', () => {
    const p = buildSystemPromptFieldPrompt('roleplay')
    expect(p).toContain(TRUST_SAFEGUARDS_DIRECTION)
    expect(p).toMatch(/not a committee/i)
  })

  it('systemPrompt prompt gates the companion trust disposition', () => {
    const p = buildSystemPromptFieldPrompt('roleplay')
    const gate = p.indexOf(COMPANION_TRUST_DISPOSITION_GATE)
    const disposition = p.indexOf(COMPANION_TRUST_DISPOSITION)
    expect(gate).toBeGreaterThan(-1)
    expect(disposition).toBeGreaterThan(gate)
  })

  it('systemPrompt prompt allows 600 words', () => {
    expect(buildSystemPromptFieldPrompt('roleplay')).toMatch(/under 600 words/)
  })

  it('systemPrompt prompt for a roleplay character carries the stakes direction, before the companion gate', () => {
    const p = buildSystemPromptFieldPrompt('roleplay')
    expect(p).toContain(STAKES_AND_REACTION_DIRECTION)
    expect(p).not.toContain(ASSISTANT_TASK_DIRECTION)
    expect(p.indexOf(STAKES_AND_REACTION_DIRECTION)).toBeGreaterThan(p.indexOf(TRUST_SAFEGUARDS_DIRECTION))
    expect(p.indexOf(STAKES_AND_REACTION_DIRECTION)).toBeLessThan(p.indexOf(COMPANION_TRUST_DISPOSITION_GATE))
  })

  it('systemPrompt prompt for an assistant carries the task direction instead', () => {
    const p = buildSystemPromptFieldPrompt('assistant')
    expect(p).toContain(ASSISTANT_TASK_DIRECTION)
    expect(p).not.toContain(STAKES_AND_REACTION_DIRECTION)
  })

  it('wizardFieldPrompt routes systemPrompt through the kind and every other field to FIELD_PROMPTS', () => {
    expect(wizardFieldPrompt('systemPrompt', 'assistant')).toBe(buildSystemPromptFieldPrompt('assistant'))
    expect(wizardFieldPrompt('identity', 'assistant')).toBe(FIELD_PROMPTS.identity)
    expect(FIELD_PROMPTS.systemPrompt).toBeUndefined()
  })

  it('gives the system prompt room to finish (a reasoning model truncated it at the old 1000-token cap)', () => {
    expect(wizardFieldMaxTokens('systemPrompt')).toBe(2500)
    expect(wizardFieldMaxTokens('exampleDialogues')).toBe(1000)
    expect(wizardFieldMaxTokens('firstMessage')).toBe(1000)
    expect(wizardFieldMaxTokens('scenarios')).toBe(4000)
    expect(wizardFieldMaxTokens('identity')).toBe(500)
  })

  it('exampleDialogues prompt asks for a joke caught, a casual line, and a serious moment', () => {
    const p = FIELD_PROMPTS.exampleDialogues
    expect(p).toContain(EXAMPLE_DIALOGUE_COVERAGE)
    expect(p).toMatch(/catching a joke/i)
    expect(p).toMatch(/casual, offhand line briefly/i)
    expect(p).toMatch(/getting serious/i)
  })
})

describe('character-wizard PROPERTIES_PROMPT', () => {
  it('extracts pronouns and aliases without inventing placeholders', () => {
    expect(PROPERTIES_PROMPT).toContain('pronouns')
    expect(PROPERTIES_PROMPT).toContain('aliases')
    expect(PROPERTIES_PROMPT.toLowerCase()).toContain('null')
    expect(PROPERTIES_PROMPT.toLowerCase()).toContain('placeholder')
    // Aliases are distinct from the private title/epithet.
    expect(PROPERTIES_PROMPT.toLowerCase()).toContain('title')
  })
})
