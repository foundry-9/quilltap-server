/**
 * Message Memories API
 * GET /api/messages/:id/memories - Get memory count and info for a message
 */

import { NextResponse } from 'next/server'
import { createAuthenticatedParamsHandler } from '@/lib/api/middleware'
import { notFound, serverError } from '@/lib/api/responses'
import { logger } from '@/lib/logger'
import type { ChatEvent, MessageEvent, ChatMetadata } from '@/lib/schemas/types'

export const GET = createAuthenticatedParamsHandler<{ id: string }>(
  async (req, { user, repos }, { id }) => {
    try {
      logger.debug('Getting memory count for message', {
        endpoint: '/api/messages/[id]/memories',
        method: 'GET',
        messageId: id,
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
        return notFound('Message')
      }

      // Get all message IDs in swipe group if applicable
      let messageIds: string[] = [id]
      if (foundMessage.swipeGroupId) {
        messageIds = allMessages
          .filter(
            (m): m is MessageEvent =>
              m.type === 'message' && m.swipeGroupId === foundMessage!.swipeGroupId
          )
          .map((m) => m.id)
      }

      // Get memory count
      const memoryCount = await repos.memories.countBySourceMessageIds(messageIds)

      // Get memory details if there are any
      let memories: Array<{
        id: string
        summary: string
        characterId: string
        importance: number
      }> = []

      if (memoryCount > 0) {
        const memoryResults = await Promise.all(
          messageIds.map((mid) => repos.memories.findBySourceMessageId(mid))
        )
        memories = memoryResults.flat().map((m) => ({
          id: m.id,
          summary: m.summary,
          characterId: m.characterId,
          importance: m.importance,
        }))
      }

      logger.debug('Retrieved memory count for message', {
        messageId: id,
        memoryCount,
        isSwipeGroup: !!foundMessage.swipeGroupId,
        swipeCount: messageIds.length,
      })

      return NextResponse.json({
        memoryCount,
        isSwipeGroup: !!foundMessage.swipeGroupId,
        swipeCount: messageIds.length,
        memories,
      })
    } catch (error) {
      logger.error(
        'Error getting message memories',
        { endpoint: '/api/messages/[id]/memories', method: 'GET' },
        error instanceof Error ? error : undefined
      )
      return serverError('Failed to get message memories')
    }
  }
)
