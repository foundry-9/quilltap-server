/**
 * Per-turn decisions made before a character's context is built
 * (`turn-preparation.service.ts`) and the turn's effect ceiling
 * (`resolveTurnEffectCeiling`, `turn-tools.service.ts`).
 */

jest.mock('@/lib/logging/create-logger', () => {
  const logger = () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), child: jest.fn() })
  return { createServiceLogger: jest.fn(logger), createLogger: jest.fn(logger) }
})

jest.mock('@/lib/plugins/provider-validation', () => ({
  requiresApiKey: jest.fn((provider: string) => provider === 'OPENAI'),
  acceptsApiKey: jest.fn((provider: string) => provider !== 'OLLAMA'),
}))

jest.mock('@/lib/services/prospero-notifications/writer', () => ({
  loadProsperoProjectContext: jest.fn(async () => ({ name: 'Project' })),
  loadProsperoGeneralContext: jest.fn(async () => ({ stores: [] })),
  postProsperoContextAnnouncement: jest.fn(async () => ({ id: 'brief', type: 'message' })),
  postProsperoGroupContextWhisper: jest.fn(async () => ({ id: 'whisper', type: 'message' })),
}))

import {
  reinjectProsperoContext,
  resolveContextCompressionSettings,
  resolveTurnApiKey,
  spendFullContextRequest,
} from '@/lib/services/chat-message/turn-preparation.service'
import { resolveTurnEffectCeiling } from '@/lib/services/chat-message/turn-tools.service'
import { postProsperoContextAnnouncement, postProsperoGroupContextWhisper } from '@/lib/services/prospero-notifications/writer'

describe('resolveTurnApiKey', () => {
  it('refuses a provider that requires a key and has none', () => {
    expect(() => resolveTurnApiKey({ provider: 'OPENAI' } as never, '')).toThrow('No API key configured')
  })

  it('a held post is recorded without one: no provider will be called', () => {
    expect(resolveTurnApiKey({ provider: 'OPENAI' } as never, '', { held: true })).toBe('')
  })

  it('forwards a key a provider merely accepts (bug 81)', () => {
    expect(resolveTurnApiKey({ provider: 'OPENAI_COMPATIBLE' } as never, 'sk-hosted')).toBe('sk-hosted')
  })

  it('drops a key a provider cannot take', () => {
    expect(resolveTurnApiKey({ provider: 'OLLAMA' } as never, 'stray')).toBe('')
  })

  it('the Courier carries no key and needs none', () => {
    expect(resolveTurnApiKey({ provider: 'OPENAI', transport: 'courier' } as never, '')).toBe('')
  })
})

describe('resolveContextCompressionSettings', () => {
  it('falls back to the schema defaults', () => {
    expect(resolveContextCompressionSettings(null)).toEqual({
      enabled: true,
      windowSize: 5,
      compressionTargetTokens: 800,
      systemPromptTargetTokens: 1500,
      projectContextReinjectInterval: 5,
    })
  })

  it('returns the operator\'s own settings', () => {
    const own = { enabled: false, windowSize: 3, compressionTargetTokens: 500, systemPromptTargetTokens: 900, projectContextReinjectInterval: 0 }
    expect(resolveContextCompressionSettings({ contextCompressionSettings: own } as never)).toBe(own)
  })
})

describe('spendFullContextRequest', () => {
  const repos = { chats: { update: jest.fn() } }
  beforeEach(() => jest.clearAllMocks())

  it('spends a standing request', async () => {
    expect(await spendFullContextRequest(repos as never, { id: 'c', requestFullContextOnNextMessage: true }, false)).toBe(true)
    expect(repos.chats.update).toHaveBeenCalledWith('c', { requestFullContextOnNextMessage: false })
  })

  it('a held post leaves it for the turn the operator asks for', async () => {
    expect(await spendFullContextRequest(repos as never, { id: 'c', requestFullContextOnNextMessage: true }, true)).toBe(false)
    expect(repos.chats.update).not.toHaveBeenCalled()
  })
})

describe('reinjectProsperoContext', () => {
  const messages = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `m${i}`, type: 'message' })) as never[]
  beforeEach(() => jest.clearAllMocks())

  const run = (existingMessages: never[], over: { concurrentFollower?: boolean; reinjectInterval?: number } = {}) =>
    reinjectProsperoContext({
      chatId: 'c',
      project: { id: 'p' },
      existingMessages,
      reinjectInterval: over.reinjectInterval ?? 5,
      concurrentFollower: over.concurrentFollower ?? false,
      character: { id: 'char' },
      characterParticipant: { id: 'seat' },
    })

  it('briefs on the cadence and splices both posts into the context', async () => {
    const existing = messages(10)
    await run(existing)
    expect(postProsperoContextAnnouncement).toHaveBeenCalledTimes(1)
    expect(postProsperoGroupContextWhisper).toHaveBeenCalledWith({ chatId: 'c', targetParticipantId: 'seat', characterId: 'char' })
    expect(existing).toHaveLength(12)
  })

  it('stays quiet off the cadence, on an empty chat, or with the interval off', async () => {
    await run(messages(7))
    await run(messages(0))
    await run(messages(10), { reinjectInterval: 0 })
    expect(postProsperoContextAnnouncement).not.toHaveBeenCalled()
    expect(postProsperoGroupContextWhisper).not.toHaveBeenCalled()
  })

  it('a concurrent storyteller follower posts only its own whisper', async () => {
    await run(messages(5), { concurrentFollower: true })
    expect(postProsperoContextAnnouncement).not.toHaveBeenCalled()
    expect(postProsperoGroupContextWhisper).toHaveBeenCalledTimes(1)
  })
})

describe('resolveTurnEffectCeiling', () => {
  const room = (allowed: number) => ({ id: 'c', chatType: 'autonomous', runDestructiveToolsAllowed: allowed }) as never

  it('a Salon chat keeps the storyteller ceiling (or none)', () => {
    expect(resolveTurnEffectCeiling({ id: 'c', chatType: 'salon' } as never, null, undefined)).toBeUndefined()
    expect(resolveTurnEffectCeiling({ id: 'c', chatType: 'salon' } as never, null, 'read')).toBe('read')
  })

  it('an autonomous room without permission drops to write', () => {
    expect(resolveTurnEffectCeiling(room(0), null, undefined)).toBe('write')
  })

  it('an autonomous room with permission keeps destroy', () => {
    expect(resolveTurnEffectCeiling(room(1), null, undefined)).toBeUndefined()
  })

  it('the user-level policy is a ceiling over the room flag', () => {
    const settings = { autonomousRoomSettings: { destructiveToolPolicy: 'always_refuse' } } as never
    expect(resolveTurnEffectCeiling(room(1), settings, undefined)).toBe('write')
  })

  it('never raises a lower storyteller ceiling', () => {
    expect(resolveTurnEffectCeiling(room(0), null, 'read')).toBe('read')
  })
})
