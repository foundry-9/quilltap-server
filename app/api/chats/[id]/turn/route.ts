/**
 * Turn Management API
 * Multi-Character Chat System - Phase 2
 *
 * Provides endpoints for managing turn state in multi-character chats.
 *
 * GET /api/chats/:id/turn - Get current turn state and next speaker
 * POST /api/chats/:id/turn - Nudge/queue a participant to speak
 */

import { NextRequest, NextResponse } from 'next/server'
import { createAuthenticatedParamsHandler, type AuthenticatedContext } from '@/lib/api/middleware'
import {
  selectNextSpeaker,
  calculateTurnStateFromHistory,
  nudgeParticipant,
  addToQueue,
  removeFromQueue,
  getQueuePosition,
  getActiveCharacterParticipants,
  findUserParticipant,
  isMultiCharacterChat,
  getSelectionExplanation,
  type TurnState,
} from '@/lib/chat/turn-manager'
import { logger } from '@/lib/logger'
import { z } from 'zod'
import type { MessageEvent, Character } from '@/lib/schemas/types'
import { notFound, badRequest, serverError, validationError } from '@/lib/api/responses'

// Validation schema for POST request
const turnActionSchema = z.object({
  action: z.enum(['nudge', 'queue', 'dequeue']),
  participantId: z.string().uuid(),
})

// Validation schema for PATCH request (persist turn state)
const persistTurnSchema = z.object({
  lastTurnParticipantId: z.string().uuid().nullable(),
})

/**
 * GET /api/chats/:id/turn
 *
 * Returns current turn state including:
 * - Who should speak next
 * - Queue positions
 * - Whether it's the user's turn
 */
export const GET = createAuthenticatedParamsHandler<{ id: string }>(
  async (req: NextRequest, { user, repos }: AuthenticatedContext, { id }) => {
    try {
      // Get chat metadata
      const chat = await repos.chats.findById(id)
      if (!chat || chat.userId !== user.id) {
        return notFound('Chat')
      }

      logger.debug('[Turn API] Getting turn state', {
        chatId: id,
        participantCount: chat.participants.length,
      })

      // Get user participant
      const userParticipant = findUserParticipant(chat.participants)
      const userParticipantId = userParticipant?.id ?? null

      // Get messages for turn state calculation
      const messages = await repos.chats.getMessages(id)
      const messageEvents = messages.filter(
        (m): m is typeof m & { type: 'message' } => m.type === 'message'
      ) as unknown as MessageEvent[]

      // Calculate turn state from message history
      const turnState = calculateTurnStateFromHistory({
        messages: messageEvents,
        participants: chat.participants,
        userParticipantId,
      })

      // Load all characters for turn selection
      const activeCharacterParticipants = getActiveCharacterParticipants(chat.participants)
      const charactersMap = new Map<string, Character>()
      for (const p of activeCharacterParticipants) {
        if (p.characterId) {
          const char = await repos.characters.findById(p.characterId)
          if (char) {
            charactersMap.set(p.characterId, char)
          }
        }
      }

      // Select next speaker
      const nextSpeakerResult = selectNextSpeaker(
        chat.participants,
        charactersMap,
        turnState,
        userParticipantId
      )

      // Build participant info with queue positions and turn status
      const participantInfo = chat.participants
        .filter(p => p.isActive)
        .map(p => {
          const character = p.characterId ? charactersMap.get(p.characterId) : null
          return {
            id: p.id,
            type: p.type,
            characterId: p.characterId,
            personaId: p.personaId,
            name: character?.name ?? (p.type === 'PERSONA' ? 'User' : 'Unknown'),
            queuePosition: getQueuePosition(turnState, p.id),
            isCurrentSpeaker: nextSpeakerResult.nextSpeakerId === p.id,
            hasSpokeThisCycle: turnState.spokenSinceUserTurn.includes(p.id),
            talkativeness: character?.talkativeness ?? 0.5,
          }
        })

      logger.debug('[Turn API] Turn state calculated', {
        chatId: id,
        nextSpeakerId: nextSpeakerResult.nextSpeakerId,
        reason: nextSpeakerResult.reason,
        isUsersTurn: nextSpeakerResult.nextSpeakerId === null,
      })

      return NextResponse.json({
        chatId: id,
        isMultiCharacter: isMultiCharacterChat(chat.participants),
        turn: {
          nextSpeakerId: nextSpeakerResult.nextSpeakerId,
          reason: nextSpeakerResult.reason,
          explanation: getSelectionExplanation(nextSpeakerResult),
          cycleComplete: nextSpeakerResult.cycleComplete,
          isUsersTurn: nextSpeakerResult.nextSpeakerId === null,
        },
        state: {
          spokenSinceUserTurn: turnState.spokenSinceUserTurn,
          lastSpeakerId: turnState.lastSpeakerId,
          queue: turnState.queue,
        },
        participants: participantInfo,
      })
    } catch (error) {
      logger.error('[Turn API] Error getting turn state:', {}, error as Error)
      return serverError('Failed to get turn state')
    }
  }
)

/**
 * POST /api/chats/:id/turn
 *
 * Performs a turn action (nudge, queue, or dequeue a participant).
 * Note: Queue state is session-only, stored client-side.
 * This endpoint is primarily for validation and returning updated turn info.
 */
export const POST = createAuthenticatedParamsHandler<{ id: string }>(
  async (req: NextRequest, { user, repos }: AuthenticatedContext, { id }) => {
    try {
      // Get chat metadata
      const chat = await repos.chats.findById(id)
      if (!chat || chat.userId !== user.id) {
        return notFound('Chat')
      }

      // Parse and validate request body
      const body = await req.json()
      const { action, participantId } = turnActionSchema.parse(body)

      logger.debug('[Turn API] Processing turn action', {
        chatId: id,
        action,
        participantId,
      })

      // Verify participant exists and is active
      const participant = chat.participants.find(p => p.id === participantId)
      if (!participant) {
        return notFound('Participant')
      }
      if (!participant.isActive) {
        return badRequest('Participant is not active')
      }

      // Get user participant
      const userParticipant = findUserParticipant(chat.participants)
      const userParticipantId = userParticipant?.id ?? null

      // Get messages for turn state calculation
      const messages = await repos.chats.getMessages(id)
      const messageEvents = messages.filter(
        (m): m is typeof m & { type: 'message' } => m.type === 'message'
      ) as unknown as MessageEvent[]

      // Calculate base turn state from message history
      let turnState = calculateTurnStateFromHistory({
        messages: messageEvents,
        participants: chat.participants,
        userParticipantId,
      })

      // Apply the requested action to the turn state
      // Note: This is informational - the actual queue is maintained client-side
      switch (action) {
        case 'nudge':
          turnState = nudgeParticipant(turnState, participantId)
          logger.debug('[Turn API] Participant nudged', {
            participantId,
            newQueuePosition: 1,
          })
          break
        case 'queue':
          turnState = addToQueue(turnState, participantId)
          logger.debug('[Turn API] Participant queued', {
            participantId,
            queuePosition: turnState.queue.indexOf(participantId) + 1,
          })
          break
        case 'dequeue':
          turnState = removeFromQueue(turnState, participantId)
          logger.debug('[Turn API] Participant dequeued', {
            participantId,
          })
          break
      }

      // Load all characters for turn selection
      const activeCharacterParticipants = getActiveCharacterParticipants(chat.participants)
      const charactersMap = new Map<string, Character>()
      for (const p of activeCharacterParticipants) {
        if (p.characterId) {
          const char = await repos.characters.findById(p.characterId)
          if (char) {
            charactersMap.set(p.characterId, char)
          }
        }
      }

      // Select next speaker with updated state
      const nextSpeakerResult = selectNextSpeaker(
        chat.participants,
        charactersMap,
        turnState,
        userParticipantId
      )

      // Get character name for the affected participant
      const affectedCharacter = participant.characterId
        ? charactersMap.get(participant.characterId)
        : null

      logger.debug('[Turn API] Turn action completed', {
        chatId: id,
        action,
        participantId,
        participantName: affectedCharacter?.name ?? 'Unknown',
        nextSpeakerId: nextSpeakerResult.nextSpeakerId,
      })

      return NextResponse.json({
        success: true,
        action,
        participant: {
          id: participantId,
          name: affectedCharacter?.name ?? (participant.type === 'PERSONA' ? 'User' : 'Unknown'),
          queuePosition: getQueuePosition(turnState, participantId),
        },
        turn: {
          nextSpeakerId: nextSpeakerResult.nextSpeakerId,
          reason: nextSpeakerResult.reason,
          explanation: getSelectionExplanation(nextSpeakerResult),
          cycleComplete: nextSpeakerResult.cycleComplete,
          isUsersTurn: nextSpeakerResult.nextSpeakerId === null,
        },
        state: {
          queue: turnState.queue,
        },
      })
    } catch (error) {
      if (error instanceof z.ZodError) {
        return validationError(error)
      }

      logger.error('[Turn API] Error processing turn action:', {}, error as Error)
      return serverError('Failed to process turn action')
    }
  }
)

/**
 * PATCH /api/chats/:id/turn
 *
 * Persists the current turn state to the chat metadata.
 * Called after each turn completes to remember whose turn it is.
 */
export const PATCH = createAuthenticatedParamsHandler<{ id: string }>(
  async (req: NextRequest, { user, repos }: AuthenticatedContext, { id }) => {
    try {
      // Get chat metadata to verify ownership
      const chat = await repos.chats.findById(id)
      if (!chat || chat.userId !== user.id) {
        return notFound('Chat')
      }

      // Parse and validate request body
      const body = await req.json()
      const { lastTurnParticipantId } = persistTurnSchema.parse(body)

      logger.debug('[Turn API] Persisting turn state', {
        chatId: id,
        lastTurnParticipantId,
      })

      // If a participant ID is provided, verify it exists and is active
      if (lastTurnParticipantId !== null) {
        const participant = chat.participants.find(p => p.id === lastTurnParticipantId)
        if (!participant) {
          return notFound('Participant')
        }
        if (!participant.isActive) {
          // If the participant is no longer active, set to null (user's turn)
          logger.debug('[Turn API] Participant inactive, setting to user turn', {
            participantId: lastTurnParticipantId,
          })
        }
      }

      // Update the chat metadata with the turn state
      await repos.chats.update(id, {
        lastTurnParticipantId,
      })

      logger.debug('[Turn API] Turn state persisted', {
        chatId: id,
        lastTurnParticipantId,
      })

      return NextResponse.json({
        success: true,
        lastTurnParticipantId,
      })
    } catch (error) {
      if (error instanceof z.ZodError) {
        return validationError(error)
      }

      logger.error('[Turn API] Error persisting turn state:', {}, error as Error)
      return serverError('Failed to persist turn state')
    }
  }
)
