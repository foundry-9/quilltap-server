/**
 * Project Files API: File Associations
 * GET /api/projects/:id/files - List files in project
 * POST /api/projects/:id/files - Associate file with project
 * DELETE /api/projects/:id/files - Remove file from project
 */

import { NextRequest, NextResponse } from 'next/server'
import { createAuthenticatedParamsHandler, checkOwnership } from '@/lib/api/middleware'
import { getFilePath } from '@/lib/api/middleware/file-path'
import { logger } from '@/lib/logger'
import { notFound, badRequest, serverError } from '@/lib/api/responses'
import { z } from 'zod'

// Validation schema for adding file
const addFileSchema = z.object({
  fileId: z.string().uuid(),
})

// GET /api/projects/:id/files - List files in project
export const GET = createAuthenticatedParamsHandler<{ id: string }>(
  async (req, { user, repos }, { id }) => {
    try {
      const project = await repos.projects.findById(id)

      if (!checkOwnership(project, user.id)) {
        return notFound('Project')
      }

      // Get all user's files that are in this project
      const allFiles = await repos.files.findAll()
      const projectFiles = allFiles.filter(f => f.projectId === id)

      // Sort by createdAt descending
      projectFiles.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())

      // Enrich with URL
      const enrichedFiles = projectFiles.map(file => ({
        id: file.id,
        originalFilename: file.originalFilename,
        mimeType: file.mimeType,
        size: file.size,
        category: file.category,
        description: file.description,
        width: file.width,
        height: file.height,
        filepath: getFilePath(file),
        createdAt: file.createdAt,
        updatedAt: file.updatedAt,
      }))

      return NextResponse.json({ files: enrichedFiles })
    } catch (error) {
      logger.error('Error fetching project files', { context: 'GET /api/projects/:id/files' }, error instanceof Error ? error : undefined)
      return serverError('Failed to fetch project files')
    }
  }
)

// POST /api/projects/:id/files - Associate file with project
export const POST = createAuthenticatedParamsHandler<{ id: string }>(
  async (req, { user, repos }, { id }) => {
    try {
      const project = await repos.projects.findById(id)

      if (!checkOwnership(project, user.id)) {
        return notFound('Project')
      }

      const body = await req.json()
      const { fileId } = addFileSchema.parse(body)

      // Verify file exists and belongs to user
      const file = await repos.files.findById(fileId)
      if (!file) {
        return notFound('File')
      }

      // Update file with project association
      const updatedFile = await repos.files.update(fileId, { projectId: id })

      logger.debug('File associated with project', { projectId: id, fileId })

      return NextResponse.json({
        file: updatedFile,
        message: 'File added to project',
      })
    } catch (error) {
      if (error instanceof z.ZodError) {
        return badRequest('Invalid file ID')
      }

      logger.error('Error adding file to project', { context: 'POST /api/projects/:id/files' }, error instanceof Error ? error : undefined)
      return serverError('Failed to add file to project')
    }
  }
)

// DELETE /api/projects/:id/files - Remove file from project
export const DELETE = createAuthenticatedParamsHandler<{ id: string }>(
  async (req, { user, repos }, { id }) => {
    try {
      const project = await repos.projects.findById(id)

      if (!checkOwnership(project, user.id)) {
        return notFound('Project')
      }

      const { searchParams } = new URL(req.url)
      const fileId = searchParams.get('fileId')

      if (!fileId) {
        return badRequest('fileId query parameter is required')
      }

      // Verify file exists and is in this project
      const file = await repos.files.findById(fileId)
      if (!file || file.projectId !== id) {
        return notFound('File in project')
      }

      // Remove project association
      const updatedFile = await repos.files.update(fileId, { projectId: null })

      logger.debug('File removed from project', { projectId: id, fileId })

      return NextResponse.json({
        file: updatedFile,
        message: 'File removed from project',
      })
    } catch (error) {
      logger.error('Error removing file from project', { context: 'DELETE /api/projects/:id/files' }, error instanceof Error ? error : undefined)
      return serverError('Failed to remove file from project')
    }
  }
)
