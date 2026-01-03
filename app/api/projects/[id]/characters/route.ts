/**
 * Project Characters API: Roster Management
 * GET /api/projects/:id/characters - Get characters in roster
 * POST /api/projects/:id/characters - Add character to roster
 * DELETE /api/projects/:id/characters - Remove character from roster
 */

import { NextRequest, NextResponse } from 'next/server'
import { createAuthenticatedParamsHandler, checkOwnership } from '@/lib/api/middleware'
import { logger } from '@/lib/logger'
import { notFound, badRequest, serverError } from '@/lib/api/responses'
import { z } from 'zod'

// Validation schema for adding to roster
const addCharacterSchema = z.object({
  characterId: z.string().uuid(),
})

// Validation schema for removing from roster (via query param)
const removeCharacterSchema = z.object({
  characterId: z.string().uuid(),
})

// GET /api/projects/:id/characters - Get roster characters with details
export const GET = createAuthenticatedParamsHandler<{ id: string }>(
  async (req, { user, repos }, { id }) => {
    try {
      const project = await repos.projects.findById(id)

      if (!checkOwnership(project, user.id)) {
        return notFound('Project')
      }

      // Get character details for roster
      const characters = await Promise.all(
        project.characterRoster.map(async (charId) => {
          const char = await repos.characters.findById(charId)
          if (!char) return null

          // Get chat count for this character in this project
          const allChats = await repos.chats.findAll()
          const charProjectChats = allChats.filter(
            c => c.projectId === id && c.participants.some(p => p.characterId === charId)
          )

          return {
            id: char.id,
            name: char.name,
            title: char.title,
            avatarUrl: char.avatarUrl,
            controlledBy: char.controlledBy ?? 'llm',
            chatCount: charProjectChats.length,
          }
        })
      )

      return NextResponse.json({
        characters: characters.filter(Boolean),
        allowAnyCharacter: project.allowAnyCharacter,
      })
    } catch (error) {
      logger.error('Error fetching project characters', { context: 'GET /api/projects/:id/characters' }, error instanceof Error ? error : undefined)
      return serverError('Failed to fetch project characters')
    }
  }
)

// POST /api/projects/:id/characters - Add character to roster
export const POST = createAuthenticatedParamsHandler<{ id: string }>(
  async (req, { user, repos }, { id }) => {
    try {
      const project = await repos.projects.findById(id)

      if (!checkOwnership(project, user.id)) {
        return notFound('Project')
      }

      const body = await req.json()
      const { characterId } = addCharacterSchema.parse(body)

      // Verify character exists and belongs to user
      const character = await repos.characters.findById(characterId)
      if (!character) {
        return notFound('Character')
      }

      // Add to roster
      const updatedProject = await repos.projects.addToRoster(id, characterId)

      logger.debug('Character added to project roster', { projectId: id, characterId })

      return NextResponse.json({
        project: updatedProject,
        message: 'Character added to roster',
      })
    } catch (error) {
      if (error instanceof z.ZodError) {
        return badRequest('Invalid character ID')
      }

      logger.error('Error adding character to roster', { context: 'POST /api/projects/:id/characters' }, error instanceof Error ? error : undefined)
      return serverError('Failed to add character to roster')
    }
  }
)

// DELETE /api/projects/:id/characters - Remove character from roster
export const DELETE = createAuthenticatedParamsHandler<{ id: string }>(
  async (req, { user, repos }, { id }) => {
    try {
      const project = await repos.projects.findById(id)

      if (!checkOwnership(project, user.id)) {
        return notFound('Project')
      }

      const { searchParams } = new URL(req.url)
      const characterId = searchParams.get('characterId')

      if (!characterId) {
        return badRequest('characterId query parameter is required')
      }

      const { characterId: validatedCharId } = removeCharacterSchema.parse({ characterId })

      // Remove from roster
      const updatedProject = await repos.projects.removeFromRoster(id, validatedCharId)

      logger.debug('Character removed from project roster', { projectId: id, characterId: validatedCharId })

      return NextResponse.json({
        project: updatedProject,
        message: 'Character removed from roster',
      })
    } catch (error) {
      if (error instanceof z.ZodError) {
        return badRequest('Invalid character ID')
      }

      logger.error('Error removing character from roster', { context: 'DELETE /api/projects/:id/characters' }, error instanceof Error ? error : undefined)
      return serverError('Failed to remove character from roster')
    }
  }
)
