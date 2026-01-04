// Chat API: Get, Update, Delete
// GET /api/chats/:id - Get chat by ID with messages and participants
// PUT /api/chats/:id - Update chat metadata or participants
// DELETE /api/chats/:id - Delete chat

import { NextRequest, NextResponse } from 'next/server'
import { createAuthenticatedParamsHandler, type AuthenticatedContext } from '@/lib/api/middleware'
import { z } from 'zod'
import type { ChatMetadata } from '@/lib/schemas/types'
import { logger } from '@/lib/logger'
import type { RepositoryContainer } from '@/lib/repositories/factory'
import { getFilePath } from '@/lib/api/middleware/file-path'
import { notFound, badRequest, serverError, validationError } from '@/lib/api/responses'
import { enrichParticipantDetail } from '@/lib/services/chat-enrichment.service'

// Validation schema for chat updates
// Note: roleplayTemplateId accepts any string because plugin templates use 'plugin:' prefix
const updateChatSchema = z.object({
  title: z.string().optional(),
  contextSummary: z.string().optional(),
  roleplayTemplateId: z.string().nullish(),
  isPaused: z.boolean().optional(),
  isManuallyRenamed: z.boolean().optional(),
  documentEditingMode: z.boolean().optional(),
  projectId: z.string().uuid().nullish(),
})

// Validation schema for participant updates
const updateParticipantSchema = z.object({
  participantId: z.string().uuid(),
  connectionProfileId: z.string().uuid().optional(),
  imageProfileId: z.string().uuid().nullish(),
  systemPromptOverride: z.string().nullish(),
  displayOrder: z.number().optional(),
  isActive: z.boolean().optional(),
  controlledBy: z.enum(['llm', 'user']).optional(),  // Who controls this participant
})

// Validation schema for adding a participant
// Note: PERSONA type is deprecated - use CHARACTER with controlledBy='user' instead
const addParticipantSchema = z.object({
  type: z.enum(['CHARACTER', 'PERSONA']),  // PERSONA kept for backwards compatibility
  characterId: z.string().uuid().optional(),
  personaId: z.string().uuid().optional(),  // @deprecated - use characterId with controlledBy='user'
  connectionProfileId: z.string().uuid().optional(),
  imageProfileId: z.string().uuid().nullish(),
  systemPromptOverride: z.string().nullish(),
  displayOrder: z.number().optional(),
  hasHistoryAccess: z.boolean().optional(), // Phase 6: Can see messages from before joining
  joinScenario: z.string().nullish(), // Phase 6: Custom join scenario text
  controlledBy: z.enum(['llm', 'user']).optional(),  // Who controls this participant
})

// Combined update schema
const chatUpdateRequestSchema = z.object({
  chat: updateChatSchema.optional(),
  updateParticipant: updateParticipantSchema.optional(),
  addParticipant: addParticipantSchema.optional(),
  removeParticipantId: z.string().uuid().optional(),
  // Direct roleplay template update (convenience shorthand)
  // Note: accepts any string because plugin templates use 'plugin:' prefix
  roleplayTemplateId: z.string().nullish(),
})

type Repos = RepositoryContainer

// Helper to validate CHARACTER participant requirements
async function validateCharacterParticipant(
  data: z.infer<typeof addParticipantSchema>,
  userId: string,
  repos: Repos
): Promise<{ error: string; status: number } | null> {
  if (!data.characterId) {
    return { error: 'characterId is required for CHARACTER participants', status: 400 }
  }

  const character = await repos.characters.findById(data.characterId)
  if (!character || character.userId !== userId) {
    return { error: 'Character not found', status: 404 }
  }

  // Determine if this is a user-controlled character
  const controlledBy = data.controlledBy || character.controlledBy || 'llm'
  const isUserControlled = controlledBy === 'user'

  // Connection profile is only required for LLM-controlled characters
  if (!isUserControlled && !data.connectionProfileId) {
    return { error: 'connectionProfileId is required for LLM-controlled CHARACTER participants', status: 400 }
  }

  if (data.connectionProfileId) {
    const profile = await repos.connections.findById(data.connectionProfileId)
    if (!profile || profile.userId !== userId) {
      return { error: 'Connection profile not found', status: 404 }
    }
  }

  return null
}

// Helper to validate PERSONA participant requirements
async function validatePersonaParticipant(
  data: z.infer<typeof addParticipantSchema>,
  userId: string,
  repos: Repos
): Promise<{ error: string; status: number } | null> {
  if (!data.personaId) {
    return { error: 'personaId is required for PERSONA participants', status: 400 }
  }

  const persona = await repos.personas.findById(data.personaId)
  if (!persona || persona.userId !== userId) {
    return { error: 'Persona not found', status: 404 }
  }

  return null
}

// Helper to handle participant update
async function handleParticipantUpdate(
  chatId: string,
  data: z.infer<typeof updateParticipantSchema>,
  userId: string,
  repos: Repos
): Promise<{ chat: ChatMetadata } | { error: string; status: number }> {
  const { participantId, ...participantData } = data

  if (participantData.connectionProfileId) {
    const profile = await repos.connections.findById(participantData.connectionProfileId)
    if (!profile || profile.userId !== userId) {
      return { error: 'Connection profile not found', status: 404 }
    }
  }

  if (participantData.imageProfileId) {
    const profile = await repos.imageProfiles.findById(participantData.imageProfileId)
    if (!profile || profile.userId !== userId) {
      return { error: 'Image profile not found', status: 404 }
    }
  }

  // Get current chat state to handle impersonation changes
  const chat = await repos.chats.findById(chatId)
  if (!chat) {
    return { error: 'Chat not found', status: 404 }
  }

  const result = await repos.chats.updateParticipant(chatId, participantId, participantData)
  if (!result) {
    return { error: 'Participant not found', status: 404 }
  }

  // Handle impersonation array updates when controlledBy changes
  if (participantData.controlledBy !== undefined) {
    const currentImpersonating = chat.impersonatingParticipantIds || []
    const isCurrentlyImpersonating = currentImpersonating.includes(participantId)

    if (participantData.controlledBy === 'user' && !isCurrentlyImpersonating) {
      // Switching to user control - add to impersonation array
      logger.debug('[handleParticipantUpdate] Adding participant to impersonation', { chatId, participantId })
      const newImpersonating = [...currentImpersonating, participantId]
      await repos.chats.update(chatId, {
        impersonatingParticipantIds: newImpersonating,
        // Set as active typing if no one else is
        ...(result.activeTypingParticipantId ? {} : { activeTypingParticipantId: participantId }),
      })
    } else if (participantData.controlledBy === 'llm' && isCurrentlyImpersonating) {
      // Switching to LLM control - remove from impersonation array
      logger.debug('[handleParticipantUpdate] Removing participant from impersonation', { chatId, participantId })
      const newImpersonating = currentImpersonating.filter(id => id !== participantId)
      const updateData: Partial<ChatMetadata> = { impersonatingParticipantIds: newImpersonating }

      // Clear active typing if it was this participant
      if (result.activeTypingParticipantId === participantId) {
        updateData.activeTypingParticipantId = newImpersonating[0] || null
      }

      await repos.chats.update(chatId, updateData)
    }

    // Re-fetch to get updated state
    const updatedChat = await repos.chats.findById(chatId)
    if (updatedChat) {
      return { chat: updatedChat }
    }
  }

  return { chat: result }
}

// Helper to handle adding a participant
async function handleAddParticipant(
  chatId: string,
  data: z.infer<typeof addParticipantSchema>,
  currentParticipantCount: number,
  userId: string,
  repos: Repos
): Promise<{ chat: ChatMetadata } | { error: string; status: number }> {
  if (data.type === 'CHARACTER') {
    const validationError = await validateCharacterParticipant(data, userId, repos)
    if (validationError) return validationError
  }

  if (data.type === 'PERSONA') {
    const validationError = await validatePersonaParticipant(data, userId, repos)
    if (validationError) return validationError
  }

  // For CHARACTER participants, determine control mode
  let controlledBy = data.controlledBy
  if (data.type === 'CHARACTER' && data.characterId && !controlledBy) {
    // Inherit from character's default if not explicitly specified
    const character = await repos.characters.findById(data.characterId)
    controlledBy = character?.controlledBy || 'llm'
  }

  const result = await repos.chats.addParticipant(chatId, {
    type: data.type,
    characterId: data.characterId || null,
    personaId: data.personaId || null,
    controlledBy: controlledBy || (data.type === 'PERSONA' ? 'user' : 'llm'),
    connectionProfileId: data.connectionProfileId || null,
    imageProfileId: data.imageProfileId || null,
    systemPromptOverride: data.systemPromptOverride || null,
    displayOrder: data.displayOrder ?? currentParticipantCount,
    isActive: true,
    hasHistoryAccess: data.hasHistoryAccess ?? false, // Phase 6
    joinScenario: data.joinScenario || null, // Phase 6
  })

  if (!result) {
    return { error: 'Failed to add participant', status: 500 }
  }

  // If adding a CHARACTER, merge the character's tags into the chat
  if (data.type === 'CHARACTER' && data.characterId) {
    const character = await repos.characters.findById(data.characterId)
    if (character && character.tags && character.tags.length > 0) {
      const existingTagIds = new Set(result.tags || [])
      const newTags = character.tags.filter((tagId: string) => !existingTagIds.has(tagId))

      if (newTags.length > 0) {
        logger.debug('Adding character tags to chat', {
          chatId,
          characterId: data.characterId,
          characterName: character.name,
          existingTagCount: existingTagIds.size,
          newTagCount: newTags.length,
        })

        const mergedTags = [...(result.tags || []), ...newTags]
        const updatedChat = await repos.chats.update(chatId, { tags: mergedTags })
        if (updatedChat) {
          return { chat: updatedChat }
        }
      }
    }
  }

  return { chat: result }
}

// Helper to handle removing a participant
async function handleRemoveParticipant(
  chatId: string,
  participantId: string,
  repos: Repos
): Promise<{ chat: ChatMetadata } | { error: string; status: number }> {
  try {
    const result = await repos.chats.removeParticipant(chatId, participantId)
    if (!result) {
      return { error: 'Participant not found', status: 404 }
    }
    return { chat: result }
  } catch (error) {
    if (error instanceof Error && error.message.includes('last participant')) {
      return { error: 'Cannot remove the last participant from a chat', status: 400 }
    }
    throw error
  }
}

// GET /api/chats/:id
export const GET = createAuthenticatedParamsHandler<{ id: string }>(
  async (req: NextRequest, { user, repos }: AuthenticatedContext, { id }) => {
    try {
      const chatMetadata = await repos.chats.findById(id)

      if (!chatMetadata || chatMetadata.userId !== user.id) {
        return notFound('Chat')
      }

      const enrichedParticipants = await Promise.all(
        chatMetadata.participants.map(p => enrichParticipantDetail(p, repos))
      )

      const chatEvents = await repos.chats.getMessages(id)
      const messages = await Promise.all(
        chatEvents
          .filter(event => event.type === 'message')
          .map(async event => {
            if (event.type !== 'message') return null

            // Get attachments from repository using linkedTo
            const linkedFiles = await repos.files.findByLinkedTo(event.id)
            const attachments = linkedFiles.map(file => ({
              id: file.id,
              filename: file.originalFilename,
              filepath: getFilePath(file),
              mimeType: file.mimeType,
            }))

            return {
              id: event.id,
              role: event.role,
              content: event.content,
              tokenCount: event.tokenCount || null,
              promptTokens: event.promptTokens || null,
              completionTokens: event.completionTokens || null,
              createdAt: event.createdAt,
              swipeGroupId: event.swipeGroupId || null,
              swipeIndex: event.swipeIndex || null,
              participantId: event.participantId || null,
              attachments,
              debugMemoryLogs: event.debugMemoryLogs || undefined,
            }
          })
      ).then(results => results.filter(Boolean))

      // Fetch project name if chat belongs to a project
      let projectName: string | null = null
      if (chatMetadata.projectId) {
        try {
          const project = await repos.projects.findById(chatMetadata.projectId)
          if (project) {
            projectName = project.name
          }
        } catch {
          // Project might have been deleted
        }
      }

      const chat = {
        id: chatMetadata.id,
        title: chatMetadata.title,
        contextSummary: chatMetadata.contextSummary,
        roleplayTemplateId: chatMetadata.roleplayTemplateId,
        lastTurnParticipantId: chatMetadata.lastTurnParticipantId ?? null,
        isPaused: chatMetadata.isPaused ?? false,
        isManuallyRenamed: chatMetadata.isManuallyRenamed ?? false,
        updatedAt: chatMetadata.updatedAt,
        createdAt: chatMetadata.createdAt,
        participants: enrichedParticipants,
        user: { id: user.id, name: user.name, image: user.image },
        messages,
        projectId: chatMetadata.projectId || null,
        projectName,
      }

      return NextResponse.json({ chat })
    } catch (error) {
      logger.error('Error fetching chat', { context: 'GET /api/chats/:id' }, error instanceof Error ? error : undefined)
      return serverError('Failed to fetch chat')
    }
  }
)

// Helper to process all chat update operations
async function processChatUpdates(
  chatId: string,
  existingChat: ChatMetadata,
  validatedData: z.infer<typeof chatUpdateRequestSchema>,
  userId: string,
  repos: Repos
): Promise<{ chat: ChatMetadata } | { error: string; status: number }> {
  let updatedChat = existingChat

  // Handle direct roleplayTemplateId update (convenience shorthand)
  if (typeof validatedData.roleplayTemplateId !== 'undefined') {
    // Validate template exists if setting a non-null value
    if (validatedData.roleplayTemplateId !== null) {
      const template = await repos.roleplayTemplates.findById(validatedData.roleplayTemplateId)
      if (!template) {
        return { error: 'Roleplay template not found', status: 404 }
      }
    }

    logger.debug('Updating chat roleplay template', {
      chatId,
      templateId: validatedData.roleplayTemplateId,
    })

    const result = await repos.chats.update(chatId, {
      roleplayTemplateId: validatedData.roleplayTemplateId,
    })
    if (result) updatedChat = result
  }

  if (validatedData.chat) {
    // Also validate roleplayTemplateId if included in nested chat object
    if (validatedData.chat.roleplayTemplateId !== undefined && validatedData.chat.roleplayTemplateId !== null) {
      const template = await repos.roleplayTemplates.findById(validatedData.chat.roleplayTemplateId)
      if (!template) {
        return { error: 'Roleplay template not found', status: 404 }
      }
    }

    // Handle projectId change
    if (validatedData.chat.projectId !== undefined) {
      if (validatedData.chat.projectId !== null) {
        // Validate new project exists and belongs to user
        const project = await repos.projects.findById(validatedData.chat.projectId)
        if (!project || project.userId !== userId) {
          return { error: 'Project not found', status: 404 }
        }

        // Auto-add characters to project roster if not using allowAnyCharacter
        if (!project.allowAnyCharacter) {
          const characterIds = updatedChat.participants
            .filter(p => p.type === 'CHARACTER' && p.characterId)
            .map(p => p.characterId as string)

          const newCharacterIds = characterIds.filter(id => !project.characterRoster.includes(id))
          if (newCharacterIds.length > 0) {
            logger.debug('Auto-adding characters to project roster on chat move', {
              chatId,
              projectId: validatedData.chat.projectId,
              newCharacterIds,
            })
            await repos.projects.update(validatedData.chat.projectId, {
              characterRoster: [...project.characterRoster, ...newCharacterIds],
            })
          }
        }
      }
    }

    const result = await repos.chats.update(chatId, validatedData.chat)
    if (result) updatedChat = result
  }

  if (validatedData.updateParticipant) {
    const result = await handleParticipantUpdate(chatId, validatedData.updateParticipant, userId, repos)
    if ('error' in result) return result
    updatedChat = result.chat
  }

  if (validatedData.addParticipant) {
    const result = await handleAddParticipant(
      chatId,
      validatedData.addParticipant,
      updatedChat.participants.length,
      userId,
      repos
    )
    if ('error' in result) return result
    updatedChat = result.chat
  }

  if (validatedData.removeParticipantId) {
    const result = await handleRemoveParticipant(chatId, validatedData.removeParticipantId, repos)
    if ('error' in result) return result
    updatedChat = result.chat
  }

  return { chat: updatedChat }
}

// PUT /api/chats/:id
export const PUT = createAuthenticatedParamsHandler<{ id: string }>(
  async (req: NextRequest, { user, repos }: AuthenticatedContext, { id }) => {
    try {
      const existingChat = await repos.chats.findById(id)

      if (!existingChat || existingChat.userId !== user.id) {
        return notFound('Chat')
      }

      const body = await req.json()
      const validatedData = chatUpdateRequestSchema.parse(body)

      const result = await processChatUpdates(id, existingChat, validatedData, user.id, repos)

      if ('error' in result) {
        if (result.status === 404) {
          return notFound('Resource')
        } else if (result.status === 400) {
          return badRequest(result.error)
        }
        return serverError(result.error)
      }

      const enrichedParticipants = await Promise.all(
        result.chat.participants.map(p => enrichParticipantDetail(p, repos))
      )

      return NextResponse.json({
        chat: { ...result.chat, participants: enrichedParticipants }
      })
    } catch (error) {
      if (error instanceof z.ZodError) {
        return validationError(error)
      }

      logger.error('Error updating chat', { context: 'PUT /api/chats/:id' }, error instanceof Error ? error : undefined)
      return serverError('Failed to update chat')
    }
  }
)

// DELETE /api/chats/:id
export const DELETE = createAuthenticatedParamsHandler<{ id: string }>(
  async (req: NextRequest, { user, repos }: AuthenticatedContext, { id }) => {
    try {
      const existingChat = await repos.chats.findById(id)

      if (!existingChat || existingChat.userId !== user.id) {
        return notFound('Chat')
      }

      await repos.chats.delete(id)

      return NextResponse.json({ success: true })
    } catch (error) {
      logger.error('Error deleting chat', { context: 'DELETE /api/chats/:id' }, error instanceof Error ? error : undefined)
      return serverError('Failed to delete chat')
    }
  }
)
