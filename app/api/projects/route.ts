/**
 * Projects API: List and Create
 * GET /api/projects - List all projects for user
 * POST /api/projects - Create a new project
 */

import { NextRequest, NextResponse } from 'next/server'
import { createAuthenticatedHandler } from '@/lib/api/middleware'
import { z } from 'zod'
import { logger } from '@/lib/logger'

// Validation schema for creating a project
const createProjectSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  description: z.string().max(2000).optional(),
  instructions: z.string().max(10000).optional(),
  allowAnyCharacter: z.boolean().optional().default(false),
  characterRoster: z.array(z.string().uuid()).optional().default([]),
  color: z.string().regex(/^#(?:[0-9a-fA-F]{3}){1,2}$/).optional(),
  icon: z.string().max(50).optional(),
})

// GET /api/projects - List all projects
export const GET = createAuthenticatedHandler(async (req: NextRequest, { user, repos }) => {
  try {
    logger.debug('Fetching projects for user', { userId: user.id })

    const projects = await repos.projects.findAll()

    // Sort by createdAt descending
    projects.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())

    // Enrich with counts
    const enrichedProjects = await Promise.all(
      projects.map(async (project) => {
        // Get chats in this project
        const allChats = await repos.chats.findAll()
        const projectChats = allChats.filter(c => c.projectId === project.id)

        // Get files in this project
        const allFiles = await repos.files.findAll()
        const projectFiles = allFiles.filter(f => f.projectId === project.id)

        return {
          ...project,
          _count: {
            chats: projectChats.length,
            files: projectFiles.length,
            characters: project.characterRoster.length,
          },
        }
      })
    )

    logger.debug('Projects fetched', { count: enrichedProjects.length })

    return NextResponse.json({ projects: enrichedProjects })
  } catch (error) {
    logger.error('Error fetching projects:', error as Error)
    return NextResponse.json(
      { error: 'Failed to fetch projects' },
      { status: 500 }
    )
  }
})

// POST /api/projects - Create a new project
export const POST = createAuthenticatedHandler(async (req: NextRequest, { user, repos }) => {
  try {
    const body = await req.json()
    const validatedData = createProjectSchema.parse(body)

    const project = await repos.projects.create({
      userId: user.id,
      name: validatedData.name,
      description: validatedData.description || null,
      instructions: validatedData.instructions || null,
      allowAnyCharacter: validatedData.allowAnyCharacter,
      characterRoster: validatedData.characterRoster,
      color: validatedData.color || null,
      icon: validatedData.icon || null,
    })

    logger.info('Project created', {
      projectId: project.id,
      name: project.name,
      userId: user.id,
    })

    return NextResponse.json({ project }, { status: 201 })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation error', details: error.errors },
        { status: 400 }
      )
    }

    logger.error('Error creating project:', error as Error)
    return NextResponse.json(
      { error: 'Failed to create project' },
      { status: 500 }
    )
  }
})
