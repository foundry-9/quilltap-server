// Character Physical Descriptions API: Manage physical descriptions for a character
// GET /api/characters/[id]/descriptions - Get all descriptions for a character
// POST /api/characters/[id]/descriptions - Create a new description

import { NextRequest, NextResponse } from 'next/server'
import { createAuthenticatedParamsHandler, checkOwnership } from '@/lib/api/middleware'
import { logger } from '@/lib/logger'
import { z } from 'zod'
import { notFound, forbidden, serverError, validationError } from '@/lib/api/responses'

const createDescriptionSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  shortPrompt: z.string().max(350).nullable().optional(),
  mediumPrompt: z.string().max(500).nullable().optional(),
  longPrompt: z.string().max(750).nullable().optional(),
  completePrompt: z.string().max(1000).nullable().optional(),
  fullDescription: z.string().nullable().optional(),
})

// GET /api/characters/[id]/descriptions - Get all descriptions for a character
export const GET = createAuthenticatedParamsHandler<{ id: string }>(
  async (req, { user, repos }, { id }) => {
    try {
      // Verify character exists and belongs to user
      const character = await repos.characters.findById(id)

      if (!character) {
        return notFound('Character')
      }

      if (character.userId !== user.id) {
        return forbidden()
      }

      const descriptions = await repos.characters.getDescriptions(id)

      return NextResponse.json({ descriptions })
    } catch (error) {
      logger.error('Error fetching character descriptions', { context: 'GET /api/characters/[id]/descriptions' }, error instanceof Error ? error : undefined)
      return serverError('Failed to fetch character descriptions')
    }
  }
)

// POST /api/characters/[id]/descriptions - Create a new description
export const POST = createAuthenticatedParamsHandler<{ id: string }>(
  async (req, { user, repos }, { id }) => {
    try {
      // Verify character exists and belongs to user
      const character = await repos.characters.findById(id)

      if (!character) {
        return notFound('Character')
      }

      if (character.userId !== user.id) {
        return forbidden()
      }

      const body = await req.json()
      const validatedData = createDescriptionSchema.parse(body)

      const description = await repos.characters.addDescription(id, validatedData)

      if (!description) {
        return serverError('Failed to create description')
      }

      return NextResponse.json({ description }, { status: 201 })
    } catch (error) {
      if (error instanceof z.ZodError) {
        return validationError(error)
      }

      logger.error('Error creating character description', { context: 'POST /api/characters/[id]/descriptions' }, error instanceof Error ? error : undefined)
      return serverError('Failed to create character description')
    }
  }
)
