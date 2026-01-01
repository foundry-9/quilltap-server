/**
 * Message Re-attribution API
 * POST /api/messages/:id/reattribute - Re-attribute a message to a different participant
 *
 * This endpoint allows changing which character/persona is credited with sending a message.
 * When re-attributed, any memories associated with the message are deleted.
 */

import { NextResponse } from 'next/server'
import { createAuthenticatedParamsHandler } from '@/lib/api/middleware'
import { logger } from '@/lib/logger'
import { deleteMemoryWithVector } from '@/lib/memory/memory-service'
import type { ChatEvent, MessageEvent, ChatMetadata, ChatParticipant } from '@/lib/schemas/types'

export const POST = createAuthenticatedParamsHandler<{ id: string }>(
  async (req, { user, repos }, { id: messageId }) => {
    try {
      const body = await req.json()
      const { newParticipantId } = body

      if (!newParticipantId) {
        logger.warn('Re-attribution missing newParticipantId', { messageId })
        return NextResponse.json(
          { error: 'newParticipantId is required' },
          { status: 400 }
        )
      }

      logger.debug('Processing message re-attribution', { messageId, newParticipantId })

      // Find the message across user's chats only (security: filter by userId)
      const userChats = await repos.chats.findByUserId(user.id)
      let foundChat: ChatMetadata | null = null
      let foundMessage: MessageEvent | null = null
      let allMessages: ChatEvent[] = []
      let messageIndex = -1

      for (const chat of userChats) {
        const messages = await repos.chats.getMessages(chat.id)
        const idx = messages.findIndex(
          (m): m is MessageEvent => m.type === 'message' && m.id === messageId
        )
        if (idx !== -1) {
          foundChat = chat
          foundMessage = messages[idx] as MessageEvent
          allMessages = messages
          messageIndex = idx
          break
        }
      }

      if (!foundMessage || !foundChat) {
        logger.warn('Message not found for re-attribution', { messageId, userId: user.id })
        return NextResponse.json({ error: 'Message not found' }, { status: 404 })
      }

      // Validate the target participant exists in the chat
      const targetParticipant = foundChat.participants.find(
        (p: ChatParticipant) => p.id === newParticipantId
      )

      if (!targetParticipant) {
        logger.warn('Target participant not found in chat', {
          messageId,
          chatId: foundChat.id,
          newParticipantId,
        })
        return NextResponse.json(
          { error: 'Target participant not found in chat' },
          { status: 400 }
        )
      }

      // Find and delete memories associated with this message
      const memoriesFromMessage = await repos.memories.findBySourceMessageId(messageId)
      let memoriesDeleted = 0

      logger.debug('Found memories to delete for re-attribution', {
        messageId,
        memoryCount: memoriesFromMessage.length,
      })

      for (const memory of memoriesFromMessage) {
        try {
          const deleted = await deleteMemoryWithVector(memory.characterId, memory.id)
          if (deleted) {
            memoriesDeleted++
            logger.debug('Deleted memory during re-attribution', {
              memoryId: memory.id,
              characterId: memory.characterId,
            })
          }
        } catch (error) {
          logger.error('Failed to delete memory during re-attribution', {
            memoryId: memory.id,
            error: error instanceof Error ? error.message : String(error),
          })
        }
      }

      // Update the message's participantId
      const updatedMessage: MessageEvent = {
        ...foundMessage,
        participantId: newParticipantId,
      }

      // Update the message in the array
      allMessages[messageIndex] = updatedMessage

      // Rewrite all messages (since we need to update in place)
      await repos.chats.clearMessages(foundChat.id)
      for (const msg of allMessages) {
        await repos.chats.addMessage(foundChat.id, msg)
      }

      // Update chat's updatedAt timestamp
      await repos.chats.update(foundChat.id, {})

      logger.info('Message re-attributed successfully', {
        messageId,
        chatId: foundChat.id,
        oldParticipantId: foundMessage.participantId,
        newParticipantId,
        memoriesDeleted,
      })

      return NextResponse.json({
        success: true,
        message: updatedMessage,
        memoriesDeleted,
      })
    } catch (error) {
      logger.error('Error re-attributing message', {
        endpoint: '/api/messages/[id]/reattribute',
        method: 'POST',
      }, error instanceof Error ? error : undefined)
      return NextResponse.json(
        { error: 'Failed to re-attribute message' },
        { status: 500 }
      )
    }
  }
)
