/**
 * Active Speaker API
 * Characters Not Personas - Phase 3
 *
 * Provides endpoints for managing the active typing participant
 * when a user is impersonating multiple characters.
 *
 * GET /api/chats/:id/active-speaker - Get current active speaker
 * PUT /api/chats/:id/active-speaker - Set active typing participant
 */

import { NextRequest, NextResponse } from 'next/server'
import { createAuthenticatedParamsHandler, type AuthenticatedContext } from '@/lib/api/middleware'
import { logger } from '@/lib/logger'
import { z } from 'zod'

// Validation schema for PUT request
const setActiveSpeakerSchema = z.object({
  participantId: z.string().uuid(),
})

/**
 * GET /api/chats/:id/active-speaker
 *
 * Returns the current active typing participant.
 */
export const GET = createAuthenticatedParamsHandler<{ id: string }>(
  async (req: NextRequest, { user, repos }: AuthenticatedContext, { id }) => {
    try {
      // Get chat metadata
      const chat = await repos.chats.findById(id)
      if (!chat || chat.userId !== user.id) {
        return NextResponse.json({ error: 'Chat not found' }, { status: 404 })
      }

      logger.debug('[Active Speaker API] Getting active speaker', {
        chatId: id,
        activeTypingParticipantId: chat.activeTypingParticipantId,
      })

      // Get participant details if set
      let activeParticipant = null
      if (chat.activeTypingParticipantId) {
        const p = chat.participants.find(part => part.id === chat.activeTypingParticipantId)
        if (p) {
          let characterName = 'Unknown'
          if (p.characterId) {
            const character = await repos.characters.findById(p.characterId)
            if (character) {
              characterName = character.name
            }
          }
          activeParticipant = {
            id: p.id,
            type: p.type,
            characterId: p.characterId,
            characterName,
            controlledBy: p.controlledBy,
          }
        }
      }

      return NextResponse.json({
        chatId: id,
        activeTypingParticipantId: chat.activeTypingParticipantId || null,
        activeParticipant,
        impersonatingParticipantIds: chat.impersonatingParticipantIds || [],
      })
    } catch (error) {
      logger.error('[Active Speaker API] Error getting active speaker:', {}, error as Error)
      return NextResponse.json(
        { error: 'Failed to get active speaker' },
        { status: 500 }
      )
    }
  }
)

/**
 * PUT /api/chats/:id/active-speaker
 *
 * Set the active typing participant.
 * The participant must be in the impersonating array.
 */
export const PUT = createAuthenticatedParamsHandler<{ id: string }>(
  async (req: NextRequest, { user, repos }: AuthenticatedContext, { id }) => {
    try {
      // Get chat metadata
      const chat = await repos.chats.findById(id)
      if (!chat || chat.userId !== user.id) {
        return NextResponse.json({ error: 'Chat not found' }, { status: 404 })
      }

      // Parse and validate request body
      const body = await req.json()
      const { participantId } = setActiveSpeakerSchema.parse(body)

      logger.debug('[Active Speaker API] Setting active speaker', {
        chatId: id,
        participantId,
      })

      // Verify participant exists
      const participant = chat.participants.find(p => p.id === participantId)
      if (!participant) {
        return NextResponse.json({ error: 'Participant not found' }, { status: 404 })
      }

      // Check if participant is being impersonated
      let impersonatingIds = chat.impersonatingParticipantIds || []
      if (!impersonatingIds.includes(participantId)) {
        // Auto-add user-controlled participants to impersonation array
        if (participant.controlledBy === 'user') {
          logger.info('[Active Speaker API] Auto-adding user-controlled participant to impersonation', {
            chatId: id,
            participantId,
          })
          impersonatingIds = [...impersonatingIds, participantId]
          await repos.chats.update(id, { impersonatingParticipantIds: impersonatingIds })
        } else {
          return NextResponse.json(
            { error: 'Participant is not being impersonated' },
            { status: 400 }
          )
        }
      }

      // Set active typing participant
      const updatedChat = await repos.chats.setActiveTypingParticipant(id, participantId)
      if (!updatedChat) {
        return NextResponse.json({ error: 'Failed to set active speaker' }, { status: 500 })
      }

      // Get character name if available
      let characterName = 'Unknown'
      if (participant.characterId) {
        const character = await repos.characters.findById(participant.characterId)
        if (character) {
          characterName = character.name
        }
      }

      logger.info('[Active Speaker API] Active speaker set', {
        chatId: id,
        participantId,
        characterName,
      })

      return NextResponse.json({
        success: true,
        activeTypingParticipantId: participantId,
        characterName,
        impersonatingParticipantIds: impersonatingIds,
      })
    } catch (error) {
      if (error instanceof z.ZodError) {
        return NextResponse.json(
          { error: 'Validation error', details: error.errors },
          { status: 400 }
        )
      }

      logger.error('[Active Speaker API] Error setting active speaker:', {}, error as Error)
      return NextResponse.json(
        { error: 'Failed to set active speaker' },
        { status: 500 }
      )
    }
  }
)
