// Connection Profile Tags API: Manage tags for a specific connection profile
// GET /api/profiles/[id]/tags - Get all tags for a connection profile
// POST /api/profiles/[id]/tags - Add a tag to a connection profile
// DELETE /api/profiles/[id]/tags?tagId=xxx - Remove a tag from a connection profile

import { NextResponse } from 'next/server'
import { createAuthenticatedParamsHandler } from '@/lib/api/middleware'
import { z } from 'zod'
import { logger } from '@/lib/logger'
import { notFound, forbidden, badRequest, serverError, validationError, created } from '@/lib/api/responses'

const addTagSchema = z.object({
  tagId: z.string().uuid(),
})

// GET /api/profiles/[id]/tags - Get all tags for a connection profile
export const GET = createAuthenticatedParamsHandler<{ id: string }>(
  async (req, { user, repos }, { id }) => {
    try {
      // Verify connection profile exists and belongs to user
      const profile = await repos.connections.findById(id)

      if (!profile) {
        return notFound('Connection profile')
      }

      if (profile.userId !== user.id) {
        return forbidden()
      }

      // Get tags for this profile
      const allTags = await repos.tags.findAll()
      const profileTags = allTags
        .filter(tag => profile.tags.includes(tag.id))
        .map(tag => ({
          id: tag.id,
          name: tag.name,
          createdAt: tag.createdAt,
        }))
        .sort((a, b) => a.name.localeCompare(b.name))

      return NextResponse.json({ tags: profileTags })
    } catch (error) {
      logger.error('Error fetching connection profile tags', { context: 'profiles-tags-GET' }, error instanceof Error ? error : undefined)
      return serverError('Failed to fetch connection profile tags')
    }
  }
)

// POST /api/profiles/[id]/tags - Add a tag to a connection profile
export const POST = createAuthenticatedParamsHandler<{ id: string }>(
  async (req, { user, repos }, { id }) => {
    try {
      // Verify connection profile exists and belongs to user
      const profile = await repos.connections.findById(id)

      if (!profile) {
        return notFound('Connection profile')
      }

      if (profile.userId !== user.id) {
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

      // Add tag to connection profile
      await repos.connections.addTag(id, validatedData.tagId)

      return created({ tag })
    } catch (error) {
      if (error instanceof z.ZodError) {
        return validationError(error)
      }

      logger.error('Error adding tag to connection profile', { context: 'profiles-tags-POST' }, error instanceof Error ? error : undefined)
      return serverError('Failed to add tag to connection profile')
    }
  }
)

// DELETE /api/profiles/[id]/tags?tagId=xxx - Remove a tag from a connection profile
export const DELETE = createAuthenticatedParamsHandler<{ id: string }>(
  async (req, { user, repos }, { id }) => {
    try {
      const tagId = req.nextUrl.searchParams.get('tagId')

      if (!tagId) {
        return badRequest('tagId query parameter is required')
      }

      // Verify connection profile exists and belongs to user
      const profile = await repos.connections.findById(id)

      if (!profile) {
        return notFound('Connection profile')
      }

      if (profile.userId !== user.id) {
        return forbidden()
      }

      // Remove tag from connection profile
      await repos.connections.removeTag(id, tagId)

      return NextResponse.json({ success: true })
    } catch (error) {
      logger.error('Error removing tag from connection profile', { context: 'profiles-tags-DELETE' }, error instanceof Error ? error : undefined)
      return serverError('Failed to remove tag from connection profile')
    }
  }
)
