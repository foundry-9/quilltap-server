/**
 * Agent Mode flavours: the cascade decides whether Agent Mode is on, the
 * responding character's kind decides what it means.
 *
 * @jest-environment node
 */

jest.mock('@/lib/logging/create-logger', () => {
  const logger = () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() })
  return { createServiceLogger: jest.fn(logger), createLogger: jest.fn(logger) }
})

import {
  buildAgentModeInstructions,
  buildForceFinalMessage,
  resolveAgentModeSetting,
} from '@/lib/services/chat-message/agent-mode-resolver.service'

const settings = { agentModeSettings: { maxTurns: 7, defaultEnabled: true } } as never

describe('resolveAgentModeSetting flavour', () => {
  it('a roleplay character gets the in-character flavour', () => {
    const r = resolveAgentModeSetting(null, null, { kind: 'roleplay' } as never, settings)
    expect(r).toMatchObject({ enabled: true, maxTurns: 7, enabledSource: 'global', flavor: 'in-character' })
  })

  it('a character from a pre-kind vault counts as roleplay', () => {
    const r = resolveAgentModeSetting(null, null, {} as never, settings)
    expect(r.flavor).toBe('in-character')
  })

  it('an assistant character gets the research flavour', () => {
    const r = resolveAgentModeSetting(null, null, { kind: 'assistant' } as never, settings)
    expect(r.flavor).toBe('research')
  })

  it('the cascade still decides only whether it is on', () => {
    const r = resolveAgentModeSetting(
      { id: 'c', agentModeEnabled: false } as never,
      null,
      { kind: 'assistant', defaultAgentModeEnabled: true } as never,
      settings,
    )
    expect(r).toMatchObject({ enabled: false, enabledSource: 'chat', flavor: 'research' })
  })
})

describe('buildAgentModeInstructions', () => {
  it('in-character: tools are things done in the scene, the turn stays in prose, no submit tool', () => {
    const text = buildAgentModeInstructions(6, 'in-character')
    expect(text.startsWith('## Acting in the scene')).toBe(true)
    expect(text).toContain('things you do in the story')
    expect(text).toContain('in character, in prose')
    expect(text).toContain('**6 tool steps**')
    expect(text).not.toContain('submit_final_response')
    expect(text).not.toContain('Think step-by-step')
    expect(text).not.toContain('structured summary')
  })

  it('research: the assistant loop with submit_final_response', () => {
    const text = buildAgentModeInstructions(6, 'research')
    expect(text.startsWith('## Agent Mode Instructions')).toBe(true)
    expect(text).toContain('submit_final_response')
    expect(text).toContain('**6 tool iterations**')
  })
})

describe('buildForceFinalMessage', () => {
  it('in-character asks for the turn in prose and names no tool', () => {
    const text = buildForceFinalMessage('in-character')
    expect(text).toContain('Do not call any more tools')
    expect(text).toContain('in character and in prose')
    expect(text).not.toContain('submit_final_response')
  })

  it('research asks for submit_final_response', () => {
    expect(buildForceFinalMessage('research')).toContain('submit_final_response')
  })
})
