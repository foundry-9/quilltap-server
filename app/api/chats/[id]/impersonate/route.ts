/**
 * Impersonation API
 * Characters Not Personas - Phase 3
 *
 * Provides endpoints for managing impersonation in chats.
 * Impersonation allows a user to temporarily take control of any character.
 *
 * POST /api/chats/:id/impersonate - Start impersonating a participant
 * DELETE /api/chats/:id/impersonate - Stop impersonating a participant
 * GET /api/chats/:id/impersonate - Get current impersonation state
 */

import { NextRequest, NextResponse } from 'next/server'
import { createAuthenticatedParamsHandler, type AuthenticatedContext } from '@/lib/api/middleware'
import { logger } from '@/lib/logger'
import { z } from 'zod'

// Validation schema for POST request (start impersonation)
const startImpersonationSchema = z.object({
  participantId: z.string().uuid(),
})

// Validation schema for DELETE request (stop impersonation)
const stopImpersonationSchema = z.object({
  participantId: z.string().uuid(),
  newConnectionProfileId: z.string().uuid().optional(),
})

/**
 * GET /api/chats/:id/impersonate
 *
 * Returns current impersonation state including:
 * - Array of participant IDs being impersonated
 * - Active typing participant ID
 */
export const GET = createAuthenticatedParamsHandler<{ id: string }>(
  async (req: NextRequest, { user, repos }: AuthenticatedContext, { id }) => {
    try {
      // Get chat metadata
      const chat = await repos.chats.findById(id)
      if (!chat || chat.userId !== user.id) {
        return NextResponse.json({ error: 'Chat not found' }, { status: 404 })
      }

      logger.debug('[Impersonate API] Getting impersonation state', {
        chatId: id,
        impersonatingCount: chat.impersonatingParticipantIds?.length ?? 0,
      })

      // Get participant details for impersonated characters
      const impersonatedParticipants = (chat.impersonatingParticipantIds || [])
        .map(pid => {
          const p = chat.participants.find(part => part.id === pid)
          if (!p) return null
          return {
            id: p.id,
            type: p.type,
            characterId: p.characterId,
            controlledBy: p.controlledBy,
          }
        })
        .filter(Boolean)

      return NextResponse.json({
        chatId: id,
        impersonatingParticipantIds: chat.impersonatingParticipantIds || [],
        activeTypingParticipantId: chat.activeTypingParticipantId || null,
        impersonatedParticipants,
      })
    } catch (error) {
      logger.error('[Impersonate API] Error getting impersonation state:', {}, error as Error)
      return NextResponse.json(
        { error: 'Failed to get impersonation state' },
        { status: 500 }
      )
    }
  }
)

/**
 * POST /api/chats/:id/impersonate
 *
 * Start impersonating a participant.
 * Adds the participant to the impersonating array and sets as active if none set.
 */
export const POST = createAuthenticatedParamsHandler<{ id: string }>(
  async (req: NextRequest, { user, repos }: AuthenticatedContext, { id }) => {
    try {
      // Get chat metadata
      const chat = await repos.chats.findById(id)
      if (!chat || chat.userId !== user.id) {
        return NextResponse.json({ error: 'Chat not found' }, { status: 404 })
      }

      // Parse and validate request body
      const body = await req.json()
      const { participantId } = startImpersonationSchema.parse(body)

      logger.debug('[Impersonate API] Starting impersonation', {
        chatId: id,
        participantId,
      })

      // Verify participant exists and is active
      const participant = chat.participants.find(p => p.id === participantId)
      if (!participant) {
        return NextResponse.json({ error: 'Participant not found' }, { status: 404 })
      }
      if (!participant.isActive) {
        return NextResponse.json({ error: 'Participant is not active' }, { status: 400 })
      }

      // Add impersonation
      const updatedChat = await repos.chats.addImpersonation(id, participantId)
      if (!updatedChat) {
        return NextResponse.json({ error: 'Failed to start impersonation' }, { status: 500 })
      }

      // Get character name if available
      let characterName = 'Unknown'
      if (participant.characterId) {
        const character = await repos.characters.findById(participant.characterId)
        if (character) {
          characterName = character.name
        }
      }

      logger.info('[Impersonate API] Impersonation started', {
        chatId: id,
        participantId,
        characterName,
      })

      return NextResponse.json({
        success: true,
        participantId,
        characterName,
        impersonatingParticipantIds: updatedChat.impersonatingParticipantIds,
        activeTypingParticipantId: updatedChat.activeTypingParticipantId,
      })
    } catch (error) {
      if (error instanceof z.ZodError) {
        return NextResponse.json(
          { error: 'Validation error', details: error.errors },
          { status: 400 }
        )
      }

      logger.error('[Impersonate API] Error starting impersonation:', {}, error as Error)
      return NextResponse.json(
        { error: 'Failed to start impersonation' },
        { status: 500 }
      )
    }
  }
)

/**
 * DELETE /api/chats/:id/impersonate
 *
 * Stop impersonating a participant.
 * Optionally assigns a new connection profile for LLM control.
 */
export const DELETE = createAuthenticatedParamsHandler<{ id: string }>(
  async (req: NextRequest, { user, repos }: AuthenticatedContext, { id }) => {
    try {
      // Get chat metadata
      const chat = await repos.chats.findById(id)
      if (!chat || chat.userId !== user.id) {
        return NextResponse.json({ error: 'Chat not found' }, { status: 404 })
      }

      // Parse and validate request body
      const body = await req.json()
      const { participantId, newConnectionProfileId } = stopImpersonationSchema.parse(body)

      logger.debug('[Impersonate API] Stopping impersonation', {
        chatId: id,
        participantId,
        newConnectionProfileId,
      })

      // Verify participant exists
      const participant = chat.participants.find(p => p.id === participantId)
      if (!participant) {
        return NextResponse.json({ error: 'Participant not found' }, { status: 404 })
      }

      // Remove impersonation
      let updatedChat = await repos.chats.removeImpersonation(id, participantId)
      if (!updatedChat) {
        return NextResponse.json({ error: 'Failed to stop impersonation' }, { status: 500 })
      }

      // If a new connection profile was provided, update the participant
      if (newConnectionProfileId) {
        // Verify connection profile exists and belongs to user
        const profile = await repos.connections.findById(newConnectionProfileId)
        if (!profile || profile.userId !== user.id) {
          return NextResponse.json({ error: 'Connection profile not found' }, { status: 404 })
        }

        // Update participant with new connection profile and set controlledBy to 'llm'
        updatedChat = await repos.chats.updateParticipant(id, participantId, {
          connectionProfileId: newConnectionProfileId,
          controlledBy: 'llm',
        })

        logger.debug('[Impersonate API] Updated participant control', {
          chatId: id,
          participantId,
          newConnectionProfileId,
          newControlledBy: 'llm',
        })
      }

      // Get character name if available
      let characterName = 'Unknown'
      if (participant.characterId) {
        const character = await repos.characters.findById(participant.characterId)
        if (character) {
          characterName = character.name
        }
      }

      logger.info('[Impersonate API] Impersonation stopped', {
        chatId: id,
        participantId,
        characterName,
        assignedNewProfile: !!newConnectionProfileId,
      })

      return NextResponse.json({
        success: true,
        participantId,
        characterName,
        impersonatingParticipantIds: updatedChat?.impersonatingParticipantIds || [],
        activeTypingParticipantId: updatedChat?.activeTypingParticipantId || null,
        newConnectionProfileId: newConnectionProfileId || null,
      })
    } catch (error) {
      if (error instanceof z.ZodError) {
        return NextResponse.json(
          { error: 'Validation error', details: error.errors },
          { status: 400 }
        )
      }

      logger.error('[Impersonate API] Error stopping impersonation:', {}, error as Error)
      return NextResponse.json(
        { error: 'Failed to stop impersonation' },
        { status: 500 }
      )
    }
  }
)
