/**
 * Sidebar Projects API
 * GET /api/sidebar/projects - Get projects for sidebar display
 */

import { NextRequest, NextResponse } from 'next/server'
import { createAuthenticatedHandler } from '@/lib/api/middleware'
import { logger } from '@/lib/logger'

export const GET = createAuthenticatedHandler(async (req: NextRequest, { user, repos }) => {
  try {
    logger.debug('Fetching sidebar projects', { userId: user.id })

    // Get all projects for user
    const projects = await repos.projects.findAll()

    // Get chats and files to count associations
    const chats = await repos.chats.findAll()
    const files = await repos.files.findAll()

    // Enrich projects with counts
    const enrichedProjects = projects.map(project => {
      const projectChats = chats.filter(c => c.projectId === project.id)
      const projectFiles = files.filter(f => f.projectId === project.id)

      return {
        id: project.id,
        name: project.name,
        color: project.color,
        icon: project.icon,
        chatCount: projectChats.length,
        fileCount: projectFiles.length,
        characterCount: project.characterRoster.length,
        updatedAt: project.updatedAt,
      }
    })

    // Sort by most recently updated
    enrichedProjects.sort((a, b) =>
      new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    )

    // Limit to top 10 for sidebar
    const sidebarProjects = enrichedProjects.slice(0, 10)

    logger.debug('Sidebar projects fetched', { count: sidebarProjects.length })

    return NextResponse.json({ projects: sidebarProjects })
  } catch (error) {
    logger.error('Error fetching sidebar projects:', error as Error)
    return NextResponse.json(
      { error: 'Failed to fetch projects' },
      { status: 500 }
    )
  }
})
