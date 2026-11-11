/**
 * Unit tests for the multi-character turn anchor.
 *
 * Every reply in a multi-character chat is anchored to the character whose
 * turn it is, by one of two routes chosen per connection profile: the
 * assistant `[Name]` prefill, or a prose instruction appended to the system
 * message. Until 4.9 the route was hardcoded by provider (Anthropic prose,
 * everything else prefill); see bug 68 for why that was wrong for Ollama.
 */

import {
  applyMultiCharacterTurnAnchor,
  GROUP_SCENE_DISCIPLINE,
} from '@/lib/services/chat-message/context-builder.service'

jest.mock('@/lib/logging/create-logger', () => ({
  createServiceLogger: jest.fn(() => ({
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  })),
}))

function baseMessages() {
  return [
    { role: 'system', content: 'You are Marie.' },
    { role: 'user', content: '[Charlie] *I nod and wait.*' },
  ]
}

describe('applyMultiCharacterTurnAnchor — prefill route', () => {
  it('appends an assistant message opening the turn with [Name]', () => {
    const messages = baseMessages()
    applyMultiCharacterTurnAnchor(messages, 'Marie', true)

    expect(messages).toHaveLength(3)
    expect(messages[2]).toEqual({
      role: 'assistant',
      content: '[Marie]',
      thoughtSignature: undefined,
      name: undefined,
    })
  })

  it('appends the group-scene discipline but not the identity instruction to the system message', () => {
    // Identity is anchored structurally by the [Name] prefill; the content
    // rules still have to ride in the system prompt.
    const messages = baseMessages()
    applyMultiCharacterTurnAnchor(messages, 'Marie', true)

    expect(messages[0].content).toMatch(/^You are Marie\./)
    expect(messages[0].content).toContain('GROUP-SCENE DISCIPLINE')
    expect(messages[0].content).not.toContain('Respond as Marie and ONLY Marie')
  })

  it('still pushes the prefill anchor when there is no system message', () => {
    const messages = [{ role: 'user', content: 'Hello' }]
    applyMultiCharacterTurnAnchor(messages, 'Marie', true)

    expect(messages).toHaveLength(2)
    expect(messages[1]).toMatchObject({ role: 'assistant', content: '[Marie]' })
  })
})

describe('applyMultiCharacterTurnAnchor — prose route', () => {
  it('adds no message, so the request still ends on the user turn', () => {
    // The load-bearing property for Anthropic 4.6+, which rejects a request
    // whose final message is role=assistant, and for Ollama, whose thinking
    // block is opened by the chat template at the start of the assistant turn.
    const messages = baseMessages()
    applyMultiCharacterTurnAnchor(messages, 'Marie', false)

    expect(messages).toHaveLength(2)
    expect(messages[messages.length - 1].role).toBe('user')
  })

  it('appends the identity instruction to the system message', () => {
    const messages = baseMessages()
    applyMultiCharacterTurnAnchor(messages, 'Marie', false)

    expect(messages[0].content).toMatch(/^You are Marie\./)
    expect(messages[0].content).toContain('multi-character scene')
    expect(messages[0].content).toContain('Respond as Marie and ONLY Marie')
  })

  it('appends the group-scene discipline after the identity instruction', () => {
    const messages = baseMessages()
    applyMultiCharacterTurnAnchor(messages, 'Marie', false)

    const content = messages[0].content
    expect(content).toContain('GROUP-SCENE DISCIPLINE')
    expect(content.indexOf('GROUP-SCENE DISCIPLINE')).toBeGreaterThan(
      content.indexOf('Respond as Marie and ONLY Marie')
    )
  })

  it('scopes the anti-chorus rule to the cast and keeps a plain yes to the user a complete turn', () => {
    // An earlier wording banned agreement outright and listed objection second
    // among the reasons to speak, which fed "the probation"
    // (docs/developer/features/prompt-trust-the-probation.md §8).
    expect(GROUP_SCENE_DISCIPLINE).toMatch(/agree-then-add with another character/)
    expect(GROUP_SCENE_DISCIPLINE).toMatch(/a plain yes to the user/)
    const speakLine = GROUP_SCENE_DISCIPLINE.split('\n').find(l => l.startsWith('- Speak to change something'))
    expect(speakLine).toBeDefined()
    expect(speakLine).toMatch(/warmth/)
    expect(speakLine!.indexOf('an action actually taken')).toBeLessThan(speakLine!.indexOf('objection'))
  })

  it('tells the cast it does not have to agree', () => {
    // A whole household met an armed intruder with paperwork, each character in
    // their own words (docs/developer/features/character-kind-and-roleplay-defaults.md §5.6).
    expect(GROUP_SCENE_DISCIPLINE).toContain('- The cast does not have to agree.')
    expect(GROUP_SCENE_DISCIPLINE).toMatch(/Never take a position only because everyone else has/)
  })

  it('keeps the discipline block free of anything a weaker model could parrot as a speaker tag', () => {
    expect(GROUP_SCENE_DISCIPLINE).not.toMatch(/\[[A-Z][a-z]+\]/)
  })

  it('never teaches the model to emit a [Name] tag of its own', () => {
    // Telling it to emit "[Marie] …" would contradict the always-on Identity
    // Reminder and hand weaker models the screenplay format they run away
    // with, writing the whole cast's turns.
    const messages = baseMessages()
    applyMultiCharacterTurnAnchor(messages, 'Marie', false)

    expect(messages[0].content).not.toContain('[Marie]')
  })

  it('is a no-op when there is no system message to append to', () => {
    const messages = [{ role: 'user', content: 'Hello' }]
    applyMultiCharacterTurnAnchor(messages, 'Marie', false)

    expect(messages).toEqual([{ role: 'user', content: 'Hello' }])
  })
})

describe('reanchorMultiCharacterTurn — a substitute follows its own prefill setting (#217)', () => {
  // Imported here so the module under test is the shared anchor, not the re-export.
  const { reanchorMultiCharacterTurn } = require('@/lib/chat/multi-character-anchor')

  function anchored(usePrefill: boolean) {
    const messages = baseMessages()
    applyMultiCharacterTurnAnchor(messages, 'Marie', usePrefill)
    return messages
  }

  it('strips the primary prefill and adds the prose instruction for a no-prefill substitute', () => {
    const fromPrefill = anchored(true)
    const result = reanchorMultiCharacterTurn(fromPrefill, 'Marie', false)
    expect(result).toEqual(anchored(false))
    expect(result[result.length - 1].role).toBe('user')
    // The input is untouched.
    expect(fromPrefill[fromPrefill.length - 1]).toEqual(expect.objectContaining({ role: 'assistant', content: '[Marie]' }))
  })

  it('swaps the prose instruction for a trailing prefill for a prefilling substitute', () => {
    const result = reanchorMultiCharacterTurn(anchored(false), 'Marie', true)
    expect(result.map((m: { role: string; content: string }) => ({ role: m.role, content: m.content })))
      .toEqual(anchored(true).map(m => ({ role: m.role, content: m.content })))
  })

  it('returns the same array when the anchor already matches', () => {
    const withPrefill = anchored(true)
    expect(reanchorMultiCharacterTurn(withPrefill, 'Marie', true)).toBe(withPrefill)
    const withProse = anchored(false)
    expect(reanchorMultiCharacterTurn(withProse, 'Marie', false)).toBe(withProse)
  })

  it('leaves a single-character array alone', () => {
    const messages = baseMessages()
    expect(reanchorMultiCharacterTurn(messages, 'Marie', true)).toBe(messages)
    expect(reanchorMultiCharacterTurn(messages, 'Marie', false)).toBe(messages)
  })
})
