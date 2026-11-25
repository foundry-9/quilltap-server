/**
 * Reasoning headroom and the profile output ceiling.
 *
 * A cheap-LLM caller that asks for a profile's whole output budget (128k on a
 * DeepSeek-class profile) must not be pushed past it by the headroom, or a
 * provider capped at 131,072 refuses every call with a 400.
 */

import { describe, it, expect } from '@jest/globals'
import { REASONING_HEADROOM_TOKENS, withReasoningHeadroom } from '@/lib/llm/reasoning-headroom'
import { selectionFromProfile } from '@/lib/llm/cheap-llm'
import { resolveMaxTokens } from '@/lib/llm/model-context-data'
import type { ConnectionProfile } from '@/lib/schemas/types'

describe('withReasoningHeadroom', () => {
  it('adds the full headroom when no ceiling is known', () => {
    expect(withReasoningHeadroom(2048)).toBe(2048 + REASONING_HEADROOM_TOKENS)
    expect(withReasoningHeadroom(2048, undefined)).toBe(2048 + REASONING_HEADROOM_TOKENS)
  })

  it('adds the full headroom when the ceiling leaves room for it', () => {
    expect(withReasoningHeadroom(2048, 128000)).toBe(2048 + REASONING_HEADROOM_TOKENS)
  })

  it('stops the headroom at the ceiling', () => {
    expect(withReasoningHeadroom(128000, 128000)).toBe(128000)
    expect(withReasoningHeadroom(126000, 128000)).toBe(128000)
  })

  it('never cuts below the answer budget the caller asked for', () => {
    expect(withReasoningHeadroom(8000, 4096)).toBe(8000)
  })

  it('ignores a nonsensical ceiling', () => {
    expect(withReasoningHeadroom(2048, 0)).toBe(2048 + REASONING_HEADROOM_TOKENS)
    expect(withReasoningHeadroom(2048, Number.NaN)).toBe(2048 + REASONING_HEADROOM_TOKENS)
  })
})

describe('selectionFromProfile output ceiling', () => {
  const base = {
    id: 'profile-1',
    name: 'Test',
    provider: 'OPENAI',
    modelName: 'some-model',
    parameters: {},
  } as unknown as ConnectionProfile

  it('carries an explicit profile maxTokens', () => {
    const selection = selectionFromProfile({ ...base, maxTokens: 120000 } as ConnectionProfile)
    expect(selection.maxOutputTokens).toBe(120000)
  })

  it('carries the same ceiling resolveMaxTokens reads', () => {
    const profile = { ...base, maxTokens: null, modelClass: 'Deep' } as unknown as ConnectionProfile
    expect(selectionFromProfile(profile).maxOutputTokens).toBe(resolveMaxTokens(profile))
  })
})
