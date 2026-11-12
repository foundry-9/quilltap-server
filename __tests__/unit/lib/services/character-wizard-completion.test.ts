/**
 * The AI Wizard's completion budget and answer check.
 *
 * Reasoning models that think by default (Claude Sonnet 5.5 and kin) spend
 * part of `max_tokens` thinking; at a 500-token field budget fields came back
 * cut off mid-sentence and stored as if whole, or empty ("No response from
 * model"). Every Wizard call now gets reasoning headroom, and a reply cut off
 * by the ceiling is reported as a failed field.
 */

import {
  WIZARD_REASONING_HEADROOM,
  generateField,
  requireCompleteWizardAnswer,
  wizardCompletionBudget,
} from '@/lib/services/character-wizard.service'

describe('wizardCompletionBudget', () => {
  it('adds the reasoning headroom to the answer budget', () => {
    expect(WIZARD_REASONING_HEADROOM).toBeGreaterThanOrEqual(2000)
    expect(wizardCompletionBudget(500)).toBe(500 + WIZARD_REASONING_HEADROOM)
  })
})

describe('requireCompleteWizardAnswer', () => {
  it('returns the content of a reply that finished', () => {
    expect(requireCompleteWizardAnswer({ content: 'Keeper of Gannet Rock', finishReason: 'end_turn' }, 'field')).toBe(
      'Keeper of Gannet Rock',
    )
  })

  it('refuses a reply cut off by the token ceiling, even with text in it', () => {
    expect(() =>
      requireCompleteWizardAnswer({ content: 'Her husband drowned,', finishReason: 'max_tokens' }, 'field'),
    ).toThrow(/ran out of room/)
    expect(() => requireCompleteWizardAnswer({ content: 'x', finishReason: 'length' }, 'field')).toThrow(/ran out of room/)
  })

  it('reports an empty reply with its finish reason', () => {
    expect(() => requireCompleteWizardAnswer({ content: '', finishReason: 'refusal' }, 'field')).toThrow(
      'No response from model (finish reason: refusal)',
    )
    expect(() => requireCompleteWizardAnswer(null, 'field')).toThrow('No response from model')
  })
})

describe('generateField', () => {
  function providerReturning(response: { content: string; finishReason: string }) {
    return { sendMessage: jest.fn().mockResolvedValue(response) }
  }

  it('sends the answer budget plus reasoning headroom as max_tokens', async () => {
    const provider = providerReturning({ content: '  A keeper.  ', finishReason: 'end_turn' })
    const out = await generateField(provider as never, 'key', 'claude-sonnet-5-5', 'ctx', 'prompt', 500)
    expect(out).toBe('A keeper.')
    expect(provider.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ maxTokens: 500 + WIZARD_REASONING_HEADROOM }),
      'key',
    )
  })

  it('throws instead of returning a truncated field', async () => {
    const provider = providerReturning({ content: 'She is in her fifties and a widow. Her husband drowned,', finishReason: 'max_tokens' })
    await expect(
      generateField(provider as never, 'key', 'claude-sonnet-5-5', 'ctx', 'prompt', 500),
    ).rejects.toThrow(/ran out of room/)
  })
})
