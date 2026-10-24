/**
 * recompileCharacterSeats: every LLM-controlled, non-removed seat of the
 * character is recompiled (narrowed by seatFilter), each touched chat is
 * published once, and a failing seat is logged and skipped.
 */

const mockCompile = jest.fn()
const mockPublish = jest.fn()
const mockFindByCharacterId = jest.fn()

jest.mock('@/lib/logging/create-logger', () => ({
  createServiceLogger: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}))
jest.mock('@/lib/repositories/factory', () => ({
  getRepositories: () => ({ chats: { findByCharacterId: (...a: unknown[]) => mockFindByCharacterId(...a) } }),
}))
jest.mock('@/lib/services/system-prompt-compiler/compiler', () => ({
  compileIdentityStackForParticipant: (...a: unknown[]) => mockCompile(...a),
}))
jest.mock('@/lib/realtime/bus', () => ({ publishRealtime: (...a: unknown[]) => mockPublish(...a) }))

import { recompileCharacterSeats } from '@/lib/services/system-prompt-compiler/character-fanout'

const seat = (id: string, extra: Record<string, unknown> = {}) => ({
  id, characterId: 'c-1', controlledBy: 'llm', status: 'active', ...extra,
})

describe('recompileCharacterSeats', () => {
  beforeEach(() => jest.clearAllMocks())

  it('recompiles the character\'s LLM seats only, publishing each touched chat', async () => {
    mockFindByCharacterId.mockResolvedValue([
      { id: 'chat-a', participants: [seat('s1'), seat('s2', { controlledBy: 'user' }), seat('s3', { status: 'removed' }), seat('s4', { characterId: 'other' })] },
      { id: 'chat-b', participants: [seat('s5', { controlledBy: 'user' })] },
    ])
    const result = await recompileCharacterSeats('c-1', { reason: 'test' })
    expect(result).toEqual({ chatsTouched: 1, seatsRecompiled: 1 })
    expect(mockCompile).toHaveBeenCalledTimes(1)
    expect(mockCompile.mock.calls[0][1]).toBe('s1')
    expect(mockPublish).toHaveBeenCalledWith('chats', 'chat-a')
    expect(mockPublish).toHaveBeenCalledTimes(1)
  })

  it('honours seatFilter and keeps going past a failing seat', async () => {
    mockFindByCharacterId.mockResolvedValue([
      { id: 'chat-a', participants: [seat('s1', { tag: 'x' }), seat('s2', { tag: 'x' }), seat('s3')] },
    ])
    mockCompile.mockRejectedValueOnce(new Error('boom'))
    const result = await recompileCharacterSeats('c-1', {
      reason: 'test',
      seatFilter: (p) => (p as unknown as { tag?: string }).tag === 'x',
    })
    expect(mockCompile.mock.calls.map((c) => c[1])).toEqual(['s1', 's2'])
    expect(result).toEqual({ chatsTouched: 1, seatsRecompiled: 1 })
  })

  it('fails soft when the chats cannot be listed', async () => {
    mockFindByCharacterId.mockRejectedValue(new Error('db down'))
    await expect(recompileCharacterSeats('c-1', { reason: 'test' })).resolves.toEqual({ chatsTouched: 0, seatsRecompiled: 0 })
  })
})
