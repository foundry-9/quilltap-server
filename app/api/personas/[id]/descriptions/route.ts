// Persona Physical Descriptions API: Manage physical descriptions for a persona
// GET /api/personas/[id]/descriptions - Get all descriptions for a persona
// POST /api/personas/[id]/descriptions - Create a new description

import { NextRequest, NextResponse } from 'next/server'
import { createAuthenticatedParamsHandler } from '@/lib/api/middleware'
import { notFound, forbidden, serverError, validationError } from '@/lib/api/responses'
import { z } from 'zod'
import { logger } from '@/lib/logger'

const createDescriptionSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  shortPrompt: z.string().max(350).nullable().optional(),
  mediumPrompt: z.string().max(500).nullable().optional(),
  longPrompt: z.string().max(750).nullable().optional(),
  completePrompt: z.string().max(1000).nullable().optional(),
  fullDescription: z.string().nullable().optional(),
})

// GET /api/personas/[id]/descriptions - Get all descriptions for a persona
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

      const descriptions = await repos.personas.getDescriptions(id)

      return NextResponse.json({ descriptions })
    } catch (error) {
      logger.error('Error fetching persona descriptions:', error as Error)
      return serverError('Failed to fetch persona descriptions')
    }
  }
)

// POST /api/personas/[id]/descriptions - Create a new description
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
      const validatedData = createDescriptionSchema.parse(body)

      const description = await repos.personas.addDescription(id, validatedData)

      if (!description) {
        return serverError('Failed to create description')
      }

      return NextResponse.json({ description }, { status: 201 })
    } catch (error) {
      if (error instanceof z.ZodError) {
        return validationError(error)
      }

      logger.error('Error creating persona description:', error as Error)
      return serverError('Failed to create persona description')
    }
  }
)
