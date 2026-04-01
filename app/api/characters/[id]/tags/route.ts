// Character Tags API: Manage tags for a specific character
// GET /api/characters/[id]/tags - Get all tags for a character
// POST /api/characters/[id]/tags - Add a tag to a character
// DELETE /api/characters/[id]/tags?tagId=xxx - Remove a tag from a character

import { NextRequest, NextResponse } from 'next/server'
import { createAuthenticatedParamsHandler } from '@/lib/api/middleware'
import { z } from 'zod'
import { logger } from '@/lib/logger'
import { notFound, forbidden, badRequest, serverError, validationError } from '@/lib/api/responses'

const addTagSchema = z.object({
  tagId: z.string().uuid(),
})

// GET /api/characters/[id]/tags - Get all tags for a character
export const GET = createAuthenticatedParamsHandler<{ id: string }>(
  async (req, { user, repos }, { id }) => {
    try {
      const characterId = id

      // Verify character exists and belongs to user
      const character = await repos.characters.findById(characterId)

      if (!character) {
        return notFound('Character')
      }

      if (character.userId !== user.id) {
        return forbidden()
      }

      // Get tag details for each tag ID
      const tags = await Promise.all(
        character.tags.map(async (tagId) => {
          const tag = await repos.tags.findById(tagId)
          return tag
            ? {
                id: tag.id,
                name: tag.name,
                createdAt: tag.createdAt,
              }
            : null
        })
      )

      // Filter out null values and sort by name
      const validTags = tags.filter(Boolean).sort((a, b) => a!.name.localeCompare(b!.name))

      return NextResponse.json({ tags: validTags })
    } catch (error) {
      logger.error('Error fetching character tags', { context: 'GET /api/characters/[id]/tags' }, error instanceof Error ? error : undefined)
      return serverError('Failed to fetch character tags')
    }
  }
)

// POST /api/characters/[id]/tags - Add a tag to a character
export const POST = createAuthenticatedParamsHandler<{ id: string }>(
  async (req, { user, repos }, { id }) => {
    try {
      const characterId = id

      // Verify character exists and belongs to user
      const character = await repos.characters.findById(characterId)

      if (!character) {
        return notFound('Character')
      }

      if (character.userId !== user.id) {
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

      // Add tag to character
      await repos.characters.addTag(characterId, validatedData.tagId)

      return NextResponse.json({ tag }, { status: 201 })
    } catch (error) {
      if (error instanceof z.ZodError) {
        return validationError(error)
      }

      logger.error('Error adding tag to character', { context: 'POST /api/characters/[id]/tags' }, error instanceof Error ? error : undefined)
      return serverError('Failed to add tag to character')
    }
  }
)

// DELETE /api/characters/[id]/tags?tagId=xxx - Remove a tag from a character
export const DELETE = createAuthenticatedParamsHandler<{ id: string }>(
  async (req, { user, repos }, { id }) => {
    try {
      const characterId = id
      const tagId = req.nextUrl.searchParams.get('tagId')

      if (!tagId) {
        return badRequest('tagId query parameter is required')
      }

      // Verify character exists and belongs to user
      const character = await repos.characters.findById(characterId)

      if (!character) {
        return notFound('Character')
      }

      if (character.userId !== user.id) {
        return forbidden()
      }

      // Remove tag from character
      await repos.characters.removeTag(characterId, tagId)

      return NextResponse.json({ success: true })
    } catch (error) {
      logger.error('Error removing tag from character', { context: 'DELETE /api/characters/[id]/tags' }, error instanceof Error ? error : undefined)
      return serverError('Failed to remove tag from character')
    }
  }
)
