// Persona Tags API: Manage tags for a specific persona
// GET /api/personas/[id]/tags - Get all tags for a persona
// POST /api/personas/[id]/tags - Add a tag to a persona
// DELETE /api/personas/[id]/tags?tagId=xxx - Remove a tag from a persona

import { NextRequest, NextResponse } from 'next/server'
import { createAuthenticatedParamsHandler } from '@/lib/api/middleware'
import { notFound, forbidden, badRequest, serverError, validationError } from '@/lib/api/responses'
import { z } from 'zod'
import { logger } from '@/lib/logger'

const addTagSchema = z.object({
  tagId: z.string().uuid(),
})

// GET /api/personas/[id]/tags - Get all tags for a persona
export const GET = createAuthenticatedParamsHandler<{ id: string }>(
  async (req, { user, repos }, { id }) => {
    try {
      // Verify persona exists and belongs to user
      const persona = await repos.personas.findById(id)

      if (!persona) {
        return notFound('Persona')
      }

      if (persona.userId !== user.id) {
        return forbidden()
      }

      // Get tag details for each tag ID
      const tags = await Promise.all(
        persona.tags.map(async (tagId) => {
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
      logger.error('Error fetching persona tags', { context: 'personas-tags-GET' }, error instanceof Error ? error : undefined)
      return serverError('Failed to fetch persona tags')
    }
  }
)

// POST /api/personas/[id]/tags - Add a tag to a persona
export const POST = createAuthenticatedParamsHandler<{ id: string }>(
  async (req, { user, repos }, { id }) => {
    try {
      // Verify persona exists and belongs to user
      const persona = await repos.personas.findById(id)

      if (!persona) {
        return notFound('Persona')
      }

      if (persona.userId !== user.id) {
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

      // Add tag to persona
      await repos.personas.addTag(id, validatedData.tagId)

      return NextResponse.json({ tag }, { status: 201 })
    } catch (error) {
      if (error instanceof z.ZodError) {
        return validationError(error)
      }

      logger.error('Error adding tag to persona', { context: 'personas-tags-POST' }, error instanceof Error ? error : undefined)
      return serverError('Failed to add tag to persona')
    }
  }
)

// DELETE /api/personas/[id]/tags?tagId=xxx - Remove a tag from a persona
export const DELETE = createAuthenticatedParamsHandler<{ id: string }>(
  async (req, { user, repos }, { id }) => {
    try {
      const tagId = req.nextUrl.searchParams.get('tagId')

      if (!tagId) {
        return badRequest('tagId query parameter is required')
      }

      // Verify persona exists and belongs to user
      const persona = await repos.personas.findById(id)

      if (!persona) {
        return notFound('Persona')
      }

      if (persona.userId !== user.id) {
        return forbidden()
      }

      // Remove tag from persona
      await repos.personas.removeTag(id, tagId)

      return NextResponse.json({ success: true })
    } catch (error) {
      logger.error('Error removing tag from persona', { context: 'personas-tags-DELETE' }, error instanceof Error ? error : undefined)
      return serverError('Failed to remove tag from persona')
    }
  }
)
