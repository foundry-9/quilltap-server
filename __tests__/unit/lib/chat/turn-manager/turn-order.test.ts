/**
 * Unit tests for computePredictedTurnOrder
 *
 * Tests the display-only turn order computation logic:
 * - Generating participant placed first
 * - Next speaker from selection result
 * - Queue entries in order
 * - Eligible participants sorted by talkativeness
 * - User persona placement
 * - Already-spoken participants
 * - Inactive participants at end with null position
 */

import { describe, it, expect } from '@jest/globals'
import { computePredictedTurnOrder } from '@/lib/chat/turn-manager/turn-order'
import type { ParticipantData } from '@/components/chat/ParticipantCard'
import type { TurnState, TurnSelectionResult } from '@/lib/chat/turn-manager'

// Helper to create a character participant
function createCharacter(id: string, name: string, talkativeness = 0.5, isActive = true, controlledBy: 'llm' | 'user' = 'llm'): ParticipantData {
  return {
    id,
    type: 'CHARACTER',
    controlledBy,
    displayOrder: 1,
    isActive,
    status: isActive ? 'active' : 'absent',
    character: {
      id: `char-${id}`,
      name,
      talkativeness,
      defaultImage: null,
    },
    persona: null,
    connectionProfile: null,
  }
}

// Helper to create a user-controlled character participant
function createPersona(id: string, name: string, isActive = true): ParticipantData {
  return {
    id,
    type: 'CHARACTER',
    controlledBy: 'user',
    displayOrder: 0,
    isActive,
    status: isActive ? 'active' : 'absent',
    character: {
      id: `char-${id}`,
      name,
      defaultImage: null,
    },
    persona: null,
    connectionProfile: null,
  }
}

function createTurnState(overrides: Partial<TurnState> = {}): TurnState {
  return {
    spokenSinceUserTurn: [],
    currentTurnParticipantId: null,
    queue: [],
    lastSpeakerId: null,
    ...overrides,
  }
}

describe('computePredictedTurnOrder', () => {
  describe('basic ordering', () => {
    it('places generating participant first with generating status', () => {
      const participants = [
        createCharacter('alice', 'Alice'),
        createCharacter('bob', 'Bob'),
      ]

      const result = computePredictedTurnOrder({
        participants,
        turnState: createTurnState(),
        turnSelectionResult: { nextSpeakerId: 'bob', reason: 'weighted_selection', cycleComplete: false },
        isGenerating: true,
        respondingParticipantId: 'alice',
        userParticipantId: null,
      })

      expect(result[0]).toEqual({
        participantId: 'alice',
        position: 1,
        status: 'generating',
      })
    })

    it('places next speaker from selection result with next status', () => {
      const participants = [
        createCharacter('alice', 'Alice'),
        createCharacter('bob', 'Bob'),
      ]

      const result = computePredictedTurnOrder({
        participants,
        turnState: createTurnState(),
        turnSelectionResult: { nextSpeakerId: 'bob', reason: 'weighted_selection', cycleComplete: false },
        isGenerating: false,
        respondingParticipantId: null,
        userParticipantId: null,
      })

      expect(result[0]).toEqual({
        participantId: 'bob',
        position: 1,
        status: 'next',
      })
    })

    it('places generating first, then next speaker second', () => {
      const participants = [
        createCharacter('alice', 'Alice'),
        createCharacter('bob', 'Bob'),
        createCharacter('carol', 'Carol'),
      ]

      const result = computePredictedTurnOrder({
        participants,
        turnState: createTurnState(),
        turnSelectionResult: { nextSpeakerId: 'bob', reason: 'weighted_selection', cycleComplete: false },
        isGenerating: true,
        respondingParticipantId: 'alice',
        userParticipantId: null,
      })

      expect(result[0].participantId).toBe('alice')
      expect(result[0].status).toBe('generating')
      expect(result[0].position).toBe(1)

      expect(result[1].participantId).toBe('bob')
      expect(result[1].status).toBe('next')
      expect(result[1].position).toBe(2)
    })

    it('does not duplicate generating participant if they are also next speaker', () => {
      const participants = [
        createCharacter('alice', 'Alice'),
        createCharacter('bob', 'Bob'),
      ]

      const result = computePredictedTurnOrder({
        participants,
        turnState: createTurnState(),
        turnSelectionResult: { nextSpeakerId: 'alice', reason: 'weighted_selection', cycleComplete: false },
        isGenerating: true,
        respondingParticipantId: 'alice',
        userParticipantId: null,
      })

      // Alice should only appear once
      const aliceEntries = result.filter(e => e.participantId === 'alice')
      expect(aliceEntries).toHaveLength(1)
      expect(aliceEntries[0].status).toBe('generating')
    })
  })

  describe('queue handling', () => {
    it('places queued participants after next speaker with queued status', () => {
      const participants = [
        createCharacter('alice', 'Alice'),
        createCharacter('bob', 'Bob'),
        createCharacter('carol', 'Carol'),
      ]

      const result = computePredictedTurnOrder({
        participants,
        turnState: createTurnState({ queue: ['carol', 'bob'] }),
        turnSelectionResult: { nextSpeakerId: 'alice', reason: 'queue', cycleComplete: false },
        isGenerating: false,
        respondingParticipantId: null,
        userParticipantId: null,
      })

      // Alice is next (from selection result, but she's also first in queue - placed as next)
      expect(result[0].participantId).toBe('alice')

      // Carol and Bob are queued (in queue order)
      const carolEntry = result.find(e => e.participantId === 'carol')
      const bobEntry = result.find(e => e.participantId === 'bob')
      expect(carolEntry?.status).toBe('queued')
      expect(bobEntry?.status).toBe('queued')
    })
  })

  describe('eligible participants', () => {
    it('sorts eligible participants by talkativeness descending', () => {
      const participants = [
        createCharacter('alice', 'Alice', 0.3),
        createCharacter('bob', 'Bob', 0.9),
        createCharacter('carol', 'Carol', 0.6),
      ]

      const result = computePredictedTurnOrder({
        participants,
        turnState: createTurnState(),
        turnSelectionResult: null,
        isGenerating: false,
        respondingParticipantId: null,
        userParticipantId: null,
      })

      const eligible = result.filter(e => e.status === 'eligible')
      expect(eligible[0].participantId).toBe('bob')   // 0.9
      expect(eligible[1].participantId).toBe('carol')  // 0.6
      expect(eligible[2].participantId).toBe('alice')  // 0.3
    })

    it('excludes participants who spoke this cycle from eligible', () => {
      const participants = [
        createCharacter('alice', 'Alice', 0.5),
        createCharacter('bob', 'Bob', 0.5),
        createCharacter('carol', 'Carol', 0.5),
      ]

      const result = computePredictedTurnOrder({
        participants,
        turnState: createTurnState({
          spokenSinceUserTurn: ['alice'],
          lastSpeakerId: 'bob',
        }),
        turnSelectionResult: null,
        isGenerating: false,
        respondingParticipantId: null,
        userParticipantId: null,
      })

      const eligible = result.filter(e => e.status === 'eligible')
      // Only carol should be eligible (alice spoke, bob is last speaker)
      expect(eligible).toHaveLength(1)
      expect(eligible[0].participantId).toBe('carol')

      // Alice and Bob should be in 'spoken' category
      const spoken = result.filter(e => e.status === 'spoken')
      expect(spoken).toHaveLength(2)
    })

    it('excludes user-controlled characters from eligible', () => {
      const participants = [
        createCharacter('alice', 'Alice', 0.5, true, 'llm'),
        createCharacter('bob', 'Bob', 0.5, true, 'user'),
      ]

      const result = computePredictedTurnOrder({
        participants,
        turnState: createTurnState(),
        turnSelectionResult: null,
        isGenerating: false,
        respondingParticipantId: null,
        userParticipantId: null,
      })

      const eligible = result.filter(e => e.status === 'eligible')
      expect(eligible).toHaveLength(1)
      expect(eligible[0].participantId).toBe('alice')
    })
  })

  describe('user persona handling', () => {
    it('places user persona with user-turn status', () => {
      const participants = [
        createPersona('user', 'User'),
        createCharacter('alice', 'Alice'),
      ]

      const result = computePredictedTurnOrder({
        participants,
        turnState: createTurnState(),
        turnSelectionResult: { nextSpeakerId: null, reason: 'user_turn', cycleComplete: false },
        isGenerating: false,
        respondingParticipantId: null,
        userParticipantId: 'user',
      })

      const userEntry = result.find(e => e.participantId === 'user')
      expect(userEntry?.status).toBe('user-turn')
      expect(userEntry?.position).not.toBeNull()
    })
  })

  describe('inactive participants', () => {
    it('places inactive participants at end with null position', () => {
      const participants = [
        createCharacter('alice', 'Alice', 0.5, true),
        createCharacter('bob', 'Bob', 0.5, false),
        createCharacter('carol', 'Carol', 0.5, true),
      ]

      const result = computePredictedTurnOrder({
        participants,
        turnState: createTurnState(),
        turnSelectionResult: null,
        isGenerating: false,
        respondingParticipantId: null,
        userParticipantId: null,
      })

      const bobEntry = result.find(e => e.participantId === 'bob')
      expect(bobEntry?.status).toBe('absent')
      expect(bobEntry?.position).toBeNull()

      // Bob should be last
      expect(result[result.length - 1].participantId).toBe('bob')
    })

    it('includes all inactive participants', () => {
      const participants = [
        createCharacter('alice', 'Alice', 0.5, false),
        createCharacter('bob', 'Bob', 0.5, false),
      ]

      const result = computePredictedTurnOrder({
        participants,
        turnState: createTurnState(),
        turnSelectionResult: null,
        isGenerating: false,
        respondingParticipantId: null,
        userParticipantId: null,
      })

      expect(result).toHaveLength(2)
      expect(result.every(e => e.status === 'absent')).toBe(true)
      expect(result.every(e => e.position === null)).toBe(true)
    })
  })

  describe('complete ordering', () => {
    it('produces correct order: generating, next, queued, eligible, user, spoken, inactive', () => {
      const participants = [
        createPersona('user', 'User'),
        createCharacter('gen', 'Generating', 0.5, true),
        createCharacter('next', 'Next', 0.5, true),
        createCharacter('queued', 'Queued', 0.5, true),
        createCharacter('eligible', 'Eligible', 0.8, true),
        createCharacter('spoken', 'Spoken', 0.5, true),
        createCharacter('inactive', 'Inactive', 0.5, false),
      ]

      const result = computePredictedTurnOrder({
        participants,
        turnState: createTurnState({
          queue: ['queued'],
          spokenSinceUserTurn: ['spoken'],
          lastSpeakerId: 'gen',
        }),
        turnSelectionResult: { nextSpeakerId: 'next', reason: 'weighted_selection', cycleComplete: false },
        isGenerating: true,
        respondingParticipantId: 'gen',
        userParticipantId: 'user',
      })

      const statuses = result.map(e => e.status)
      expect(statuses).toEqual([
        'generating',   // gen
        'next',         // next
        'queued',       // queued
        'eligible',     // eligible
        'user-turn',    // user
        'spoken',       // spoken (and gen is also spoken but already placed as generating)
        'absent',       // inactive (status: absent)
      ])

      // Check positions: active participants get sequential positions, inactive gets null
      expect(result.find(e => e.status === 'generating')?.position).toBe(1)
      expect(result.find(e => e.status === 'next')?.position).toBe(2)
      expect(result.find(e => e.status === 'queued')?.position).toBe(3)
      expect(result.find(e => e.status === 'eligible')?.position).toBe(4)
      expect(result.find(e => e.status === 'user-turn')?.position).toBe(5)
      expect(result.find(e => e.status === 'spoken')?.position).toBe(6)
      expect(result.find(e => e.status === 'absent')?.position).toBeNull()
    })

    it('handles empty participants list', () => {
      const result = computePredictedTurnOrder({
        participants: [],
        turnState: createTurnState(),
        turnSelectionResult: null,
        isGenerating: false,
        respondingParticipantId: null,
        userParticipantId: null,
      })

      expect(result).toHaveLength(0)
    })

    it('handles no selection result gracefully', () => {
      const participants = [
        createCharacter('alice', 'Alice'),
        createCharacter('bob', 'Bob'),
      ]

      const result = computePredictedTurnOrder({
        participants,
        turnState: createTurnState(),
        turnSelectionResult: null,
        isGenerating: false,
        respondingParticipantId: null,
        userParticipantId: null,
      })

      // Should still produce entries for all participants
      expect(result).toHaveLength(2)
      expect(result.every(e => e.status === 'eligible')).toBe(true)
    })

    it('ignores respondingParticipantId that does not exist in participants', () => {
      const participants = [
        createCharacter('alice', 'Alice'),
      ]

      const result = computePredictedTurnOrder({
        participants,
        turnState: createTurnState(),
        turnSelectionResult: null,
        isGenerating: true,
        respondingParticipantId: 'nonexistent',
        userParticipantId: null,
      })

      // Should not crash, alice is the only entry
      expect(result).toHaveLength(1)
      expect(result[0].participantId).toBe('alice')
    })
  })
})
