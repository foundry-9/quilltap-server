/**
 * Tests for Summon From Lore's system-prompt meta-prompt.
 *
 * Locks in the shared generator directions so the import path cannot drift
 * away from the AI Wizard and the optimizer.
 */

import { SYSTEM_PROMPTS_PROMPT } from '@/lib/services/ai-import.service'
import {
  CONVERSATIONAL_VOICE_DIRECTION,
  TRUST_SAFEGUARDS_DIRECTION,
  COMPANION_TRUST_DISPOSITION,
  COMPANION_TRUST_DISPOSITION_GATE,
} from '@/lib/services/character-field-semantics'

describe('ai-import SYSTEM_PROMPTS_PROMPT', () => {
  it('carries the listening direction and the trust safeguards', () => {
    expect(SYSTEM_PROMPTS_PROMPT).toContain(CONVERSATIONAL_VOICE_DIRECTION)
    expect(SYSTEM_PROMPTS_PROMPT).toContain(TRUST_SAFEGUARDS_DIRECTION)
  })

  it('puts the gate sentence before the companion trust disposition', () => {
    const gate = SYSTEM_PROMPTS_PROMPT.indexOf(COMPANION_TRUST_DISPOSITION_GATE)
    expect(gate).toBeGreaterThan(-1)
    expect(SYSTEM_PROMPTS_PROMPT.indexOf(COMPANION_TRUST_DISPOSITION)).toBeGreaterThan(gate)
  })

  it('points the gate at the Prior Analysis relationships', () => {
    expect(SYSTEM_PROMPTS_PROMPT).toMatch(/relationships array in the Prior Analysis/)
  })

  it('allows prompts up to 600 words', () => {
    expect(SYSTEM_PROMPTS_PROMPT).toContain('300-600 words')
  })
})
