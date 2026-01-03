/**
 * Bulk Message Re-attribution API
 * POST /api/chats/:id/bulk-reattribute - Re-attribute multiple messages to a different participant
 *
 * This endpoint allows changing which character/persona is credited with sending
 * multiple messages in a single operation. All memories associated with the
 * affected messages are deleted.
 */

import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createAuthenticatedParamsHandler } from '@/lib/api/middleware'
import { badRequest, notFound, serverError } from '@/lib/api/responses'
import { logger } from '@/lib/logger'
import { deleteMemoryWithVector } from '@/lib/memory/memory-service'
import type { ChatEvent, MessageEvent, ChatParticipant, ChatMetadata } from '@/lib/schemas/types'

const BulkReattributeRequestSchema = z.object({
  sourceParticipantId: z.string().uuid().nullable(), // null means unassigned (actual user)
  targetParticipantId: z.string().uuid(),
  roleFilter: z.enum(['ASSISTANT', 'USER', 'both']).default('both'),
})

export const POST = createAuthenticatedParamsHandler<{ id: string }>(
  async (req, { user, repos }, { id: chatId }) => {
    try {
      const body = await req.json()
      const parsed = BulkReattributeRequestSchema.safeParse(body)

      if (!parsed.success) {
        logger.warn('Bulk re-attribution validation failed', {
          chatId,
          errors: parsed.error.flatten(),
        })
        return badRequest('Invalid request: ' + parsed.error.message)
      }

      const { sourceParticipantId, targetParticipantId, roleFilter } = parsed.data

      if (sourceParticipantId === targetParticipantId) {
        logger.warn('Bulk re-attribution source equals target', { chatId })
        return badRequest('Source and target participants must be different')
      }

      logger.debug('Processing bulk message re-attribution', {
        chatId,
        sourceParticipantId,
        targetParticipantId,
        roleFilter,
      })

      // Verify chat exists and user has access (same pattern as reattribute route)
      const userChats = await repos.chats.findByUserId(user.id)
      const chat = userChats.find((c: ChatMetadata) => c.id === chatId)
      if (!chat) {
        logger.warn('Chat not found for bulk re-attribution', { chatId, userId: user.id })
        return notFound('Chat')
      }

      // Validate participants exist in this chat
      // sourceParticipantId can be null (unassigned/actual user messages)
      if (sourceParticipantId !== null) {
        const sourceParticipant = chat.participants.find(
          (p: ChatParticipant) => p.id === sourceParticipantId
        )
        if (!sourceParticipant) {
          logger.warn('Source participant not found in chat', {
            chatId,
            sourceParticipantId,
          })
          return badRequest('Source participant not found in chat')
        }
      }

      const targetParticipant = chat.participants.find(
        (p: ChatParticipant) => p.id === targetParticipantId
      )
      if (!targetParticipant) {
        logger.warn('Target participant not found in chat', {
          chatId,
          targetParticipantId,
        })
        return badRequest('Target participant not found in chat')
      }

      // Get all messages
      const allMessages = await repos.chats.getMessages(chatId)

      // Find all messages matching the criteria
      const affectedMessages = allMessages.filter((msg): msg is MessageEvent => {
        if (msg.type !== 'message') return false
        // Handle null sourceParticipantId (unassigned messages)
        if (sourceParticipantId === null) {
          // Match messages with null or undefined participantId
          if (msg.participantId !== null && msg.participantId !== undefined) return false
        } else {
          if (msg.participantId !== sourceParticipantId) return false
        }
        if (roleFilter === 'both') return true
        return msg.role === roleFilter
      })

      logger.debug('Found messages to re-attribute', {
        chatId,
        affectedCount: affectedMessages.length,
        roleFilter,
      })

      if (affectedMessages.length === 0) {
        return NextResponse.json({
          success: true,
          messagesUpdated: 0,
          memoriesDeleted: 0,
        })
      }

      // Delete memories for all affected messages
      let memoriesDeleted = 0
      const affectedMessageIds = new Set(affectedMessages.map((m) => m.id))

      for (const msg of affectedMessages) {
        const memoriesFromMessage = await repos.memories.findBySourceMessageId(msg.id)

        logger.debug('Found memories for message', {
          messageId: msg.id,
          memoryCount: memoriesFromMessage.length,
        })

        for (const memory of memoriesFromMessage) {
          try {
            const deleted = await deleteMemoryWithVector(memory.characterId, memory.id)
            if (deleted) {
              memoriesDeleted++
              logger.debug('Deleted memory during bulk re-attribution', {
                memoryId: memory.id,
                characterId: memory.characterId,
                sourceMessageId: msg.id,
              })
            }
          } catch (error) {
            logger.error('Failed to delete memory during bulk re-attribution', {
              memoryId: memory.id,
              error: error instanceof Error ? error.message : String(error),
            })
            // Continue with other memories - best effort cleanup
          }
        }
      }

      // Update all messages
      const updatedMessages: ChatEvent[] = allMessages.map((msg) => {
        if (msg.type === 'message' && affectedMessageIds.has(msg.id)) {
          return { ...msg, participantId: targetParticipantId }
        }
        return msg
      })

      // Rewrite all messages using the existing pattern
      await repos.chats.clearMessages(chatId)
      for (const msg of updatedMessages) {
        await repos.chats.addMessage(chatId, msg)
      }

      // Update chat's updatedAt timestamp
      await repos.chats.update(chatId, {})

      logger.info('Bulk character replace completed', {
        chatId,
        sourceParticipantId,
        targetParticipantId,
        roleFilter,
        messagesUpdated: affectedMessages.length,
        memoriesDeleted,
      })

      return NextResponse.json({
        success: true,
        messagesUpdated: affectedMessages.length,
        memoriesDeleted,
      })
    } catch (error) {
      logger.error(
        'Error in bulk re-attribution',
        {
          endpoint: '/api/chats/[id]/bulk-reattribute',
          method: 'POST',
          chatId,
        },
        error instanceof Error ? error : undefined
      )
      return serverError('Failed to re-attribute messages')
    }
  }
)
