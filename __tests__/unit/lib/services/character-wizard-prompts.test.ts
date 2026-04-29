/**
 * Tests for the AI Wizard's per-field prompts.
 *
 * Locks in the vantage-point split between identity, description, personality,
 * and physical description so the wizard can't drift back into the older
 * "description = appearance + behaviour" conflation.
 */

import { FIELD_PROMPTS } from '@/lib/services/character-wizard.service'

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

  it('description prompt forbids physical appearance and points to physicalDescriptions', () => {
    const p = FIELD_PROMPTS.description
    // The old prompt had "Physical appearance (if visual reference available)"
    // as a positive bullet; that must be gone.
    expect(p).not.toMatch(/physical appearance \(if visual reference/i)
    expect(p).toMatch(/do not describe physical appearance/i)
    expect(p.toLowerCase()).toContain('physicaldescriptions')
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
})
