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
  personaId: null,
  connectionProfileId: null,
  imageProfileId: null,
  systemPromptOverride: null,
  displayOrder: 0,
  isActive: true,
  hasHistoryAccess: true,
  joinScenario: null,
  createdAt: now,
  updatedAt: now,
  ...overrides,
})

const makePersonaParticipant = (participantId: string, personaId: string): ChatParticipantBase => ({
  id: participantId,
  type: 'PERSONA',
  personaId,
  characterId: null,
  connectionProfileId: null,
  imageProfileId: null,
  systemPromptOverride: null,
  displayOrder: 0,
  isActive: true,
  hasHistoryAccess: true,
  joinScenario: null,
  createdAt: now,
  updatedAt: now,
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

  it('falls back to user turn when all characters have spoken', () => {
    const participants = [makeCharacterParticipant('p1', 'char-1'), makeCharacterParticipant('p2', 'char-2')]
    const characters = new Map<string, Character>([
      ['char-1', makeCharacter('char-1')],
      ['char-2', makeCharacter('char-2')],
    ])
    const turnState = { ...createInitialTurnState(), spokenSinceUserTurn: ['p1', 'p2'], lastSpeakerId: 'p2' }

    const selection = selectNextSpeaker(participants, characters, turnState, null)
    expect(selection).toEqual({ nextSpeakerId: null, reason: 'cycle_complete', cycleComplete: true })
  })

  it('honors single-character special case', () => {
    const participant = makeCharacterParticipant('p1', 'char-1')
    const characters = new Map<string, Character>([['char-1', makeCharacter('char-1')]])
    const state = { ...createInitialTurnState(), lastSpeakerId: null }

    const selection = selectNextSpeaker([participant], characters, state, null)
    expect(selection.nextSpeakerId).toBe('p1')
    expect(selection.reason).toBe('only_character')

    const userTurn = selectNextSpeaker([participant], characters, { ...state, lastSpeakerId: 'p1' }, null)
    expect(userTurn.reason).toBe('user_turn')
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
    const persona = makePersonaParticipant('u1', 'persona-1')
    const char1 = makeCharacterParticipant('p1', 'char-1')
    const char2 = makeCharacterParticipant('p2', 'char-2', { isActive: false })

    expect(findUserParticipant([char1, persona])).toBe(persona)
    expect(getActiveCharacterParticipants([char1, char2])).toEqual([char1])
    expect(isMultiCharacterChat([char1, makeCharacterParticipant('p3', 'char-3')])).toBe(true)
  })
})
