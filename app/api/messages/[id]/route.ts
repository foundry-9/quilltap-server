/**
 * Message API
 * PUT /api/messages/:id - Edit a message
 * DELETE /api/messages/:id - Delete a message (with optional memory cascade)
 */

import { NextResponse } from 'next/server'
import { createAuthenticatedParamsHandler } from '@/lib/api/middleware'
import { logger } from '@/lib/logger'
import { deleteMemoriesBySourceMessagesWithVectors } from '@/lib/memory/memory-service'
import type { ChatEvent, MessageEvent, ChatMetadata } from '@/lib/schemas/types'
import type { MemoryCascadeAction } from '@/lib/schemas/settings.types'

export const PUT = createAuthenticatedParamsHandler<{ id: string }>(
  async (req, { user, repos }, { id }) => {
    try {
      const body = await req.json()
      const { content } = body

      if (!content) {
        return NextResponse.json(
          { error: 'Content is required' },
          { status: 400 }
        )
      }

      // Find the message across user's chats only (security: filter by userId)
      const userChats = await repos.chats.findByUserId(user.id)
      let foundChat: ChatMetadata | null = null
      let foundMessage: MessageEvent | null = null
      let allMessages: ChatEvent[] = []
      let messageIndex = -1

      for (const chat of userChats) {
        const messages = await repos.chats.getMessages(chat.id)
        const idx = messages.findIndex(
          (m): m is MessageEvent => m.type === 'message' && m.id === id
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
        return NextResponse.json({ error: 'Message not found' }, { status: 404 })
      }

      // Update the message content
      const updatedMessage: MessageEvent = {
        ...foundMessage,
        content,
      }

      // Update the message in the array
      allMessages[messageIndex] = updatedMessage

      // Rewrite all messages (since we need to update in place)
      // Clear and rewrite the chat messages file
      await repos.chats.clearMessages(foundChat.id)
      for (const msg of allMessages) {
        await repos.chats.addMessage(foundChat.id, msg)
      }

      // Update chat's updatedAt timestamp
      await repos.chats.update(foundChat.id, {})

      return NextResponse.json(updatedMessage)
    } catch (error) {
      logger.error('Error updating message', { endpoint: '/api/messages/[id]', method: 'PUT' }, error instanceof Error ? error : undefined)
      return NextResponse.json(
        { error: 'Failed to update message' },
        { status: 500 }
      )
    }
  }
)

export const DELETE = createAuthenticatedParamsHandler<{ id: string }>(
  async (req, { user, repos }, { id }) => {
    try {
      // Parse query params for memory handling
      const { searchParams } = new URL(req.url)
      const memoryAction = searchParams.get('memoryAction') as MemoryCascadeAction | null
      const skipConfirmation = searchParams.get('skipConfirmation') === 'true'

      logger.debug('Deleting message', {
        endpoint: '/api/messages/[id]',
        method: 'DELETE',
        messageId: id,
        memoryAction,
        skipConfirmation,
      })

      // Find the message across user's chats only (security: filter by userId)
      const userChats = await repos.chats.findByUserId(user.id)
      let foundChat: ChatMetadata | null = null
      let foundMessage: MessageEvent | null = null
      let allMessages: ChatEvent[] = []

      for (const chat of userChats) {
        const messages = await repos.chats.getMessages(chat.id)
        const message = messages.find(
          (m): m is MessageEvent => m.type === 'message' && m.id === id
        )
        if (message) {
          foundChat = chat
          foundMessage = message
          allMessages = messages
          break
        }
      }

      if (!foundMessage || !foundChat) {
        return NextResponse.json({ error: 'Message not found' }, { status: 404 })
      }

      // Collect all message IDs to be deleted (for memory cascade)
      let messageIdsToDelete: string[] = []
      if (foundMessage.swipeGroupId) {
        // Get all messages in swipe group
        messageIdsToDelete = allMessages
          .filter(
            (m): m is MessageEvent =>
              m.type === 'message' && m.swipeGroupId === foundMessage!.swipeGroupId
          )
          .map((m) => m.id)
      } else {
        messageIdsToDelete = [id]
      }

      // Check for associated memories
      const memoryCount = await repos.memories.countBySourceMessageIds(messageIdsToDelete)

      // If memories exist and no action specified, return info for confirmation dialog
      if (memoryCount > 0 && !memoryAction && !skipConfirmation) {
        logger.debug('Message has associated memories, returning for confirmation', {
          messageId: id,
          memoryCount,
          isSwipeGroup: !!foundMessage.swipeGroupId,
        })

        return NextResponse.json(
          {
            requiresConfirmation: true,
            memoryCount,
            messageIds: messageIdsToDelete,
            isSwipeGroup: !!foundMessage.swipeGroupId,
          },
          { status: 200 }
        )
      }

      // Handle memory cascade based on action
      let memoriesDeleted = 0
      if (memoryCount > 0 && memoryAction && memoryAction !== 'KEEP_MEMORIES') {
        if (memoryAction === 'DELETE_MEMORIES' || memoryAction === 'REGENERATE_MEMORIES') {
          const { deleted, vectorsRemoved } =
            await deleteMemoriesBySourceMessagesWithVectors(messageIdsToDelete)

          memoriesDeleted = deleted
          logger.info('Cascade deleted memories with message', {
            messageId: id,
            memoriesDeleted: deleted,
            vectorsRemoved,
          })
        }

        // TODO: If REGENERATE_MEMORIES, trigger memory re-extraction job
        // This would require getting the context around the deleted message
        // and re-running memory extraction. For now, we just delete.
        if (memoryAction === 'REGENERATE_MEMORIES') {
          logger.debug('Memory regeneration requested - not yet implemented', {
            messageId: id,
          })
        }
      }

      // If this message is part of a swipe group, delete all messages in the group
      let filteredMessages: ChatEvent[]
      if (foundMessage.swipeGroupId) {
        filteredMessages = allMessages.filter(
          (m) =>
            m.type !== 'message' ||
            (m as MessageEvent).swipeGroupId !== foundMessage!.swipeGroupId
        )
      } else {
        // Delete single message
        filteredMessages = allMessages.filter(
          (m) => m.type !== 'message' || m.id !== id
        )
      }

      // Rewrite all messages without the deleted one(s)
      await repos.chats.clearMessages(foundChat.id)
      for (const msg of filteredMessages) {
        await repos.chats.addMessage(foundChat.id, msg)
      }

      // Update chat's updatedAt timestamp
      await repos.chats.update(foundChat.id, {})

      return NextResponse.json({
        success: true,
        memoriesDeleted,
      })
    } catch (error) {
      logger.error('Error deleting message', { endpoint: '/api/messages/[id]', method: 'DELETE' }, error instanceof Error ? error : undefined)
      return NextResponse.json(
        { error: 'Failed to delete message' },
        { status: 500 }
      )
    }
  }
)
