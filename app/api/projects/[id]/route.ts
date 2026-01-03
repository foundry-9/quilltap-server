/**
 * Project API: Get, Update, Delete
 * GET /api/projects/:id - Get project by ID
 * PATCH /api/projects/:id - Update project
 * DELETE /api/projects/:id - Delete project
 */

import { NextRequest, NextResponse } from 'next/server'
import { createAuthenticatedParamsHandler, checkOwnership } from '@/lib/api/middleware'
import { enrichWithDefaultImage } from '@/lib/api/middleware/file-path'
import { logger } from '@/lib/logger'
import { notFound, serverError, validationError } from '@/lib/api/responses'
import { z } from 'zod'

// Validation schema for updates
const updateProjectSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(2000).nullable().optional(),
  instructions: z.string().max(10000).nullable().optional(),
  allowAnyCharacter: z.boolean().optional(),
  characterRoster: z.array(z.string().uuid()).optional(),
  color: z.string().regex(/^#(?:[0-9a-fA-F]{3}){1,2}$/).nullable().optional(),
  icon: z.string().max(50).nullable().optional(),
})

// GET /api/projects/:id
export const GET = createAuthenticatedParamsHandler<{ id: string }>(
  async (req, { user, repos }, { id }) => {
    try {
      const project = await repos.projects.findById(id)

      if (!checkOwnership(project, user.id)) {
        return notFound('Project')
      }

      // Get chats in this project
      const allChats = await repos.chats.findAll()
      const projectChats = allChats.filter(c => c.projectId === project.id)

      // Get files in this project
      const allFiles = await repos.files.findAll()
      const projectFiles = allFiles.filter(f => f.projectId === project.id)

      // Get characters in roster with their details and chat counts
      const enrichedCharacterRoster = await Promise.all(
        project.characterRoster.map(async (charId) => {
          const char = await repos.characters.findById(charId)
          if (!char) return null

          // Count chats with this character in this project
          const charProjectChats = projectChats.filter(chat =>
            chat.participants?.some(p => p.characterId === charId)
          )

          // Fetch defaultImage if character has one
          const defaultImage = await enrichWithDefaultImage(
            char,
            repos.files.findById.bind(repos.files)
          )

          return {
            id: char.id,
            name: char.name,
            avatarUrl: char.avatarUrl,
            defaultImageId: char.defaultImageId,
            defaultImage,
            tags: char.tags || [],
            chatCount: charProjectChats.length,
          }
        })
      )

      const enrichedProject = {
        ...project,
        // Replace the UUID array with enriched character objects
        characterRoster: enrichedCharacterRoster.filter(Boolean),
        _count: {
          chats: projectChats.length,
          files: projectFiles.length,
          characters: project.characterRoster.length,
        },
      }

      return NextResponse.json({ project: enrichedProject })
    } catch (error) {
      logger.error('Error fetching project', { context: 'GET /api/projects/:id' }, error instanceof Error ? error : undefined)
      return serverError('Failed to fetch project')
    }
  }
)

// PATCH /api/projects/:id
export const PATCH = createAuthenticatedParamsHandler<{ id: string }>(
  async (req, { user, repos }, { id }) => {
    try {
      const existingProject = await repos.projects.findById(id)

      if (!checkOwnership(existingProject, user.id)) {
        return notFound('Project')
      }

      const body = await req.json()
      const validatedData = updateProjectSchema.parse(body)

      const project = await repos.projects.update(id, validatedData)

      logger.debug('Project updated', { projectId: id })

      return NextResponse.json({ project })
    } catch (error) {
      if (error instanceof z.ZodError) {
        return validationError(error)
      }

      logger.error('Error updating project', { context: 'PATCH /api/projects/:id' }, error instanceof Error ? error : undefined)
      return serverError('Failed to update project')
    }
  }
)

// DELETE /api/projects/:id
export const DELETE = createAuthenticatedParamsHandler<{ id: string }>(
  async (req, { user, repos }, { id }) => {
    try {
      const existingProject = await repos.projects.findById(id)

      if (!checkOwnership(existingProject, user.id)) {
        return notFound('Project')
      }

      // Remove projectId from associated chats
      const allChats = await repos.chats.findAll()
      const projectChats = allChats.filter(c => c.projectId === id)
      for (const chat of projectChats) {
        await repos.chats.update(chat.id, { projectId: null })
      }

      // Remove projectId from associated files
      const allFiles = await repos.files.findAll()
      const projectFiles = allFiles.filter(f => f.projectId === id)
      for (const file of projectFiles) {
        await repos.files.update(file.id, { projectId: null })
      }

      // Delete the project
      await repos.projects.delete(id)

      logger.info('Project deleted', { projectId: id, userId: user.id })

      return NextResponse.json({ success: true })
    } catch (error) {
      logger.error('Error deleting project', { context: 'DELETE /api/projects/:id' }, error instanceof Error ? error : undefined)
      return serverError('Failed to delete project')
    }
  }
)
