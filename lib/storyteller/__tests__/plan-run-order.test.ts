/**
 * planStorytellerRun — speaking order. Without `keepOrder` the chosen bids run
 * in the turn manager's rotation; with it (the operator dragged the board's
 * cards), they run exactly as given, and an all-at-once round's Act / Destroy
 * tail follows that order too.
 */

import { planStorytellerRun } from '../round.service'
import { getRepositories } from '@/lib/repositories/factory'
import { resolveCycleOrder } from '@/lib/chat/turn-manager/cycle-order'
import type { StorytellerBid, StorytellerRound } from '@/lib/schemas/storyteller.types'

jest.mock('@/lib/logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}))
jest.mock('@/lib/repositories/factory', () => ({ getRepositories: jest.fn() }))
jest.mock('@/lib/realtime/bus', () => ({ publishRealtime: jest.fn() }))
jest.mock('@/lib/chat/turn-manager/room-characters', () => ({ loadRoomCharacters: jest.fn(async () => new Map()) }))
jest.mock('@/lib/chat/turn-manager/state', () => ({ calculateTurnStateFromHistory: jest.fn(() => ({})) }))
jest.mock('@/lib/chat/turn-manager/cycle-order', () => ({ resolveCycleOrder: jest.fn() }))
jest.mock('@/lib/chat/turn-manager/utils', () => ({ findUserParticipant: jest.fn(() => null) }))

const mockGetRepositories = getRepositories as jest.Mock
const mockResolveCycleOrder = resolveCycleOrder as jest.Mock

function bid(participantId: string, tier: StorytellerBid['tier']): StorytellerBid {
  return {
    participantId,
    characterId: `char-${participantId}`,
    characterName: participantId.toUpperCase(),
    status: 'bid',
    tier,
    statedTier: tier,
    tierRaised: false,
    tools: [],
    talkativeness: 0.5,
    silent: false,
  }
}

function setup(bids: StorytellerBid[], rotation: string[]) {
  const round: StorytellerRound = {
    id: 'round-1',
    chatId: 'chat-1',
    triggerMessageId: null,
    status: 'open',
    bids,
    createdAt: '2026-10-22T00:00:00.000Z',
    updatedAt: '2026-10-22T00:00:00.000Z',
  }
  mockGetRepositories.mockReturnValue({
    storytellerRounds: { findById: jest.fn(async () => round) },
    chats: {
      findById: jest.fn(async () => ({ id: 'chat-1', participants: bids.map((b) => ({ id: b.participantId })) })),
      getMessages: jest.fn(async () => []),
    },
  })
  mockResolveCycleOrder.mockResolvedValue(rotation)
}

describe('planStorytellerRun speaking order', () => {
  beforeEach(() => jest.clearAllMocks())

  it('sorts the chosen bids into rotation order when the board was not rearranged', async () => {
    setup([bid('a', 'simple'), bid('b', 'simple'), bid('c', 'simple')], ['c', 'a', 'b'])
    const { turns } = await planStorytellerRun({
      chatId: 'chat-1', roundId: 'round-1', participantIds: ['a', 'b', 'c'], order: 'sequential',
    })
    expect(turns.map((t) => t.participantId)).toEqual(['c', 'a', 'b'])
  })

  it("keeps the operator's arrangement and never consults the rotation", async () => {
    setup([bid('a', 'simple'), bid('b', 'simple'), bid('c', 'simple')], ['c', 'a', 'b'])
    const { turns } = await planStorytellerRun({
      chatId: 'chat-1', roundId: 'round-1', participantIds: ['b', 'a', 'c'], order: 'sequential', keepOrder: true,
    })
    expect(turns.map((t) => t.participantId)).toEqual(['b', 'a', 'c'])
    expect(mockResolveCycleOrder).not.toHaveBeenCalled()
  })

  it("runs all-at-once seats first, then the Act tail in the operator's order", async () => {
    setup([bid('a', 'act'), bid('b', 'simple'), bid('c', 'act'), bid('d', 'lookup')], ['a', 'b', 'c', 'd'])
    const { turns } = await planStorytellerRun({
      chatId: 'chat-1', roundId: 'round-1', participantIds: ['c', 'd', 'a', 'b'], order: 'simultaneous', keepOrder: true,
    })
    expect(turns.map((t) => [t.participantId, t.concurrent])).toEqual([
      ['d', true], ['b', true], ['c', false], ['a', false],
    ])
  })
})
