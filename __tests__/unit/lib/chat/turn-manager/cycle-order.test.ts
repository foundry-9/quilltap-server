/**
 * The cycle rotation: drawn once, then followed.
 *
 * Covers the draw (a weighted permutation, previous speaker held out of first
 * place), the read-or-draw chokepoint, the pure consumption helpers, and the
 * proof that matters — that a rotation, once drawn, is what selection returns
 * turn after turn instead of a fresh roll each time.
 */

import {
  drawCycleOrder,
  pickFromCycleOrder,
  resolveCycleOrder,
  parseCycleOrder,
  cycleCandidates,
  computeCycleOrderAfterMessage,
  computeCycleOrderAfterSkip,
  selectNextSpeaker,
  createInitialTurnState,
  calculateTurnStateFromHistory,
} from '@/lib/chat/turn-manager'
import type { TurnState } from '@/lib/chat/turn-manager'
import type { ChatParticipantBase, Character, ChatEvent, MessageEvent } from '@/lib/schemas/types'

const now = new Date().toISOString()

const makeCharacter = (id: string, overrides: Partial<Character> = {}): Character => ({
  id,
  userId: 'user-1',
  name: `Character ${id}`,
  title: null,
  description: null,
  personality: null,
  scenario: null,
  firstMessage: null,
  exampleDialogues: null,
  systemPrompts: [],
  avatarUrl: null,
  defaultImageId: null,
  defaultConnectionProfileId: null,
  sillyTavernData: null,
  isFavorite: false,
  talkativeness: 0.5,
  partnerLinks: [],
  tags: [],
  avatarOverrides: [],
  physicalDescriptions: [],
  createdAt: now,
  updatedAt: now,
  ...overrides,
})

const makeParticipant = (
  participantId: string,
  characterId: string,
  overrides: Partial<ChatParticipantBase> = {},
): ChatParticipantBase => ({
  id: participantId,
  type: 'CHARACTER',
  characterId,
  controlledBy: 'llm',
  connectionProfileId: null,
  imageProfileId: null,
  displayOrder: 0,
  isActive: true,
  status: 'active',
  hasHistoryAccess: true,
  joinScenario: null,
  createdAt: now,
  updatedAt: now,
  ...overrides,
})

const makeMessage = (
  id: string,
  role: 'USER' | 'ASSISTANT',
  participantId?: string | null,
): MessageEvent => ({
  type: 'message',
  id,
  role,
  content: `${role} message`,
  attachments: [],
  createdAt: now,
  participantId: participantId ?? null,
})

/** Three LLM seats with equal talkativeness unless a test says otherwise. */
const buildRoom = (overrides: Record<string, Partial<Character>> = {}) => {
  const participants = [
    makeParticipant('p1', 'char-1'),
    makeParticipant('p2', 'char-2'),
    makeParticipant('p3', 'char-3'),
  ]
  const characters = new Map<string, Character>([
    ['char-1', makeCharacter('char-1', overrides['char-1'])],
    ['char-2', makeCharacter('char-2', overrides['char-2'])],
    ['char-3', makeCharacter('char-3', overrides['char-3'])],
  ])
  return { participants, characters }
}

const stateWith = (overrides: Partial<TurnState> = {}): TurnState => ({
  ...createInitialTurnState(),
  ...overrides,
})

describe('drawCycleOrder', () => {
  it('draws every candidate exactly once', () => {
    const { participants, characters } = buildRoom()
    const order = drawCycleOrder({ participants, characters })

    expect(order).toHaveLength(3)
    expect([...order].sort()).toEqual(['p1', 'p2', 'p3'])
  })

  it('keeps the previous speaker out of first place', () => {
    const { participants, characters } = buildRoom()

    for (let i = 0; i < 50; i++) {
      const order = drawCycleOrder({ participants, characters, excludeFirst: 'p2' })
      expect(order[0]).not.toBe('p2')
      expect(order).toContain('p2')
    }
  })

  it('seats the only candidate first even when they just spoke', () => {
    const participants = [makeParticipant('p1', 'char-1')]
    const characters = new Map([['char-1', makeCharacter('char-1')]])

    expect(drawCycleOrder({ participants, characters, excludeFirst: 'p1' })).toEqual(['p1'])
  })

  it('weights the draw by talkativeness, per-chat override winning', () => {
    const { participants, characters } = buildRoom({
      'char-1': { talkativeness: 1 },
      'char-2': { talkativeness: 0.1 },
      'char-3': { talkativeness: 0.1 },
    })
    // p3's seat overrides its character down to nothing at all.
    participants[2] = makeParticipant('p3', 'char-3', { talkativeness: 0.1 })

    let p1First = 0
    for (let i = 0; i < 400; i++) {
      if (drawCycleOrder({ participants, characters })[0] === 'p1') p1First++
    }

    // p1 carries 1 of 1.2 total weight at the first draw — comfortably the
    // majority. The bound is loose enough not to flake, tight enough to fail if
    // the weighting were dropped (which would put p1 first about a third of the
    // time).
    expect(p1First).toBeGreaterThan(240)
  })

  it('leaves archived characters out of the rotation', () => {
    const { participants, characters } = buildRoom()
    characters.set('char-2', makeCharacter('char-2', { archivedAt: now }))

    expect(drawCycleOrder({ participants, characters })).not.toContain('p2')
  })

  it('keeps a seat whose character is not in the map', () => {
    const { participants } = buildRoom()
    // A user-driven seat's character is frequently absent from the map the
    // caller built from LLM candidates; it must still hold its place.
    const characters = new Map<string, Character>([['char-1', makeCharacter('char-1')]])

    expect([...drawCycleOrder({ participants, characters })].sort()).toEqual(['p1', 'p2', 'p3'])
  })
})

describe('pickFromCycleOrder', () => {
  it('takes the first member who can still speak', () => {
    const { participants, characters } = buildRoom()
    const state = stateWith({ spokenSinceUserTurn: ['p1'], lastSpeakerId: 'p1' })

    expect(pickFromCycleOrder(['p1', 'p3', 'p2'], participants, characters, state)).toBe('p3')
  })

  it('skips ids whose seat has left the room', () => {
    const { participants, characters } = buildRoom()
    const remaining = participants.filter(p => p.id !== 'p2')

    expect(pickFromCycleOrder(['p2', 'p3'], remaining, characters, stateWith())).toBe('p3')
  })

  it('returns null for an exhausted, empty, or missing order', () => {
    const { participants, characters } = buildRoom()
    const spent = stateWith({ spokenSinceUserTurn: ['p1', 'p2', 'p3'] })

    expect(pickFromCycleOrder(['p1', 'p2', 'p3'], participants, characters, spent)).toBeNull()
    expect(pickFromCycleOrder([], participants, characters, stateWith())).toBeNull()
    expect(pickFromCycleOrder(undefined, participants, characters, stateWith())).toBeNull()
  })
})

describe('resolveCycleOrder', () => {
  const buildRepos = () => {
    const update = jest.fn().mockResolvedValue(undefined)
    return { repos: { chats: { update } } as never, update }
  }

  it('draws and persists when nothing usable is on the row', async () => {
    const { participants, characters } = buildRoom()
    const { repos, update } = buildRepos()

    const order = await resolveCycleOrder(
      repos,
      { id: 'chat-1', participants },
      characters,
      stateWith(),
    )

    expect([...order].sort()).toEqual(['p1', 'p2', 'p3'])
    expect(update).toHaveBeenCalledWith('chat-1', {
      cycleOrderParticipantIds: JSON.stringify(order),
    })
  })

  it('returns a usable stored rotation untouched', async () => {
    const { participants, characters } = buildRoom()
    const { repos, update } = buildRepos()

    const order = await resolveCycleOrder(
      repos,
      { id: 'chat-1', participants },
      characters,
      stateWith({ cycleOrder: ['p3', 'p1', 'p2'] }),
    )

    expect(order).toEqual(['p3', 'p1', 'p2'])
    expect(update).not.toHaveBeenCalled()
  })

  it('seats a mid-cycle arrival at the back rather than redrawing', async () => {
    const { participants, characters } = buildRoom()
    participants.push(makeParticipant('p4', 'char-4'))
    characters.set('char-4', makeCharacter('char-4'))
    const { repos, update } = buildRepos()

    const order = await resolveCycleOrder(
      repos,
      { id: 'chat-1', participants },
      characters,
      stateWith({ cycleOrder: ['p2', 'p3'], spokenSinceUserTurn: ['p1'] }),
    )

    expect(order).toEqual(['p2', 'p3', 'p4'])
    expect(update).toHaveBeenCalledWith('chat-1', {
      cycleOrderParticipantIds: JSON.stringify(['p2', 'p3', 'p4']),
    })
  })

  it('stores nothing for a one-character room', async () => {
    const characters = new Map([['char-1', makeCharacter('char-1')]])
    const { repos, update } = buildRepos()

    const order = await resolveCycleOrder(
      repos,
      { id: 'chat-1', participants: [makeParticipant('p1', 'char-1')] },
      characters,
      stateWith(),
    )

    expect(order).toEqual([])
    expect(update).not.toHaveBeenCalled()
  })

  it('still returns the rotation when the write fails', async () => {
    const { participants, characters } = buildRoom()
    const update = jest.fn().mockRejectedValue(new Error('database is locked'))

    const order = await resolveCycleOrder(
      { chats: { update } } as never,
      { id: 'chat-1', participants },
      characters,
      stateWith(),
    )

    expect(order).toHaveLength(3)
  })
})

describe('cycle order consumption', () => {
  it('strikes the speaker when their message lands', () => {
    const message = makeMessage('m1', 'ASSISTANT', 'p2') as unknown as ChatEvent

    expect(computeCycleOrderAfterMessage(message, JSON.stringify(['p2', 'p3'])))
      .toBe(JSON.stringify(['p3']))
  })

  it('leaves the rotation alone for a message that is not a turn', () => {
    const stored = JSON.stringify(['p2', 'p3'])
    const whisper = {
      ...makeMessage('m1', 'ASSISTANT', 'p2'),
      targetParticipantIds: ['p3'],
    } as unknown as ChatEvent

    expect(computeCycleOrderAfterMessage(whisper, stored)).toBeNull()
    expect(computeCycleOrderAfterMessage(makeMessage('m2', 'ASSISTANT', null) as unknown as ChatEvent, stored)).toBeNull()
  })

  it('reports no change for someone already out of the rotation', () => {
    const message = makeMessage('m1', 'ASSISTANT', 'p9') as unknown as ChatEvent

    expect(computeCycleOrderAfterMessage(message, JSON.stringify(['p2']))).toBeNull()
  })

  it('takes a skipped seat out exactly as a message would', () => {
    expect(computeCycleOrderAfterSkip('p1', JSON.stringify(['p1', 'p2'])))
      .toBe(JSON.stringify(['p2']))
  })

  it('empties on the last consumption, which is the signal to redraw', () => {
    const message = makeMessage('m1', 'ASSISTANT', 'p3') as unknown as ChatEvent

    expect(computeCycleOrderAfterMessage(message, JSON.stringify(['p3']))).toBe('[]')
  })
})

describe('parseCycleOrder', () => {
  it('reads a stored rotation and shrugs off anything else', () => {
    expect(parseCycleOrder(JSON.stringify(['p1', 'p2']))).toEqual(['p1', 'p2'])
    expect(parseCycleOrder(JSON.stringify(['p1', 7, null]))).toEqual(['p1'])
    expect(parseCycleOrder('not json')).toEqual([])
    expect(parseCycleOrder('{}')).toEqual([])
    expect(parseCycleOrder(null)).toEqual([])
    expect(parseCycleOrder(undefined)).toEqual([])
  })
})

describe('cycleCandidates', () => {
  it('is the present, unarchived character seats', () => {
    const { participants, characters } = buildRoom()
    participants.push(makeParticipant('p-absent', 'char-4', { status: 'absent' }))
    characters.set('char-4', makeCharacter('char-4'))
    characters.set('char-3', makeCharacter('char-3', { archivedAt: now }))

    expect(cycleCandidates(participants, characters).map(p => p.id)).toEqual(['p1', 'p2'])
  })
})

describe('selection follows the rotation', () => {
  it('returns the rotation in order across a whole cycle, without re-rolling', () => {
    const { participants, characters } = buildRoom()
    const order = ['p3', 'p1', 'p2']
    const seen: string[] = []
    const state = stateWith({ cycleOrder: order })

    for (let turn = 0; turn < 3; turn++) {
      // Ask several times per turn: a stable answer is the whole point.
      const answers = new Set(
        Array.from({ length: 5 }, () =>
          selectNextSpeaker(participants, characters, state, null).nextSpeakerId),
      )
      expect(answers.size).toBe(1)

      const speaker = [...answers][0]!
      seen.push(speaker)
      state.spokenSinceUserTurn = [...state.spokenSinceUserTurn, speaker]
      state.lastSpeakerId = speaker
      state.cycleOrder = state.cycleOrder.filter(id => id !== speaker)
    }

    expect(seen).toEqual(order)
  })

  it('reports the rotation as the reason it picked', () => {
    const { participants, characters } = buildRoom()
    const result = selectNextSpeaker(
      participants,
      characters,
      stateWith({ cycleOrder: ['p2', 'p1', 'p3'] }),
      null,
    )

    expect(result.nextSpeakerId).toBe('p2')
    expect(result.reason).toBe('cycle_order')
    expect(result.cycleComplete).toBe(false)
  })

  it('lets the manual queue jump ahead of the rotation', () => {
    const { participants, characters } = buildRoom()
    const result = selectNextSpeaker(
      participants,
      characters,
      stateWith({ cycleOrder: ['p2', 'p1', 'p3'], queue: ['p3'] }),
      null,
    )

    expect(result.nextSpeakerId).toBe('p3')
    expect(result.reason).toBe('queue')
  })

  it('falls back to the weighted pick when no rotation is on file', () => {
    const { participants, characters } = buildRoom()
    const result = selectNextSpeaker(participants, characters, stateWith(), null)

    expect(result.reason).toBe('weighted_selection')
    expect(['p1', 'p2', 'p3']).toContain(result.nextSpeakerId)
  })

  it('pauses the chain when the rotation reaches a seat the human drives', () => {
    const { participants, characters } = buildRoom()
    participants[1] = makeParticipant('p2', 'char-2', { controlledBy: 'user' })

    const result = selectNextSpeaker(
      participants,
      characters,
      stateWith({ cycleOrder: ['p2', 'p1', 'p3'] }),
      'p2',
    )

    expect(result.nextSpeakerId).toBe('p2')
    expect(result.reason).toBe('user_turn')
  })
})

describe('calculateTurnStateFromHistory', () => {
  it('reads the rotation off the chat row without drawing one', () => {
    const { participants } = buildRoom()

    const state = calculateTurnStateFromHistory({
      messages: [makeMessage('m1', 'ASSISTANT', 'p1')],
      participants,
      userParticipantId: null,
      cycleOrderParticipantIds: JSON.stringify(['p2', 'p3']),
    })

    expect(state.cycleOrder).toEqual(['p2', 'p3'])
  })

  it('reads a missing rotation as none', () => {
    const { participants } = buildRoom()

    const state = calculateTurnStateFromHistory({
      messages: [],
      participants,
      userParticipantId: null,
    })

    expect(state.cycleOrder).toEqual([])
  })
})
