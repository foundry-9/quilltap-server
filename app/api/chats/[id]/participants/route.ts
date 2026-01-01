/**
 * Chat Participants API
 * Multi-Character Chat System - Phase 6
 *
 * GET    /api/chats/:id/participants - List all participants with enriched data
 * POST   /api/chats/:id/participants - Add a new participant to the chat
 * PATCH  /api/chats/:id/participants - Update a participant's settings
 * DELETE /api/chats/:id/participants - Remove a participant from the chat
 */

import { NextRequest, NextResponse } from 'next/server'
import { createAuthenticatedParamsHandler, getFilePath } from '@/lib/api/middleware'
import { z } from 'zod'
import { logger } from '@/lib/logger'
import type { ChatParticipantBase, FileEntry } from '@/lib/schemas/types'
import type { RepositoryContainer } from '@/lib/repositories/factory'

// Disable caching for this route
export const dynamic = 'force-dynamic'
export const revalidate = 0

type Repos = RepositoryContainer

// Helper to get enriched character data
async function getEnrichedCharacter(characterId: string, repos: Repos) {
  const charData = await repos.characters.findById(characterId)
  if (!charData) return null

  let defaultImage = null
  if (charData.defaultImageId) {
    const fileEntry = await repos.files.findById(charData.defaultImageId)
    if (fileEntry) {
      defaultImage = { id: fileEntry.id, filepath: getFilePath(fileEntry), url: null }
    }
  }

  return {
    id: charData.id,
    name: charData.name,
    title: charData.title,
    avatarUrl: charData.avatarUrl,
    talkativeness: charData.talkativeness ?? 0.5,
    defaultImageId: charData.defaultImageId,
    defaultImage,
    defaultConnectionProfileId: charData.defaultConnectionProfileId,
  }
}

// Helper to get enriched persona data
async function getEnrichedPersona(personaId: string, repos: Repos) {
  const personaData = await repos.personas.findById(personaId)
  if (!personaData) return null

  let defaultImage = null
  if (personaData.defaultImageId) {
    const fileEntry = await repos.files.findById(personaData.defaultImageId)
    if (fileEntry) {
      defaultImage = { id: fileEntry.id, filepath: getFilePath(fileEntry), url: null }
    }
  }

  return {
    id: personaData.id,
    name: personaData.name,
    title: personaData.title,
    avatarUrl: personaData.avatarUrl,
    defaultImageId: personaData.defaultImageId,
    defaultImage,
  }
}

// Helper to get enriched connection profile
async function getEnrichedConnectionProfile(profileId: string, repos: Repos) {
  const profile = await repos.connections.findById(profileId)
  if (!profile) return null

  let apiKeyInfo = null
  if (profile.apiKeyId) {
    const apiKey = await repos.connections.findApiKeyById(profile.apiKeyId)
    if (apiKey) {
      apiKeyInfo = { id: apiKey.id, provider: apiKey.provider, label: apiKey.label }
    }
  }

  return {
    id: profile.id,
    name: profile.name,
    provider: profile.provider,
    modelName: profile.modelName,
    apiKey: apiKeyInfo,
  }
}

// Helper to enrich participant data with related entities
async function enrichParticipant(participant: ChatParticipantBase, repos: Repos) {
  const character = participant.type === 'CHARACTER' && participant.characterId
    ? await getEnrichedCharacter(participant.characterId, repos)
    : null

  // Legacy: for PERSONA type, also look up persona data
  const persona = participant.type === 'PERSONA' && participant.personaId
    ? await getEnrichedPersona(participant.personaId, repos)
    : null

  const connectionProfile = participant.connectionProfileId
    ? await getEnrichedConnectionProfile(participant.connectionProfileId, repos)
    : null

  return {
    id: participant.id,
    type: participant.type,
    controlledBy: participant.controlledBy || (participant.type === 'PERSONA' ? 'user' : 'llm'),
    characterId: participant.characterId,
    personaId: participant.personaId,
    displayOrder: participant.displayOrder,
    isActive: participant.isActive,
    systemPromptOverride: participant.systemPromptOverride,
    hasHistoryAccess: participant.hasHistoryAccess,
    joinScenario: participant.joinScenario,
    character,
    persona,
    connectionProfile,
    createdAt: participant.createdAt,
    updatedAt: participant.updatedAt,
  }
}

// Validation schemas
// Note: PERSONA type is deprecated - use CHARACTER with controlledBy='user' instead
const addParticipantSchema = z.object({
  type: z.enum(['CHARACTER', 'PERSONA']),  // PERSONA kept for backwards compatibility
  characterId: z.string().uuid().optional(),
  personaId: z.string().uuid().optional(),  // @deprecated - use characterId with controlledBy='user'
  connectionProfileId: z.string().uuid().optional(),
  imageProfileId: z.string().uuid().nullish(),
  systemPromptOverride: z.string().nullish(),
  displayOrder: z.number().optional(),
  hasHistoryAccess: z.boolean().optional(),
  joinScenario: z.string().nullish(),
  controlledBy: z.enum(['llm', 'user']).optional(),  // Who controls this participant
})

const updateParticipantSchema = z.object({
  participantId: z.string().uuid(),
  connectionProfileId: z.string().uuid().optional(),
  imageProfileId: z.string().uuid().nullish(),
  systemPromptOverride: z.string().nullish(),
  displayOrder: z.number().optional(),
  isActive: z.boolean().optional(),
  hasHistoryAccess: z.boolean().optional(),
  joinScenario: z.string().nullish(),
})

const removeParticipantSchema = z.object({
  participantId: z.string().uuid(),
})

/**
 * GET /api/chats/:id/participants
 * List all participants with enriched data
 */
export const GET = createAuthenticatedParamsHandler<{ id: string }>(
  async (req: NextRequest, { user, repos }, { id }) => {
    try {
      logger.debug('[Participants API] GET request', { chatId: id })

      const chat = await repos.chats.findById(id)

      if (!chat || chat.userId !== user.id) {
        return NextResponse.json({ error: 'Chat not found' }, { status: 404 })
      }

      const enrichedParticipants = await Promise.all(
        chat.participants.map(p => enrichParticipant(p, repos))
      )

      logger.debug('[Participants API] GET success', {
        chatId: id,
        participantCount: enrichedParticipants.length,
      })

      return NextResponse.json({ participants: enrichedParticipants })
    } catch (error) {
      logger.error('[Participants API] GET error', { context: 'GET /api/chats/:id/participants' }, error instanceof Error ? error : undefined)
      return NextResponse.json({ error: 'Failed to fetch participants' }, { status: 500 })
    }
  }
)

/**
 * POST /api/chats/:id/participants
 * Add a new participant to the chat
 */
export const POST = createAuthenticatedParamsHandler<{ id: string }>(
  async (req: NextRequest, { user, repos }, { id }) => {
    try {
      const chat = await repos.chats.findById(id)

      if (!chat || chat.userId !== user.id) {
        return NextResponse.json({ error: 'Chat not found' }, { status: 404 })
      }

      const body = await req.json()
      const validatedData = addParticipantSchema.parse(body)

      logger.debug('[Participants API] POST request', {
        chatId: id,
        type: validatedData.type,
        characterId: validatedData.characterId,
        personaId: validatedData.personaId,
      })

      // Validate CHARACTER participant
      if (validatedData.type === 'CHARACTER') {
        if (!validatedData.characterId) {
          return NextResponse.json({ error: 'characterId is required for CHARACTER participants' }, { status: 400 })
        }

        const character = await repos.characters.findById(validatedData.characterId)
        if (!character || character.userId !== user.id) {
          return NextResponse.json({ error: 'Character not found' }, { status: 404 })
        }

        // Determine if this is a user-controlled character
        const controlledBy = validatedData.controlledBy || character.controlledBy || 'llm'
        const isUserControlled = controlledBy === 'user'

        // Connection profile is only required for LLM-controlled characters
        if (!isUserControlled && !validatedData.connectionProfileId) {
          return NextResponse.json({ error: 'connectionProfileId is required for LLM-controlled CHARACTER participants' }, { status: 400 })
        }

        if (validatedData.connectionProfileId) {
          const profile = await repos.connections.findById(validatedData.connectionProfileId)
          if (!profile || profile.userId !== user.id) {
            return NextResponse.json({ error: 'Connection profile not found' }, { status: 404 })
          }
        }

        // Check if character is already in the chat
        const existingParticipant = chat.participants.find(
          p => p.type === 'CHARACTER' && p.characterId === validatedData.characterId && p.isActive
        )
        if (existingParticipant) {
          return NextResponse.json({ error: 'Character is already in this chat' }, { status: 400 })
        }
      }

      // Validate PERSONA participant
      if (validatedData.type === 'PERSONA') {
        if (!validatedData.personaId) {
          return NextResponse.json({ error: 'personaId is required for PERSONA participants' }, { status: 400 })
        }

        const persona = await repos.personas.findById(validatedData.personaId)
        if (!persona || persona.userId !== user.id) {
          return NextResponse.json({ error: 'Persona not found' }, { status: 404 })
        }
      }

      // For CHARACTER participants, determine control mode
      let controlledByValue = validatedData.controlledBy
      if (validatedData.type === 'CHARACTER' && validatedData.characterId && !controlledByValue) {
        // Inherit from character's default if not explicitly specified
        const character = await repos.characters.findById(validatedData.characterId)
        controlledByValue = character?.controlledBy || 'llm'
      }

      // Add the participant
      let result = await repos.chats.addParticipant(id, {
        type: validatedData.type,
        characterId: validatedData.characterId || null,
        personaId: validatedData.personaId || null,
        controlledBy: controlledByValue || (validatedData.type === 'PERSONA' ? 'user' : 'llm'),
        connectionProfileId: validatedData.connectionProfileId || null,
        imageProfileId: validatedData.imageProfileId || null,
        systemPromptOverride: validatedData.systemPromptOverride || null,
        displayOrder: validatedData.displayOrder ?? chat.participants.length,
        isActive: true,
        hasHistoryAccess: validatedData.hasHistoryAccess ?? false,
        joinScenario: validatedData.joinScenario || null,
      })

      if (!result) {
        return NextResponse.json({ error: 'Failed to add participant' }, { status: 500 })
      }

      // If adding a CHARACTER, merge the character's tags into the chat
      if (validatedData.type === 'CHARACTER' && validatedData.characterId) {
        const character = await repos.characters.findById(validatedData.characterId)
        if (character && character.tags && character.tags.length > 0) {
          const existingTagIds = new Set(result.tags || [])
          const newTags = character.tags.filter((tagId: string) => !existingTagIds.has(tagId))

          if (newTags.length > 0) {
            logger.debug('[Participants API] Adding character tags to chat', {
              chatId: id,
              characterId: validatedData.characterId,
              characterName: character.name,
              existingTagCount: existingTagIds.size,
              newTagCount: newTags.length,
            })

            const mergedTags = [...(result.tags || []), ...newTags]
            const updatedChat = await repos.chats.update(id, { tags: mergedTags })
            if (updatedChat) {
              result = updatedChat
            }
          }
        }
      }

      // Return enriched participant data
      const newParticipant = result.participants.find(
        p => (validatedData.type === 'CHARACTER' && p.characterId === validatedData.characterId) ||
             (validatedData.type === 'PERSONA' && p.personaId === validatedData.personaId)
      )

      const enrichedParticipant = newParticipant
        ? await enrichParticipant(newParticipant, repos)
        : null

      logger.info('[Participants API] POST success - participant added', {
        chatId: id,
        participantId: newParticipant?.id,
        type: validatedData.type,
      })

      return NextResponse.json({
        participant: enrichedParticipant,
        chat: result,
      }, { status: 201 })
    } catch (error) {
      if (error instanceof z.ZodError) {
        return NextResponse.json(
          { error: 'Validation error', details: error.errors },
          { status: 400 }
        )
      }

      logger.error('[Participants API] POST error', { context: 'POST /api/chats/:id/participants' }, error instanceof Error ? error : undefined)
      return NextResponse.json({ error: 'Failed to add participant' }, { status: 500 })
    }
  }
)

/**
 * PATCH /api/chats/:id/participants
 * Update a participant's settings
 */
export const PATCH = createAuthenticatedParamsHandler<{ id: string }>(
  async (req: NextRequest, { user, repos }, { id }) => {
    try {
      const chat = await repos.chats.findById(id)

      if (!chat || chat.userId !== user.id) {
        return NextResponse.json({ error: 'Chat not found' }, { status: 404 })
      }

      const body = await req.json()
      const validatedData = updateParticipantSchema.parse(body)

      logger.debug('[Participants API] PATCH request', {
        chatId: id,
        participantId: validatedData.participantId,
      })

      const { participantId, ...updateData } = validatedData

      // Validate connection profile if updating
      if (updateData.connectionProfileId) {
        const profile = await repos.connections.findById(updateData.connectionProfileId)
        if (!profile || profile.userId !== user.id) {
          return NextResponse.json({ error: 'Connection profile not found' }, { status: 404 })
        }
      }

      const result = await repos.chats.updateParticipant(id, participantId, updateData)

      if (!result) {
        return NextResponse.json({ error: 'Participant not found' }, { status: 404 })
      }

      // Return enriched participant data
      const updatedParticipant = result.participants.find(p => p.id === participantId)
      const enrichedParticipant = updatedParticipant
        ? await enrichParticipant(updatedParticipant, repos)
        : null

      logger.info('[Participants API] PATCH success - participant updated', {
        chatId: id,
        participantId,
      })

      return NextResponse.json({
        participant: enrichedParticipant,
        chat: result,
      })
    } catch (error) {
      if (error instanceof z.ZodError) {
        return NextResponse.json(
          { error: 'Validation error', details: error.errors },
          { status: 400 }
        )
      }

      logger.error('[Participants API] PATCH error', { context: 'PATCH /api/chats/:id/participants' }, error instanceof Error ? error : undefined)
      return NextResponse.json({ error: 'Failed to update participant' }, { status: 500 })
    }
  }
)

/**
 * DELETE /api/chats/:id/participants
 * Remove a participant from the chat (soft delete via isActive: false)
 */
export const DELETE = createAuthenticatedParamsHandler<{ id: string }>(
  async (req: NextRequest, { user, repos }, { id }) => {
    try {
      const chat = await repos.chats.findById(id)

      if (!chat || chat.userId !== user.id) {
        return NextResponse.json({ error: 'Chat not found' }, { status: 404 })
      }

      const body = await req.json()
      const validatedData = removeParticipantSchema.parse(body)

      logger.debug('[Participants API] DELETE request', {
        chatId: id,
        participantId: validatedData.participantId,
      })

      // Find the participant to be removed
      const participantToRemove = chat.participants.find(p => p.id === validatedData.participantId)
      if (!participantToRemove) {
        return NextResponse.json({ error: 'Participant not found' }, { status: 404 })
      }

      // Prevent removing the user's persona
      if (participantToRemove.type === 'PERSONA') {
        return NextResponse.json({ error: 'Cannot remove your persona from the chat' }, { status: 400 })
      }

      // Count active characters
      const activeCharacters = chat.participants.filter(p => p.type === 'CHARACTER' && p.isActive)
      if (activeCharacters.length <= 1 && participantToRemove.type === 'CHARACTER') {
        return NextResponse.json({ error: 'Cannot remove the last character from the chat' }, { status: 400 })
      }

      const result = await repos.chats.removeParticipant(id, validatedData.participantId)

      if (!result) {
        return NextResponse.json({ error: 'Failed to remove participant' }, { status: 500 })
      }

      logger.info('[Participants API] DELETE success - participant removed', {
        chatId: id,
        participantId: validatedData.participantId,
      })

      return NextResponse.json({
        success: true,
        chat: result,
      })
    } catch (error) {
      if (error instanceof z.ZodError) {
        return NextResponse.json(
          { error: 'Validation error', details: error.errors },
          { status: 400 }
        )
      }

      if (error instanceof Error && error.message.includes('last participant')) {
        return NextResponse.json({ error: 'Cannot remove the last participant from a chat' }, { status: 400 })
      }

      logger.error('[Participants API] DELETE error', { context: 'DELETE /api/chats/:id/participants' }, error instanceof Error ? error : undefined)
      return NextResponse.json({ error: 'Failed to remove participant' }, { status: 500 })
    }
  }
)
