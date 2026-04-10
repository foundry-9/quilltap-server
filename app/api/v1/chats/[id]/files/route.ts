/**
 * Chat Files API v1 Route
 *
 * POST /api/v1/chats/[id]/files - Upload a file for a chat
 * GET /api/v1/chats/[id]/files - List files for a chat
 *
 * Files include both uploaded attachments and generated images.
 * POST uses FormData for file uploads.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createAuthenticatedParamsHandler, getFilePath } from '@/lib/api/middleware';
import { uploadChatFile, type ConflictResolution } from '@/lib/chat-files-v2';
import { logger } from '@/lib/logger';
import { notFound, badRequest, serverError } from '@/lib/api/responses';

/**
 * POST /api/v1/chats/[id]/files - Upload a file or link an existing file
 *
 * Actions:
 *   ?action=link  - Link an existing library file to this chat (JSON body: { fileId })
 *   (default)     - Upload a new file via FormData
 */
export const POST = createAuthenticatedParamsHandler<{ id: string }>(
  async (req: NextRequest, { user, repos }, { id: chatId }) => {
    try {
      // Verify chat belongs to user
      const chat = await repos.chats.findById(chatId);

      if (!chat) {
        return notFound('Chat');
      }

      // Check for action dispatch
      const action = req.nextUrl.searchParams.get('action');

      if (action === 'link') {
        return handleLinkFile(req, repos, chatId);
      }

      // Default: file upload flow
      // Get the file from form data
      const formData = await req.formData();
      const file = formData.get('file') as File | null;

      if (!file) {
        return badRequest('No file provided');
      }

      // Get optional resolution parameters for duplicate handling
      const resolution = formData.get('resolution') as ConflictResolution | null;
      const conflictingFileId = formData.get('conflictingFileId') as string | null;// Upload the file (creates file entry automatically)
      // Pass projectId so files in project chats become project files
      const uploadResult = await uploadChatFile(file, chatId, user.id, {
        projectId: chat.projectId,
        resolution: resolution || undefined,
        conflictingFileId: conflictingFileId || undefined,
      });

      // Check if this is a duplicate detection result
      if ('duplicate' in uploadResult && uploadResult.duplicate) {return NextResponse.json({
          duplicate: true,
          conflictType: uploadResult.conflictType,
          existingFile: uploadResult.existingFile,
          newFile: uploadResult.newFile,
        });
      }

      // Normal upload result - type is narrowed to ChatFileUploadResult
      const successResult = uploadResult as { id: string; filename: string; filepath: string; mimeType: string; size: number };

      // Get the file entry from repository to determine correct filepath
      const fileEntry = await repos.files.findById(successResult.id);
      const filepath = fileEntry ? getFilePath(fileEntry) : successResult.filepath;

      logger.info('[Chats v1 Files] File uploaded', {
        chatId,
        fileId: successResult.id,
        filename: successResult.filename,
      });

      return NextResponse.json({
        file: {
          id: successResult.id,
          filename: successResult.filename,
          filepath,
          mimeType: successResult.mimeType,
          size: successResult.size,
          url: filepath,
        },
      });
    } catch (error) {
      logger.error('[Chats v1 Files] Error uploading chat file', { chatId }, error as Error);

      if (error instanceof Error) {
        // Return validation errors with 400
        if (
          error.message.includes('Invalid file type') ||
          error.message.includes('File size exceeds')
        ) {
          return badRequest(error.message);
        }
      }

      return serverError('Failed to upload file');
    }
  }
);

/**
 * Handle linking an existing library file to a chat
 */
async function handleLinkFile(
  req: NextRequest,
  repos: { files: { findById: (id: string) => Promise<any>; addLink: (fileId: string, entityId: string) => Promise<any> } },
  chatId: string
): Promise<NextResponse> {
  const body = await req.json();
  const { fileId } = body;

  if (!fileId || typeof fileId !== 'string') {
    return badRequest('fileId is required');
  }

  // Verify the file exists
  const file = await repos.files.findById(fileId);
  if (!file) {
    return notFound('File');
  }

  // Link the file to this chat
  const linkedFile = await repos.files.addLink(fileId, chatId);
  if (!linkedFile) {
    return serverError('Failed to link file');
  }

  const filepath = getFilePath(linkedFile);

  logger.info('[Chats v1 Files] File linked from library', {
    chatId,
    fileId: linkedFile.id,
    filename: linkedFile.originalFilename,
  });

  return NextResponse.json({
    file: {
      id: linkedFile.id,
      filename: linkedFile.originalFilename,
      filepath,
      mimeType: linkedFile.mimeType,
      size: linkedFile.size,
      url: filepath,
    },
  });
}

/**
 * GET /api/v1/chats/[id]/files - List files for a chat (includes uploaded files and generated images)
 */
export const GET = createAuthenticatedParamsHandler<{ id: string }>(
  async (req: NextRequest, { user, repos }, { id: chatId }) => {
    try {
      // Verify chat belongs to user
      const chat = await repos.chats.findById(chatId);

      if (!chat) {
        return notFound('Chat');
      }

      // Get all files linked to this chat from repository
      const chatFiles = await repos.files.findByLinkedTo(chatId);

      // Format files for response
      const allFiles = chatFiles.map((f) => ({
        id: f.id,
        filename: f.originalFilename,
        filepath: getFilePath(f),
        mimeType: f.mimeType,
        size: f.size,
        url: getFilePath(f),
        createdAt: f.createdAt,
        type: f.source === 'GENERATED' ? 'generatedImage' as const : 'chatFile' as const,
      }));

      // Sort by creation time, newest first
      allFiles.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());return NextResponse.json({
        files: allFiles,
      });
    } catch (error) {
      logger.error('[Chats v1 Files] Error listing chat files', { chatId }, error as Error);
      return serverError('Failed to list files');
    }
  }
);
