// Chat Tags API: Manage tags for a specific chat
// GET /api/chats/[id]/tags - Get all tags for a chat
// POST /api/chats/[id]/tags - Add a tag to a chat
// DELETE /api/chats/[id]/tags?tagId=xxx - Remove a tag from a chat

import { NextRequest, NextResponse } from 'next/server'
import { createAuthenticatedParamsHandler } from '@/lib/api/middleware'
import { logger } from '@/lib/logger'
import { z } from 'zod'
import { notFound, forbidden, badRequest, serverError, validationError } from '@/lib/api/responses'

const addTagSchema = z.object({
  tagId: z.string().uuid(),
})

// GET /api/chats/[id]/tags - Get all tags for a chat
export const GET = createAuthenticatedParamsHandler<{ id: string }>(
  async (req: NextRequest, { user, repos }, { id }) => {
    try {
      const chatId = id

      // Verify chat exists and belongs to user
      const chat = await repos.chats.findById(chatId)

      if (!chat) {
        return notFound('Chat')
      }

      if (chat.userId !== user.id) {
        return forbidden()
      }

      // Get tags for this chat
      const allTags = await repos.tags.findAll()
      const chatTags = allTags
        .filter(tag => chat.tags.includes(tag.id))
        .map(tag => ({
          id: tag.id,
          name: tag.name,
          createdAt: tag.createdAt,
        }))
        .sort((a, b) => a.name.localeCompare(b.name))

      return NextResponse.json({ tags: chatTags })
    } catch (error) {
      logger.error('Error fetching chat tags', { endpoint: '/api/chats/[id]/tags', method: 'GET' }, error instanceof Error ? error : undefined)
      return serverError('Failed to fetch chat tags')
    }
  }
)

// POST /api/chats/[id]/tags - Add a tag to a chat
export const POST = createAuthenticatedParamsHandler<{ id: string }>(
  async (req: NextRequest, { user, repos }, { id }) => {
    try {
      const chatId = id

      // Verify chat exists and belongs to user
      const chat = await repos.chats.findById(chatId)

      if (!chat) {
        return notFound('Chat')
      }

      if (chat.userId !== user.id) {
        return forbidden()
      }

      const body = await req.json()
      const validatedData = addTagSchema.parse(body)

      // Verify tag exists and belongs to user
      const tag = await repos.tags.findById(validatedData.tagId)

      if (!tag) {
        return notFound('Tag')
      }

      if (tag.userId !== user.id) {
        return forbidden()
      }

      // Add tag to chat
      await repos.chats.addTag(chatId, validatedData.tagId)

      return NextResponse.json({ tag }, { status: 201 })
    } catch (error) {
      if (error instanceof z.ZodError) {
        return validationError(error)
      }

      logger.error('Error adding tag to chat', { endpoint: '/api/chats/[id]/tags', method: 'POST' }, error instanceof Error ? error : undefined)
      return serverError('Failed to add tag to chat')
    }
  }
)

// DELETE /api/chats/[id]/tags?tagId=xxx - Remove a tag from a chat
export const DELETE = createAuthenticatedParamsHandler<{ id: string }>(
  async (req: NextRequest, { user, repos }, { id }) => {
    try {
      const chatId = id
      const tagId = req.nextUrl.searchParams.get('tagId')

      if (!tagId) {
        return badRequest('tagId query parameter is required')
      }

      // Verify chat exists and belongs to user
      const chat = await repos.chats.findById(chatId)

      if (!chat) {
        return notFound('Chat')
      }

      if (chat.userId !== user.id) {
        return forbidden()
      }

      // Remove tag from chat
      await repos.chats.removeTag(chatId, tagId)

      return NextResponse.json({ success: true })
    } catch (error) {
      logger.error('Error removing tag from chat', { endpoint: '/api/chats/[id]/tags', method: 'DELETE' }, error instanceof Error ? error : undefined)
      return serverError('Failed to remove tag from chat')
    }
  }
)
