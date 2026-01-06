/**
 * Project Files Upload API: Direct file upload to project
 * POST /api/projects/:id/files/upload - Upload a file directly to a project
 */

import { createHash } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { createAuthenticatedParamsHandler, checkOwnership } from '@/lib/api/middleware'
import { logger } from '@/lib/logger'
import { notFound, badRequest, serverError } from '@/lib/api/responses'
import { uploadFile as uploadS3File } from '@/lib/s3/operations'
import { buildS3Key } from '@/lib/s3/client'
import type { FileCategory } from '@/lib/schemas/types'

/**
 * Allowed file MIME types for project file uploads
 * Same as chat attachments for consistency
 */
const ALLOWED_FILE_TYPES = [
  // Images
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/gif',
  'image/webp',
  // Documents
  'application/pdf',
  'text/plain',
  'text/markdown',
  'text/csv',
]

/**
 * Maximum file size in bytes (10 MB)
 */
const MAX_FILE_SIZE = 10 * 1024 * 1024

/**
 * Validate project file upload
 */
function validateFile(file: File): void {
  if (!ALLOWED_FILE_TYPES.includes(file.type)) {
    throw new Error(
      `Invalid file type: ${file.type}. Allowed types: ${ALLOWED_FILE_TYPES.join(', ')}`
    )
  }

  if (file.size > MAX_FILE_SIZE) {
    throw new Error(
      `File size exceeds maximum allowed size of ${MAX_FILE_SIZE / 1024 / 1024} MB`
    )
  }
}

// POST /api/projects/:id/files/upload - Upload a file to project
export const POST = createAuthenticatedParamsHandler<{ id: string }>(
  async (req: NextRequest, { user, repos }, { id: projectId }) => {
    try {
      // Verify project belongs to user
      const project = await repos.projects.findById(projectId)

      if (!checkOwnership(project, user.id)) {
        return notFound('Project')
      }

      // Get the file from form data
      const formData = await req.formData()
      const file = formData.get('file') as File | null
      const folderPath = formData.get('folderPath') as string | null

      if (!file) {
        return badRequest('No file provided')
      }

      logger.debug('Uploading file to project', {
        context: 'POST /api/projects/:id/files/upload',
        projectId,
        filename: file.name,
        mimeType: file.type,
        size: file.size,
        folderPath: folderPath || '/',
      })

      // Validate file
      validateFile(file)

      // Read file and compute hash
      const bytes = await file.arrayBuffer()
      const buffer = Buffer.from(bytes)
      const sha256 = createHash('sha256').update(new Uint8Array(buffer)).digest('hex')

      // Determine category based on MIME type
      const category: FileCategory = file.type.startsWith('image/') ? 'IMAGE' : 'DOCUMENT'

      // Check for duplicate by hash within the same project
      const existingFiles = await repos.files.findBySha256(sha256)
      const existingInProject = existingFiles.find(f => f.projectId === projectId)

      if (existingInProject) {
        logger.debug('File with same hash already exists in project', {
          context: 'POST /api/projects/:id/files/upload',
          fileId: existingInProject.id,
          sha256,
        })

        // Return existing file info
        return NextResponse.json({
          file: {
            id: existingInProject.id,
            originalFilename: existingInProject.originalFilename,
            mimeType: existingInProject.mimeType,
            size: existingInProject.size,
            category: existingInProject.category,
            folderPath: existingInProject.folderPath || '/',
            createdAt: existingInProject.createdAt,
          },
          duplicate: true,
        })
      }

      // Generate a new file ID
      const fileId = crypto.randomUUID()

      // Upload to S3
      const s3Key = buildS3Key(user.id, fileId, file.name, category)
      await uploadS3File(s3Key, buffer, file.type, {
        userId: user.id,
        fileId,
        category,
        filename: file.name,
        sha256,
      })

      logger.debug('Uploaded project file to S3', {
        context: 'POST /api/projects/:id/files/upload',
        fileId,
        s3Key,
        size: buffer.length,
      })

      // Create metadata in repository with project association
      // IMPORTANT: Pass the fileId to ensure metadata matches S3 storage path
      const fileEntry = await repos.files.create({
        userId: user.id,
        sha256,
        originalFilename: file.name,
        mimeType: file.type,
        size: buffer.length,
        width: null,
        height: null,
        linkedTo: [],
        source: 'UPLOADED',
        category,
        generationPrompt: null,
        generationModel: null,
        generationRevisedPrompt: null,
        description: null,
        tags: [],
        s3Key,
        projectId,
        folderPath: folderPath || '/',
      }, { id: fileId })

      logger.info('Created project file', {
        context: 'POST /api/projects/:id/files/upload',
        fileId: fileEntry.id,
        projectId,
        filename: file.name,
        folderPath: folderPath || '/',
      })

      return NextResponse.json({
        file: {
          id: fileEntry.id,
          originalFilename: fileEntry.originalFilename,
          mimeType: fileEntry.mimeType,
          size: fileEntry.size,
          category: fileEntry.category,
          folderPath: fileEntry.folderPath || '/',
          createdAt: fileEntry.createdAt,
        },
      })
    } catch (error) {
      logger.error('Error uploading project file', {
        context: 'POST /api/projects/:id/files/upload',
      }, error instanceof Error ? error : undefined)

      if (error instanceof Error) {
        // Return validation errors with 400
        if (
          error.message.includes('Invalid file type') ||
          error.message.includes('File size exceeds')
        ) {
          return badRequest(error.message)
        }
      }

      return serverError('Failed to upload file')
    }
  }
)
