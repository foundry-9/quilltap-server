import { describe, expect, it } from '@jest/globals'

import {
  defaultMultiCharacterPrefill,
  isClaudeModelName,
  profileUsesNamePrefill,
  refusesAssistantPrefill,
} from '@/lib/llm/multi-character-prefill'

describe('defaultMultiCharacterPrefill', () => {
  it('is off for Anthropic — 4.6+ rejects a request ending on an assistant message', () => {
    expect(defaultMultiCharacterPrefill('ANTHROPIC')).toBe(false)
  })

  it('matches the provider case-insensitively', () => {
    expect(defaultMultiCharacterPrefill('anthropic')).toBe(false)
  })

  it('is on for every other provider — the historic behaviour', () => {
    for (const provider of ['OPENAI', 'OLLAMA', 'DEEPSEEK', 'GROK', 'Z_AI', 'OPENROUTER']) {
      expect(defaultMultiCharacterPrefill(provider)).toBe(true)
    }
  })

  it('is on when the provider is unknown', () => {
    expect(defaultMultiCharacterPrefill(null)).toBe(true)
    expect(defaultMultiCharacterPrefill(undefined)).toBe(true)
    expect(defaultMultiCharacterPrefill('')).toBe(true)
  })

  it('is off for a profile that will run a thinking turn, on any provider', () => {
    // Bug 85: DeepSeek 400s on continuing a thinking turn whose
    // `reasoning_content` it never saw; bug 68: Ollama never opens the
    // reasoning block behind a prefilled turn.
    for (const provider of ['DEEPSEEK', 'OLLAMA', 'OPENAI', 'Z_AI']) {
      expect(defaultMultiCharacterPrefill(provider, true)).toBe(false)
    }
    expect(defaultMultiCharacterPrefill(null, true)).toBe(false)
  })

  it('keeps the prefill for a thinking-capable provider that is not thinking', () => {
    // Bug 68 rejected a blanket provider rule for precisely this: the prefill
    // is the stronger anchor, and weak non-thinking models need it most.
    expect(defaultMultiCharacterPrefill('DEEPSEEK', false)).toBe(true)
    expect(defaultMultiCharacterPrefill('OLLAMA', false)).toBe(true)
  })

  it('leaves Anthropic off whether or not it is thinking', () => {
    // Anthropic's is the one genuine provider rule: it rejects an assistant
    // tail outright, thinking or not.
    expect(defaultMultiCharacterPrefill('ANTHROPIC', false)).toBe(false)
    expect(defaultMultiCharacterPrefill('ANTHROPIC', true)).toBe(false)
  })
})

describe('profileUsesNamePrefill', () => {
  it('honours an explicit true, even on a provider that defaults off', () => {
    expect(profileUsesNamePrefill({ provider: 'ANTHROPIC', multiCharacterPrefill: true })).toBe(true)
  })

  it('honours an explicit false, even on a provider that defaults on', () => {
    expect(profileUsesNamePrefill({ provider: 'OLLAMA', multiCharacterPrefill: false })).toBe(false)
  })

  it('falls back to the provider default when the profile never chose', () => {
    // Rows older than add-profile-multi-character-prefill-field-v1, and
    // profiles imported from a pre-4.9 bundle, arrive with null here.
    expect(profileUsesNamePrefill({ provider: 'ANTHROPIC', multiCharacterPrefill: null })).toBe(false)
    expect(profileUsesNamePrefill({ provider: 'OPENAI', multiCharacterPrefill: null })).toBe(true)
    expect(profileUsesNamePrefill({ provider: 'ANTHROPIC' })).toBe(false)
    expect(profileUsesNamePrefill({ provider: 'OPENAI' })).toBe(true)
  })

  it('lets a stored true outrank the thinking default', () => {
    // The tri-state exists so the user may overrule us. Bug 85 seeds the
    // right default and warns in the editor; it does not veto.
    expect(
      profileUsesNamePrefill({ provider: 'DEEPSEEK', multiCharacterPrefill: true }, true)
    ).toBe(true)
  })

  it('falls back to the thinking-aware default when the profile never chose', () => {
    expect(profileUsesNamePrefill({ provider: 'DEEPSEEK' }, true)).toBe(false)
    expect(profileUsesNamePrefill({ provider: 'DEEPSEEK' }, false)).toBe(true)
    expect(profileUsesNamePrefill({ provider: 'DEEPSEEK', multiCharacterPrefill: null }, true)).toBe(
      false
    )
  })

  it('does not mistake false for absent', () => {
    // The whole point of the tri-state: an Anthropic profile the user
    // deliberately turned ON must not be silently read back as OFF, and a
    // non-Anthropic profile turned OFF must not be read back as ON.
    expect(profileUsesNamePrefill({ provider: 'OPENAI', multiCharacterPrefill: false })).toBe(false)
    expect(profileUsesNamePrefill({ provider: 'ANTHROPIC', multiCharacterPrefill: true })).toBe(true)
  })
})

describe('Claude through a gateway', () => {
  // The setup wizard, given OpenRouter and anthropic/claude-sonnet-5, created
  // a profile with the prefill on, and every multi-character turn — the
  // opening greeting included — failed with "This model does not support
  // assistant message prefill". The refusal travels with the model.
  it('recognises Claude model ids as each gateway spells them', () => {
    for (const model of [
      'anthropic/claude-sonnet-5',
      '~anthropic/claude-sonnet-latest',
      'anthropic/claude-sonnet-4.6:batch',
      'claude-sonnet-4-6',
      'us.anthropic.claude-opus-4-7',
      'Claude-3-Haiku',
    ]) {
      expect(isClaudeModelName(model)).toBe(true)
    }
  })

  it('does not mistake other models for Claude', () => {
    for (const model of ['openai/gpt-5-mini', 'claudette:7b', 'anthropic-ish-llama', '', null, undefined]) {
      expect(isClaudeModelName(model)).toBe(false)
    }
  })

  it('defaults the prefill off for Claude on any provider', () => {
    expect(defaultMultiCharacterPrefill('OPENROUTER', false, 'anthropic/claude-sonnet-5')).toBe(false)
    expect(defaultMultiCharacterPrefill('NANOGPT', false, 'claude-sonnet-4-6')).toBe(false)
    expect(defaultMultiCharacterPrefill('OPENAI_COMPATIBLE', false, 'claude-opus-4-7')).toBe(false)
  })

  it('keeps the prefill on for a gateway serving anything else', () => {
    expect(defaultMultiCharacterPrefill('OPENROUTER', false, 'openai/gpt-5-mini')).toBe(true)
    // No model chosen yet: only the provider rule can speak.
    expect(defaultMultiCharacterPrefill('OPENROUTER')).toBe(true)
  })

  it('reports the refusal for the editor warning', () => {
    expect(refusesAssistantPrefill('ANTHROPIC')).toBe(true)
    expect(refusesAssistantPrefill('OPENROUTER', 'anthropic/claude-sonnet-5')).toBe(true)
    expect(refusesAssistantPrefill('OPENROUTER', 'openai/gpt-5-mini')).toBe(false)
  })

  it('resolves an unset gateway Claude profile to no prefill', () => {
    expect(
      profileUsesNamePrefill({ provider: 'OPENROUTER', modelName: 'anthropic/claude-sonnet-5', multiCharacterPrefill: null })
    ).toBe(false)
    // A stored choice still wins.
    expect(
      profileUsesNamePrefill({ provider: 'OPENROUTER', modelName: 'anthropic/claude-sonnet-5', multiCharacterPrefill: true })
    ).toBe(true)
  })
})
