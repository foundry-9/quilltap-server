/**
 * Project Files Upload API: Direct file upload to project
 * POST /api/projects/:id/files/upload - Upload a file directly to a project
 */

import { createHash } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { createAuthenticatedParamsHandler, checkOwnership } from '@/lib/api/middleware'
import { logger } from '@/lib/logger'
import { notFound, badRequest, serverError } from '@/lib/api/responses'
import { fileStorageManager } from '@/lib/file-storage/manager'
import { detectTextContent, getBestMimeType } from '@/lib/files/text-detection'
import type { FileCategory } from '@/lib/schemas/types'

/**
 * Maximum file size in bytes (10 MB)
 */
const MAX_FILE_SIZE = 10 * 1024 * 1024

/**
 * Validate project file upload (size only - no type restrictions)
 */
function validateFile(file: File): void {
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

      // Detect text content and infer better MIME type if needed
      const textDetection = detectTextContent(buffer, file.name, file.type)
      const mimeType = getBestMimeType(textDetection, file.type)

      logger.debug('Text detection result', {
        context: 'POST /api/projects/:id/files/upload',
        filename: file.name,
        providedMimeType: file.type,
        detectedMimeType: textDetection.detectedMimeType,
        finalMimeType: mimeType,
        isPlainText: textDetection.isPlainText,
      })

      // Determine category based on MIME type
      const category: FileCategory = mimeType.startsWith('image/') ? 'IMAGE' : 'DOCUMENT'

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

      // Upload to file storage
      const { storageKey, mountPointId } = await fileStorageManager.uploadFile({
        userId: user.id,
        fileId,
        filename: file.name,
        content: buffer,
        contentType: mimeType,
        projectId,
        folderPath: folderPath || '/',
      })

      logger.debug('Uploaded project file to storage', {
        context: 'POST /api/projects/:id/files/upload',
        fileId,
        storageKey,
        size: buffer.length,
      })

      // Create metadata in repository with project association
      // IMPORTANT: Pass the fileId to ensure metadata matches storage path
      const fileEntry = await repos.files.create({
        userId: user.id,
        sha256,
        originalFilename: file.name,
        mimeType,
        size: buffer.length,
        width: null,
        height: null,
        isPlainText: textDetection.isPlainText,
        linkedTo: [],
        source: 'UPLOADED',
        category,
        generationPrompt: null,
        generationModel: null,
        generationRevisedPrompt: null,
        description: null,
        tags: [],
        storageKey,
        mountPointId,
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
        if (error.message.includes('File size exceeds')) {
          return badRequest(error.message)
        }
      }

      return serverError('Failed to upload file')
    }
  }
)
