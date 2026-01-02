// Memories API: Get, Update, and Delete individual memory
// GET /api/characters/[id]/memories/[memoryId] - Get a specific memory
// PUT /api/characters/[id]/memories/[memoryId] - Update a memory
// DELETE /api/characters/[id]/memories/[memoryId] - Delete a memory

import { NextRequest, NextResponse } from 'next/server'
import { createAuthenticatedParamsHandler } from '@/lib/api/middleware'
import { z } from 'zod'
import { logger } from '@/lib/logger'
import { notFound, badRequest, serverError, validationError } from '@/lib/api/responses'

// Validation schema for updating a memory
const updateMemorySchema = z.object({
  content: z.string().min(1).optional(),
  summary: z.string().min(1).optional(),
  keywords: z.array(z.string()).optional(),
  tags: z.array(z.string().uuid()).optional(),
  importance: z.number().min(0).max(1).optional(),
  personaId: z.string().uuid().nullable().optional(),
  chatId: z.string().uuid().nullable().optional(),
})

// GET /api/characters/[id]/memories/[memoryId] - Get a specific memory
export const GET = createAuthenticatedParamsHandler<{ id: string; memoryId: string }>(
  async (req, { user, repos }, { id: characterId, memoryId }) => {
    try {
      // Verify character exists and belongs to user
      const character = await repos.characters.findById(characterId)
      if (!character) {
        return notFound('Character')
      }
      if (character.userId !== user.id) {
        return badRequest('Unauthorized')
      }

      // Get the memory
      const memory = await repos.memories.findByIdForCharacter(characterId, memoryId)
      if (!memory) {
        return notFound('Memory')
      }

      // Enrich with tag names
      const allTags = await repos.tags.findAll()
      const tagMap = new Map(allTags.map(t => [t.id, t]))

      const memoryWithTags = {
        ...memory,
        tagDetails: memory.tags
          .map(tagId => tagMap.get(tagId))
          .filter(Boolean),
      }

      // Update access time (fire and forget)
      repos.memories.updateAccessTime(characterId, memoryId).catch(err =>
        logger.warn('Failed to update memory access time', { characterId, memoryId, error: err instanceof Error ? err.message : String(err) })
      )

      return NextResponse.json({ memory: memoryWithTags })
    } catch (error) {
      logger.error('Error fetching memory', {}, error instanceof Error ? error : undefined)
      return serverError('Failed to fetch memory')
    }
  }
)

// PUT /api/characters/[id]/memories/[memoryId] - Update a memory
export const PUT = createAuthenticatedParamsHandler<{ id: string; memoryId: string }>(
  async (req, { user, repos }, { id: characterId, memoryId }) => {
    try {
      // Verify character exists and belongs to user
      const character = await repos.characters.findById(characterId)
      if (!character) {
        return notFound('Character')
      }
      if (character.userId !== user.id) {
        return badRequest('Unauthorized')
      }

      // Verify memory exists
      const existingMemory = await repos.memories.findByIdForCharacter(characterId, memoryId)
      if (!existingMemory) {
        return notFound('Memory')
      }

      const body = await req.json()
      const validatedData = updateMemorySchema.parse(body)

      const memory = await repos.memories.updateForCharacter(characterId, memoryId, validatedData)

      if (!memory) {
        return notFound('Memory')
      }

      return NextResponse.json({ memory })
    } catch (error) {
      if (error instanceof z.ZodError) {
        return validationError(error)
      }

      logger.error('Error updating memory', {}, error instanceof Error ? error : undefined)
      return serverError('Failed to update memory')
    }
  }
)

// DELETE /api/characters/[id]/memories/[memoryId] - Delete a memory
export const DELETE = createAuthenticatedParamsHandler<{ id: string; memoryId: string }>(
  async (req, { user, repos }, { id: characterId, memoryId }) => {
    try {
      // Verify character exists and belongs to user
      const character = await repos.characters.findById(characterId)
      if (!character) {
        return notFound('Character')
      }
      if (character.userId !== user.id) {
        return badRequest('Unauthorized')
      }

      // Verify memory exists
      const existingMemory = await repos.memories.findByIdForCharacter(characterId, memoryId)
      if (!existingMemory) {
        return notFound('Memory')
      }

      await repos.memories.deleteForCharacter(characterId, memoryId)

      return NextResponse.json({ success: true })
    } catch (error) {
      logger.error('Error deleting memory', {}, error instanceof Error ? error : undefined)
      return serverError('Failed to delete memory')
    }
  }
)
