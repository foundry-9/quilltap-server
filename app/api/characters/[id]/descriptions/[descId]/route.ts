// Character Physical Description Detail API: Manage a specific physical description
// GET /api/characters/[id]/descriptions/[descId] - Get a description
// PUT /api/characters/[id]/descriptions/[descId] - Update a description
// DELETE /api/characters/[id]/descriptions/[descId] - Delete a description

import { NextRequest, NextResponse } from 'next/server'
import { createAuthenticatedParamsHandler } from '@/lib/api/middleware'
import { logger } from '@/lib/logger'
import { z } from 'zod'
import { notFound, badRequest, serverError, validationError } from '@/lib/api/responses'

const updateDescriptionSchema = z.object({
  name: z.string().min(1).optional(),
  shortPrompt: z.string().max(350).nullable().optional(),
  mediumPrompt: z.string().max(500).nullable().optional(),
  longPrompt: z.string().max(750).nullable().optional(),
  completePrompt: z.string().max(1000).nullable().optional(),
  fullDescription: z.string().nullable().optional(),
})

// GET /api/characters/[id]/descriptions/[descId] - Get a description
export const GET = createAuthenticatedParamsHandler<{ id: string; descId: string }>(
  async (req, { user, repos }, { id, descId }) => {
    try {
      // Verify character exists and belongs to user
      const character = await repos.characters.findById(id)

      if (!character) {
        return notFound('Character')
      }

      if (character.userId !== user.id) {
        return badRequest('Unauthorized')
      }

      const description = await repos.characters.getDescription(id, descId)

      if (!description) {
        return notFound('Description')
      }

      return NextResponse.json({ description })
    } catch (error) {
      logger.error('Error fetching character description', { context: 'GET /api/characters/[id]/descriptions/[descId]' }, error instanceof Error ? error : undefined)
      return serverError('Failed to fetch character description')
    }
  }
)

// PUT /api/characters/[id]/descriptions/[descId] - Update a description
export const PUT = createAuthenticatedParamsHandler<{ id: string; descId: string }>(
  async (req, { user, repos }, { id, descId }) => {
    try {
      // Verify character exists and belongs to user
      const character = await repos.characters.findById(id)

      if (!character) {
        return notFound('Character')
      }

      if (character.userId !== user.id) {
        return badRequest('Unauthorized')
      }

      const body = await req.json()
      const validatedData = updateDescriptionSchema.parse(body)

      const description = await repos.characters.updateDescription(id, descId, validatedData)

      if (!description) {
        return notFound('Description')
      }

      return NextResponse.json({ description })
    } catch (error) {
      if (error instanceof z.ZodError) {
        return validationError(error)
      }

      logger.error('Error updating character description', { context: 'PUT /api/characters/[id]/descriptions/[descId]' }, error instanceof Error ? error : undefined)
      return serverError('Failed to update character description')
    }
  }
)

// DELETE /api/characters/[id]/descriptions/[descId] - Delete a description
export const DELETE = createAuthenticatedParamsHandler<{ id: string; descId: string }>(
  async (req, { user, repos }, { id, descId }) => {
    try {
      // Verify character exists and belongs to user
      const character = await repos.characters.findById(id)

      if (!character) {
        return notFound('Character')
      }

      if (character.userId !== user.id) {
        return badRequest('Unauthorized')
      }

      const success = await repos.characters.removeDescription(id, descId)

      if (!success) {
        return notFound('Description')
      }

      return NextResponse.json({ success: true })
    } catch (error) {
      logger.error('Error deleting character description', { context: 'DELETE /api/characters/[id]/descriptions/[descId]' }, error instanceof Error ? error : undefined)
      return serverError('Failed to delete character description')
    }
  }
)
