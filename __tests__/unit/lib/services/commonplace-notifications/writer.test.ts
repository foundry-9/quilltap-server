/**
 * Unit tests for the Commonplace Book whisper builders — focused on the
 * persona (steampunk) vs. LLM (plain second-person) split, and the
 * fold-refresh `relevantConversations` part added in the recall overhaul.
 */

import { describe, it, expect } from '@jest/globals'
import {
  buildCommonplacePersonaWhisper,
  buildCommonplaceLLMContext,
} from '@/lib/services/commonplace-notifications/writer'

describe('commonplace-notifications writer', () => {
  it('renders the relevantConversations part in the persona whisper', () => {
    const block = '### Relevant Past Conversations\n\n#### Tea (`chat-1`)'
    const out = buildCommonplacePersonaWhisper({ relevantConversations: block })
    expect(out).toContain(block)
    // Persona voicing wraps the block (steampunk framing line present).
    expect(out).toContain('Commonplace Book')
  })

  it('renders the relevantConversations part in the LLM context (plain, no persona)', () => {
    const block = '### Relevant Past Conversations\n\n#### Tea (`chat-1`)'
    const out = buildCommonplaceLLMContext({ relevantConversations: block })
    expect(out).toContain(block)
    expect(out).toContain('past conversations that bear on the present')
    // No steampunk meta-narrative leaks into the LLM body.
    expect(out).not.toContain('Commonplace Book')
  })

  it('returns empty string when no parts are set', () => {
    expect(buildCommonplacePersonaWhisper({})).toBe('')
    expect(buildCommonplaceLLMContext({})).toBe('')
  })

  it('keeps each non-empty section and drops empty ones', () => {
    const out = buildCommonplaceLLMContext({
      currentState: 'state here',
      relevantConversations: '### Relevant Past Conversations\n\n#### A (`x`)',
    })
    expect(out).toContain('state here')
    expect(out).toContain('#### A (`x`)')
    // recap / relevant / interChar / knowledge absent → their framing absent.
    expect(out).not.toContain('You remember the gist')
  })
})
