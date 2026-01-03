/**
 * Project Chats API: Chat Associations
 * GET /api/projects/:id/chats - List chats in project
 * POST /api/projects/:id/chats - Associate chat with project (auto-adds characters to roster)
 * DELETE /api/projects/:id/chats - Remove chat from project
 */

import { NextRequest, NextResponse } from 'next/server'
import { createAuthenticatedParamsHandler, checkOwnership } from '@/lib/api/middleware'
import { enrichWithDefaultImage } from '@/lib/api/middleware/file-path'
import { logger } from '@/lib/logger'
import { notFound, badRequest, serverError } from '@/lib/api/responses'
import { z } from 'zod'

// Validation schema for adding chat
const addChatSchema = z.object({
  chatId: z.string().uuid(),
})

// GET /api/projects/:id/chats - List chats in project with optional pagination
export const GET = createAuthenticatedParamsHandler<{ id: string }>(
  async (req, { user, repos }, { id }) => {
    try {
      const project = await repos.projects.findById(id)

      if (!checkOwnership(project, user.id)) {
        return notFound('Project')
      }

      // Parse pagination params
      const { searchParams } = new URL(req.url)
      const limit = parseInt(searchParams.get('limit') || '20', 10)
      const offset = parseInt(searchParams.get('offset') || '0', 10)

      // Get all user's chats that are in this project
      const allChats = await repos.chats.findAll()
      const projectChats = allChats.filter(c => c.projectId === id)

      // Sort by updatedAt descending
      projectChats.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())

      // Get total count before pagination
      const total = projectChats.length

      // Apply pagination
      const paginatedChats = projectChats.slice(offset, offset + limit)

      // Fetch all tags for resolving tag names
      const allTags = await repos.tags.findAll()
      const tagMap = new Map(allTags.map(t => [t.id, t]))

      // Enrich with participant info and tags
      const enrichedChats = await Promise.all(
        paginatedChats.map(async (chat) => {
          const participants = await Promise.all(
            chat.participants.map(async (p) => {
              if (p.characterId) {
                const char = await repos.characters.findById(p.characterId)
                if (!char) return null

                // Fetch defaultImage if character has one
                const defaultImage = await enrichWithDefaultImage(
                  char,
                  repos.files.findById.bind(repos.files)
                )

                return {
                  id: p.id,
                  name: char.name,
                  avatarUrl: char.avatarUrl,
                  defaultImage,
                  tags: char.tags || [],
                }
              }
              return null
            })
          )

          // Resolve chat tags to include tag objects with names
          const chatTags = (chat.tags || [])
            .map(tagId => {
              const tag = tagMap.get(tagId)
              return tag ? { tag: { id: tag.id, name: tag.name } } : null
            })
            .filter(Boolean)

          return {
            id: chat.id,
            title: chat.title,
            messageCount: chat.messageCount,
            participants: participants.filter(Boolean),
            tags: chatTags,
            updatedAt: chat.updatedAt,
            createdAt: chat.createdAt,
          }
        })
      )

      logger.debug('Fetched project chats', {
        projectId: id,
        total,
        offset,
        limit,
        returned: enrichedChats.length,
      })

      return NextResponse.json({
        chats: enrichedChats,
        pagination: {
          total,
          offset,
          limit,
          hasMore: offset + enrichedChats.length < total,
        },
      })
    } catch (error) {
      logger.error('Error fetching project chats', { context: 'GET /api/projects/:id/chats' }, error instanceof Error ? error : undefined)
      return serverError('Failed to fetch project chats')
    }
  }
)

// POST /api/projects/:id/chats - Associate chat with project
export const POST = createAuthenticatedParamsHandler<{ id: string }>(
  async (req, { user, repos }, { id }) => {
    try {
      const project = await repos.projects.findById(id)

      if (!checkOwnership(project, user.id)) {
        return notFound('Project')
      }

      const body = await req.json()
      const { chatId } = addChatSchema.parse(body)

      // Verify chat exists and belongs to user
      const chat = await repos.chats.findById(chatId)
      if (!chat) {
        return notFound('Chat')
      }

      // Check if chat is already in another project
      if (chat.projectId && chat.projectId !== id) {
        return badRequest('Chat is already in another project. Remove it first.')
      }

      // Update chat with project association
      await repos.chats.update(chatId, { projectId: id })

      // Auto-add chat's characters to project roster (if not allowAnyCharacter)
      if (!project.allowAnyCharacter) {
        const characterIds = chat.participants
          .filter(p => p.characterId && p.type === 'CHARACTER')
          .map(p => p.characterId!)
          .filter(charId => !project.characterRoster.includes(charId))

        if (characterIds.length > 0) {
          await repos.projects.addManyToRoster(id, characterIds)
          logger.debug('Auto-added characters to project roster', {
            projectId: id,
            characterIds,
          })
        }
      }

      const updatedProject = await repos.projects.findById(id)

      logger.debug('Chat associated with project', { projectId: id, chatId })

      return NextResponse.json({
        project: updatedProject,
        message: 'Chat added to project',
      })
    } catch (error) {
      if (error instanceof z.ZodError) {
        return badRequest('Invalid chat ID')
      }

      logger.error('Error adding chat to project', { context: 'POST /api/projects/:id/chats' }, error instanceof Error ? error : undefined)
      return serverError('Failed to add chat to project')
    }
  }
)

// DELETE /api/projects/:id/chats - Remove chat from project
export const DELETE = createAuthenticatedParamsHandler<{ id: string }>(
  async (req, { user, repos }, { id }) => {
    try {
      const project = await repos.projects.findById(id)

      if (!checkOwnership(project, user.id)) {
        return notFound('Project')
      }

      const { searchParams } = new URL(req.url)
      const chatId = searchParams.get('chatId')

      if (!chatId) {
        return badRequest('chatId query parameter is required')
      }

      // Verify chat exists and is in this project
      const chat = await repos.chats.findById(chatId)
      if (!chat || chat.projectId !== id) {
        return notFound('Chat in project')
      }

      // Remove project association
      await repos.chats.update(chatId, { projectId: null })

      logger.debug('Chat removed from project', { projectId: id, chatId })

      return NextResponse.json({
        message: 'Chat removed from project',
      })
    } catch (error) {
      logger.error('Error removing chat from project', { context: 'DELETE /api/projects/:id/chats' }, error instanceof Error ? error : undefined)
      return serverError('Failed to remove chat from project')
    }
  }
)
