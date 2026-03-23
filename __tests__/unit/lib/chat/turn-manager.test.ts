import { describe, it, expect, jest } from '@jest/globals'
import {
  createInitialTurnState,
  calculateTurnStateFromHistory,
  selectNextSpeaker,
  updateTurnStateAfterMessage,
  addToQueue,
  removeFromQueue,
  popFromQueue,
  nudgeParticipant,
  resetCycleForUserSkip,
  getQueuePosition,
  getSelectionExplanation,
  findUserParticipant,
  getActiveCharacterParticipants,
  isMultiCharacterChat,
} from '@/lib/chat/turn-manager'
import type { ChatParticipantBase, Character, MessageEvent } from '@/lib/schemas/types'

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
  personaLinks: [],
  tags: [],
  avatarOverrides: [],
  physicalDescriptions: [],
  createdAt: now,
  updatedAt: now,
  ...overrides,
})

const makeCharacterParticipant = (participantId: string, characterId: string, overrides: Partial<ChatParticipantBase> = {}): ChatParticipantBase => ({
  id: participantId,
  type: 'CHARACTER',
  characterId,
  controlledBy: 'llm',
  connectionProfileId: null,
  imageProfileId: null,
  systemPromptOverride: null,
  displayOrder: 0,
  isActive: true,
  status: 'active',
  hasHistoryAccess: true,
  joinScenario: null,
  createdAt: now,
  updatedAt: now,
  ...overrides,
})

const makeUserControlledParticipant = (participantId: string, characterId: string, overrides: Partial<ChatParticipantBase> = {}): ChatParticipantBase => ({
  id: participantId,
  type: 'CHARACTER',
  characterId,
  controlledBy: 'user',
  connectionProfileId: null,
  imageProfileId: null,
  systemPromptOverride: null,
  displayOrder: 0,
  isActive: true,
  status: 'active',
  hasHistoryAccess: true,
  joinScenario: null,
  createdAt: now,
  updatedAt: now,
  ...overrides,
})

const makeMessage = (id: string, role: 'USER' | 'ASSISTANT', participantId?: string | null): MessageEvent => ({
  type: 'message',
  id,
  role,
  content: `${role} message` as string,
  attachments: [],
  createdAt: now,
  participantId: participantId ?? null,
})

describe('turn manager state', () => {
  it('builds state from history and tracks speakers since last user turn', () => {
    const participants = [
      makeCharacterParticipant('p1', 'char-1'),
      makeCharacterParticipant('p2', 'char-2'),
    ]
    const messages = [
      makeMessage('m-user', 'USER'),
      makeMessage('m-1', 'ASSISTANT', 'p1'),
      makeMessage('m-2', 'ASSISTANT', 'p2'),
    ]

    const state = calculateTurnStateFromHistory({ messages, participants, userParticipantId: null })
    expect(state.spokenSinceUserTurn).toEqual(['p1', 'p2'])
    expect(state.lastSpeakerId).toBe('p2')
  })

  it('selects next speaker from queue before random selection', () => {
    const participants = [makeCharacterParticipant('p1', 'char-1'), makeCharacterParticipant('p2', 'char-2')]
    const characters = new Map<string, Character>([
      ['char-1', makeCharacter('char-1')],
      ['char-2', makeCharacter('char-2')],
    ])
    const turnState = { ...createInitialTurnState(), queue: ['p2'] }

    const selection = selectNextSpeaker(participants, characters, turnState, null)
    expect(selection).toMatchObject({ nextSpeakerId: 'p2', reason: 'queue', cycleComplete: false })
  })

  it('performs weighted random selection among eligible participants', () => {
    const participants = [
      makeCharacterParticipant('p1', 'char-1'),
      makeCharacterParticipant('p2', 'char-2'),
    ]
    const characters = new Map<string, Character>([
      ['char-1', makeCharacter('char-1', { talkativeness: 0.2 })],
      ['char-2', makeCharacter('char-2', { talkativeness: 0.8 })],
    ])
    const turnState = { ...createInitialTurnState(), spokenSinceUserTurn: [], lastSpeakerId: 'p1' }

    const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.1)
    const selection = selectNextSpeaker(participants, characters, turnState, null)
    randomSpy.mockRestore()

    expect(selection.reason).toBe('weighted_selection')
    expect(selection.nextSpeakerId).toBe('p2')
    expect(selection.debug?.eligibleSpeakers).toEqual(['p2'])
  })

  it('falls back to user turn when all characters have spoken (with user participant)', () => {
    const participants = [makeCharacterParticipant('p1', 'char-1'), makeCharacterParticipant('p2', 'char-2')]
    const characters = new Map<string, Character>([
      ['char-1', makeCharacter('char-1')],
      ['char-2', makeCharacter('char-2')],
    ])
    const turnState = { ...createInitialTurnState(), spokenSinceUserTurn: ['p1', 'p2'], lastSpeakerId: 'p2' }

    // With a user participant, returns user's turn when cycle complete
    const selection = selectNextSpeaker(participants, characters, turnState, 'user-1')
    expect(selection).toEqual({ nextSpeakerId: null, reason: 'cycle_complete', cycleComplete: true })
  })

  it('auto-continues in all-LLM chat when all characters have spoken', () => {
    const participants = [makeCharacterParticipant('p1', 'char-1'), makeCharacterParticipant('p2', 'char-2')]
    const characters = new Map<string, Character>([
      ['char-1', makeCharacter('char-1')],
      ['char-2', makeCharacter('char-2')],
    ])
    const turnState = { ...createInitialTurnState(), spokenSinceUserTurn: ['p1', 'p2'], lastSpeakerId: 'p2' }

    // With no user participant (all-LLM), starts new cycle instead of user turn
    const selection = selectNextSpeaker(participants, characters, turnState, null)
    expect(selection.nextSpeakerId).toBe('p1') // Selects the other character (not last speaker)
    expect(selection.reason).toBe('weighted_selection')
    expect(selection.cycleComplete).toBe(true)
  })

  it('honors single-character special case (with user participant)', () => {
    const participant = makeCharacterParticipant('p1', 'char-1')
    const characters = new Map<string, Character>([['char-1', makeCharacter('char-1')]])
    const state = { ...createInitialTurnState(), lastSpeakerId: null }

    const selection = selectNextSpeaker([participant], characters, state, 'user-1')
    expect(selection.nextSpeakerId).toBe('p1')
    expect(selection.reason).toBe('only_character')

    // With user participant, after character speaks it's user's turn
    const userTurn = selectNextSpeaker([participant], characters, { ...state, lastSpeakerId: 'p1' }, 'user-1')
    expect(userTurn.reason).toBe('user_turn')
  })

  it('single-character all-LLM chat continues in monologue mode', () => {
    const participant = makeCharacterParticipant('p1', 'char-1')
    const characters = new Map<string, Character>([['char-1', makeCharacter('char-1')]])
    const state = { ...createInitialTurnState(), lastSpeakerId: null }

    const selection = selectNextSpeaker([participant], characters, state, null)
    expect(selection.nextSpeakerId).toBe('p1')
    expect(selection.reason).toBe('only_character')

    // With no user participant (all-LLM), single character continues speaking
    const continueMonologue = selectNextSpeaker([participant], characters, { ...state, lastSpeakerId: 'p1' }, null)
    expect(continueMonologue.nextSpeakerId).toBe('p1')
    expect(continueMonologue.reason).toBe('only_character')
    expect(continueMonologue.cycleComplete).toBe(true)
  })

  it('updates turn state after user and assistant messages', () => {
    const initial = { ...createInitialTurnState(), queue: ['p1'], spokenSinceUserTurn: ['p2'], lastSpeakerId: 'p2' }
    const afterUser = updateTurnStateAfterMessage(initial, makeMessage('m-user', 'USER'), 'persona-1')
    expect(afterUser.spokenSinceUserTurn).toEqual([])
    expect(afterUser.queue).toEqual(['p1'])

    const afterAssistant = updateTurnStateAfterMessage(afterUser, makeMessage('m-ai', 'ASSISTANT', 'p1'), null)
    expect(afterAssistant.spokenSinceUserTurn).toContain('p1')
    expect(afterAssistant.queue).toEqual([])
    expect(afterAssistant.lastSpeakerId).toBe('p1')
  })

  it('manages queue helpers and exposes explanations', () => {
    const base = createInitialTurnState()
    const withQueue = addToQueue(base, 'p1')
    expect(withQueue.queue).toEqual(['p1'])

    const withoutDuplicate = addToQueue(withQueue, 'p1')
    expect(withoutDuplicate.queue).toEqual(['p1'])

    const removed = removeFromQueue(withQueue, 'p1')
    expect(removed.queue).toEqual([])

    const { state: poppedState, participantId } = popFromQueue({ ...withQueue, queue: ['p1', 'p2'] })
    expect(participantId).toBe('p1')
    expect(poppedState.queue).toEqual(['p2'])

    const nudged = nudgeParticipant({ ...withQueue, queue: ['p1', 'p2'] }, 'p2')
    expect(nudged.queue[0]).toBe('p2')
    expect(getQueuePosition(nudged, 'p2')).toBe(1)

    expect(getSelectionExplanation({ reason: 'queue', nextSpeakerId: 'p1', cycleComplete: false })).toContain('queue')
  })

  it('resets spoken state when user skips their turn without clearing the queue', () => {
    const state = {
      ...createInitialTurnState(),
      queue: ['p1', 'p2'],
      spokenSinceUserTurn: ['p1', 'p2'],
      lastSpeakerId: 'p2',
    }

    const reset = resetCycleForUserSkip(state)
    expect(reset.spokenSinceUserTurn).toEqual([])
    expect(reset.queue).toEqual(['p1', 'p2'])
    expect(reset.lastSpeakerId).toBe('p2')
  })

  it('finds user participant and active characters', () => {
    const userChar = makeUserControlledParticipant('u1', 'char-user')
    const char1 = makeCharacterParticipant('p1', 'char-1')
    const char2 = makeCharacterParticipant('p2', 'char-2', { isActive: false, status: 'absent' })

    expect(findUserParticipant([char1, userChar])).toBe(userChar)
    expect(getActiveCharacterParticipants([char1, char2])).toEqual([char1])
    expect(isMultiCharacterChat([char1, makeCharacterParticipant('p3', 'char-3')])).toBe(true)
  })
})

describe('turn manager rapid sequential messages', () => {
  it('handles rapid sequential messages updating turn state correctly', () => {
    const participants = [
      makeCharacterParticipant('p1', 'char-1'),
      makeCharacterParticipant('p2', 'char-2'),
      makeCharacterParticipant('p3', 'char-3'),
    ]

    // Simulate rapid sequential messages from different participants
    let state = createInitialTurnState()

    // First message
    state = updateTurnStateAfterMessage(state, makeMessage('m1', 'ASSISTANT', 'p1'), null)
    expect(state.spokenSinceUserTurn).toEqual(['p1'])
    expect(state.lastSpeakerId).toBe('p1')

    // Second message immediately after
    state = updateTurnStateAfterMessage(state, makeMessage('m2', 'ASSISTANT', 'p2'), null)
    expect(state.spokenSinceUserTurn).toEqual(['p1', 'p2'])
    expect(state.lastSpeakerId).toBe('p2')

    // Third message immediately after
    state = updateTurnStateAfterMessage(state, makeMessage('m3', 'ASSISTANT', 'p3'), null)
    expect(state.spokenSinceUserTurn).toEqual(['p1', 'p2', 'p3'])
    expect(state.lastSpeakerId).toBe('p3')
  })

  it('does not duplicate participants in spokenSinceUserTurn when same participant speaks multiple times', () => {
    let state = createInitialTurnState()

    // Same participant speaks twice (e.g., via queue nudge)
    state = updateTurnStateAfterMessage(state, makeMessage('m1', 'ASSISTANT', 'p1'), null)
    state = updateTurnStateAfterMessage(state, makeMessage('m2', 'ASSISTANT', 'p1'), null)

    expect(state.spokenSinceUserTurn).toEqual(['p1'])
    expect(state.lastSpeakerId).toBe('p1')
  })

  it('correctly resets state after user message following rapid assistant messages', () => {
    let state = createInitialTurnState()

    // Rapid assistant messages
    state = updateTurnStateAfterMessage(state, makeMessage('m1', 'ASSISTANT', 'p1'), null)
    state = updateTurnStateAfterMessage(state, makeMessage('m2', 'ASSISTANT', 'p2'), null)
    state = updateTurnStateAfterMessage(state, makeMessage('m3', 'ASSISTANT', 'p3'), null)

    // User interrupts
    state = updateTurnStateAfterMessage(state, makeMessage('m-user', 'USER'), 'persona-1')

    expect(state.spokenSinceUserTurn).toEqual([])
    expect(state.lastSpeakerId).toBeNull()
    expect(state.currentTurnParticipantId).toBeNull()
  })
})

describe('turn manager concurrent queue additions', () => {
  it('handles multiple addToQueue calls maintaining order', () => {
    let state = createInitialTurnState()

    // Simulate concurrent-like additions (in practice, these would be sequential)
    state = addToQueue(state, 'p1')
    state = addToQueue(state, 'p2')
    state = addToQueue(state, 'p3')

    expect(state.queue).toEqual(['p1', 'p2', 'p3'])
  })

  it('prevents duplicates when same participant is queued concurrently', () => {
    let state = createInitialTurnState()

    // Multiple attempts to queue same participant
    state = addToQueue(state, 'p1')
    state = addToQueue(state, 'p1')
    state = addToQueue(state, 'p1')

    expect(state.queue).toEqual(['p1'])
  })

  it('maintains queue integrity when mixing addToQueue and nudge operations', () => {
    let state = createInitialTurnState()

    state = addToQueue(state, 'p1')
    state = addToQueue(state, 'p2')
    state = nudgeParticipant(state, 'p3') // p3 goes to front
    state = addToQueue(state, 'p4')

    expect(state.queue).toEqual(['p3', 'p1', 'p2', 'p4'])
  })

  it('handles popFromQueue correctly after concurrent additions', () => {
    let state = createInitialTurnState()

    state = addToQueue(state, 'p1')
    state = addToQueue(state, 'p2')
    state = addToQueue(state, 'p3')

    const pop1 = popFromQueue(state)
    expect(pop1.participantId).toBe('p1')
    expect(pop1.state.queue).toEqual(['p2', 'p3'])

    const pop2 = popFromQueue(pop1.state)
    expect(pop2.participantId).toBe('p2')
    expect(pop2.state.queue).toEqual(['p3'])
  })
})

describe('turn manager participant removal during turn', () => {
  it('removes participant from queue when they are dequeued', () => {
    let state = createInitialTurnState()
    state = addToQueue(state, 'p1')
    state = addToQueue(state, 'p2')

    state = removeFromQueue(state, 'p1')

    expect(state.queue).toEqual(['p2'])
  })

  it('handles removal of participant who is not in queue gracefully', () => {
    let state = createInitialTurnState()
    state = addToQueue(state, 'p1')

    state = removeFromQueue(state, 'p-nonexistent')

    expect(state.queue).toEqual(['p1'])
  })

  it('correctly selects next speaker when active participant is removed mid-cycle', () => {
    const participants = [
      makeCharacterParticipant('p1', 'char-1'),
      makeCharacterParticipant('p2', 'char-2'),
      makeCharacterParticipant('p3', 'char-3', { isActive: false, status: 'absent' }), // Simulating removal by setting inactive
    ]
    const characters = new Map<string, Character>([
      ['char-1', makeCharacter('char-1')],
      ['char-2', makeCharacter('char-2')],
      ['char-3', makeCharacter('char-3')],
    ])
    const turnState = { ...createInitialTurnState(), spokenSinceUserTurn: ['p1'], lastSpeakerId: 'p1' }

    const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.5)
    const selection = selectNextSpeaker(participants, characters, turnState, null)
    randomSpy.mockRestore()

    // p3 is inactive, so only p2 is eligible
    expect(selection.nextSpeakerId).toBe('p2')
    expect(selection.debug?.eligibleSpeakers).toEqual(['p2'])
  })

  it('returns user turn when all remaining participants become inactive', () => {
    const participants = [
      makeCharacterParticipant('p1', 'char-1', { isActive: false, status: 'absent' }),
      makeCharacterParticipant('p2', 'char-2', { isActive: false, status: 'absent' }),
    ]
    const characters = new Map<string, Character>([
      ['char-1', makeCharacter('char-1')],
      ['char-2', makeCharacter('char-2')],
    ])
    const turnState = createInitialTurnState()

    const selection = selectNextSpeaker(participants, characters, turnState, null)

    expect(selection.nextSpeakerId).toBeNull()
    expect(selection.reason).toBe('user_turn')
    expect(selection.cycleComplete).toBe(true)
  })
})

describe('turn manager talkativeness extremes', () => {
  it('never selects character with talkativeness 0 through weighted selection', () => {
    const participants = [
      makeCharacterParticipant('p1', 'char-1'),
      makeCharacterParticipant('p2', 'char-2'),
    ]
    const characters = new Map<string, Character>([
      ['char-1', makeCharacter('char-1', { talkativeness: 0 })],
      ['char-2', makeCharacter('char-2', { talkativeness: 0.5 })],
    ])
    const turnState = createInitialTurnState()

    // Run multiple times to verify p1 (talkativeness 0) is never selected
    for (let i = 0; i < 10; i++) {
      const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(i / 10)
      const selection = selectNextSpeaker(participants, characters, turnState, null)
      randomSpy.mockRestore()

      expect(selection.nextSpeakerId).toBe('p2')
    }
  })

  it('always selects character with talkativeness 1 over lower values when eligible', () => {
    const participants = [
      makeCharacterParticipant('p1', 'char-1'),
      makeCharacterParticipant('p2', 'char-2'),
    ]
    const characters = new Map<string, Character>([
      ['char-1', makeCharacter('char-1', { talkativeness: 0.1 })],
      ['char-2', makeCharacter('char-2', { talkativeness: 1 })],
    ])
    const turnState = createInitialTurnState()

    // With random value high enough, p2 should be selected due to higher weight
    const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.5)
    const selection = selectNextSpeaker(participants, characters, turnState, null)
    randomSpy.mockRestore()

    // p2 has weight 1, p1 has weight 0.1, total = 1.1
    // Random 0.5 * 1.1 = 0.55, cumulative for p1 = 0.1, cumulative for p2 = 1.1
    // 0.55 > 0.1, so p2 is selected
    expect(selection.nextSpeakerId).toBe('p2')
  })

  it('uses equal weights when all participants have talkativeness 0', () => {
    const participants = [
      makeCharacterParticipant('p1', 'char-1'),
      makeCharacterParticipant('p2', 'char-2'),
    ]
    const characters = new Map<string, Character>([
      ['char-1', makeCharacter('char-1', { talkativeness: 0 })],
      ['char-2', makeCharacter('char-2', { talkativeness: 0 })],
    ])
    const turnState = createInitialTurnState()

    // When all weights are 0, the system falls back to equal weights (1 each)
    const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.25)
    const selection = selectNextSpeaker(participants, characters, turnState, null)
    randomSpy.mockRestore()

    // With equal weights, random 0.25 * 2 = 0.5, cumulative p1 = 1
    // 0.5 < 1, so p1 is selected
    expect(selection.nextSpeakerId).toBe('p1')
    expect(selection.reason).toBe('weighted_selection')
  })

  it('can still queue character with talkativeness 0', () => {
    const participants = [
      makeCharacterParticipant('p1', 'char-1'),
      makeCharacterParticipant('p2', 'char-2'),
    ]
    const characters = new Map<string, Character>([
      ['char-1', makeCharacter('char-1', { talkativeness: 0 })],
      ['char-2', makeCharacter('char-2', { talkativeness: 0.5 })],
    ])
    const turnState = { ...createInitialTurnState(), queue: ['p1'] }

    const selection = selectNextSpeaker(participants, characters, turnState, null)

    // Queue bypasses talkativeness weighting
    expect(selection.nextSpeakerId).toBe('p1')
    expect(selection.reason).toBe('queue')
  })
})

describe('turn manager edge cases', () => {
  describe('empty queue', () => {
    it('returns null participantId when popping from empty queue', () => {
      const state = createInitialTurnState()
      const { participantId, state: newState } = popFromQueue(state)

      expect(participantId).toBeNull()
      expect(newState.queue).toEqual([])
      expect(newState).toBe(state) // Should return same reference when empty
    })

    it('getQueuePosition returns 0 for participant not in queue', () => {
      const state = createInitialTurnState()

      expect(getQueuePosition(state, 'p1')).toBe(0)
      expect(getQueuePosition(state, 'nonexistent')).toBe(0)
    })
  })

  describe('single participant', () => {
    it('single active character alternates with user', () => {
      const participant = makeCharacterParticipant('p1', 'char-1')
      const characters = new Map<string, Character>([['char-1', makeCharacter('char-1')]])

      // Initial state - character speaks
      let state = createInitialTurnState()
      let selection = selectNextSpeaker([participant], characters, state, 'user-1')
      expect(selection.nextSpeakerId).toBe('p1')
      expect(selection.reason).toBe('only_character')

      // After character speaks - user turn (when there's a user participant)
      state = updateTurnStateAfterMessage(state, makeMessage('m1', 'ASSISTANT', 'p1'), 'user-1')
      selection = selectNextSpeaker([participant], characters, state, 'user-1')
      expect(selection.nextSpeakerId).toBeNull()
      expect(selection.reason).toBe('user_turn')

      // After user speaks - character turn again
      state = updateTurnStateAfterMessage(state, makeMessage('m2', 'USER'), 'user-1')
      selection = selectNextSpeaker([participant], characters, state, 'user-1')
      expect(selection.nextSpeakerId).toBe('p1')
      expect(selection.reason).toBe('only_character')
    })

    it('single inactive character results in user turn', () => {
      const participant = makeCharacterParticipant('p1', 'char-1', { isActive: false, status: 'absent' })
      const characters = new Map<string, Character>([['char-1', makeCharacter('char-1')]])
      const state = createInitialTurnState()

      const selection = selectNextSpeaker([participant], characters, state, null)

      expect(selection.nextSpeakerId).toBeNull()
      expect(selection.reason).toBe('user_turn')
    })
  })

  describe('all participants inactive', () => {
    it('returns user turn when all character participants are inactive', () => {
      const participants = [
        makeCharacterParticipant('p1', 'char-1', { isActive: false, status: 'absent' }),
        makeCharacterParticipant('p2', 'char-2', { isActive: false, status: 'absent' }),
        makeCharacterParticipant('p3', 'char-3', { isActive: false, status: 'absent' }),
      ]
      const characters = new Map<string, Character>([
        ['char-1', makeCharacter('char-1')],
        ['char-2', makeCharacter('char-2')],
        ['char-3', makeCharacter('char-3')],
      ])
      const state = createInitialTurnState()

      const selection = selectNextSpeaker(participants, characters, state, null)

      expect(selection.nextSpeakerId).toBeNull()
      expect(selection.reason).toBe('user_turn')
      expect(selection.cycleComplete).toBe(true)
    })

    it('handles mixed active/inactive with only user-controlled active', () => {
      const participants = [
        makeCharacterParticipant('p1', 'char-1', { isActive: false, status: 'absent' }),
        makeUserControlledParticipant('u1', 'char-user'), // User-controlled character is active
      ]
      const characters = new Map<string, Character>([['char-1', makeCharacter('char-1')]])
      const state = createInitialTurnState()

      const selection = selectNextSpeaker(participants, characters, state, 'u1')

      expect(selection.nextSpeakerId).toBeNull()
      expect(selection.reason).toBe('user_turn')
    })
  })

  describe('empty participants list', () => {
    it('returns user turn with no participants', () => {
      const characters = new Map<string, Character>()
      const state = createInitialTurnState()

      const selection = selectNextSpeaker([], characters, state, null)

      expect(selection.nextSpeakerId).toBeNull()
      expect(selection.reason).toBe('user_turn')
      expect(selection.cycleComplete).toBe(true)
    })

    it('calculateTurnStateFromHistory handles empty messages', () => {
      const state = calculateTurnStateFromHistory({
        messages: [],
        participants: [],
        userParticipantId: null,
      })

      expect(state.spokenSinceUserTurn).toEqual([])
      expect(state.lastSpeakerId).toBeNull()
      expect(state.queue).toEqual([])
    })
  })

  describe('missing character data', () => {
    it('uses default talkativeness when character not found in map', () => {
      const participants = [
        makeCharacterParticipant('p1', 'char-1'),
        makeCharacterParticipant('p2', 'char-2'),
      ]
      // Only one character in map, other is missing
      const characters = new Map<string, Character>([
        ['char-1', makeCharacter('char-1', { talkativeness: 0.8 })],
        // char-2 is missing - should use default 0.5
      ])
      const turnState = createInitialTurnState()

      const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.99)
      const selection = selectNextSpeaker(participants, characters, turnState, null)
      randomSpy.mockRestore()

      // Both should be eligible, using weights 0.8 and 0.5 (default)
      expect(selection.debug?.weights).toEqual({ 'p1': 0.8, 'p2': 0.5 })
    })
  })
})
