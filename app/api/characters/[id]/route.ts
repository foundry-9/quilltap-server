// Character API: Get, Update, Delete
// GET /api/characters/:id - Get character by ID
// PUT /api/characters/:id - Update character
// DELETE /api/characters/:id - Delete character (supports cascade deletion)

import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { createAuthenticatedParamsHandler, checkOwnership } from '@/lib/api/middleware'
import { getFilePath } from '@/lib/api/middleware/file-path'
import { executeCascadeDelete } from '@/lib/cascade-delete'
import { logger } from '@/lib/logger'
import { notFound, badRequest, serverError, validationError } from '@/lib/api/responses'
import { z } from 'zod'

// Validation schema for updates
const updateCharacterSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  title: z.string().optional(),
  description: z.string().optional(),
  personality: z.string().optional(),
  scenario: z.string().optional(),
  firstMessage: z.string().optional(),
  exampleDialogues: z.string().optional(),
  avatarUrl: z.string().url().optional().or(z.literal('')),
  defaultConnectionProfileId: z.string().uuid().optional().or(z.literal('').transform(() => undefined)),
  controlledBy: z.enum(['llm', 'user']).optional(),  // Who controls this character
  npc: z.boolean().optional(),  // NPC flag for ad-hoc characters
})

// GET /api/characters/:id
export const GET = createAuthenticatedParamsHandler<{ id: string }>(
  async (req, { user, repos }, { id }) => {
    try {
      const character = await repos.characters.findById(id)

      if (!checkOwnership(character, user.id)) {
        return notFound('Character')
      }

      // Get default image from repository if present
      let defaultImage = null
      if (character.defaultImageId) {
        const fileEntry = await repos.files.findById(character.defaultImageId)
        if (fileEntry) {
          defaultImage = {
            id: fileEntry.id,
            filepath: getFilePath(fileEntry),
            url: null,
          }
        }
      }

      // Get chat count
      const chats = await repos.chats.findByCharacterId(id)

      const enrichedCharacter = {
        ...character,
        defaultImage,
        _count: {
          chats: chats.length,
        },
      }

      return NextResponse.json({ character: enrichedCharacter })
    } catch (error) {
      logger.error('Error fetching character', { context: 'GET /api/characters/:id' }, error instanceof Error ? error : undefined)
      return serverError('Failed to fetch character')
    }
  }
)

// PUT /api/characters/:id
export const PUT = createAuthenticatedParamsHandler<{ id: string }>(
  async (req, { user, repos }, { id }) => {
    try {
      // Verify character ownership
      const existingCharacter = await repos.characters.findById(id)

      if (!checkOwnership(existingCharacter, user.id)) {
        return notFound('Character')
      }

      const body = await req.json()
      const validatedData = updateCharacterSchema.parse(body)

      const character = await repos.characters.update(id, validatedData)

      // Revalidate the home page to reflect character changes
      revalidatePath('/')

      return NextResponse.json({ character })
    } catch (error) {
      if (error instanceof z.ZodError) {
        return validationError(error)
      }

      logger.error('Error updating character', { context: 'PUT /api/characters/:id' }, error instanceof Error ? error : undefined)
      return serverError('Failed to update character')
    }
  }
)

// DELETE /api/characters/:id
// Query params:
//   - cascadeChats: 'true' to delete exclusive chats
//   - cascadeImages: 'true' to delete exclusive images
export const DELETE = createAuthenticatedParamsHandler<{ id: string }>(
  async (req, { user, repos }, { id }) => {
    try {
      // Verify character ownership
      const existingCharacter = await repos.characters.findById(id)

      if (!checkOwnership(existingCharacter, user.id)) {
        return notFound('Character')
      }

      // Parse cascade options from query params
      const { searchParams } = new URL(req.url)
      const cascadeChats = searchParams.get('cascadeChats') === 'true'
      const cascadeImages = searchParams.get('cascadeImages') === 'true'

      // Execute cascade delete
      const result = await executeCascadeDelete(id, {
        deleteExclusiveChats: cascadeChats,
        deleteExclusiveImages: cascadeImages,
      })

      if (!result.success) {
        return serverError('Failed to delete character')
      }

      return NextResponse.json({
        success: true,
        deletedChats: result.deletedChats,
        deletedImages: result.deletedImages,
        deletedMemories: result.deletedMemories,
      })
    } catch (error) {
      logger.error('Error deleting character', { context: 'DELETE /api/characters/:id' }, error instanceof Error ? error : undefined)
      return serverError('Failed to delete character')
    }
  }
)
