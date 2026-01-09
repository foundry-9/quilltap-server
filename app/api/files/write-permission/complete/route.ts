/**
 * File Write Permission Completion API Route
 *
 * Handles the completion of pending file write requests after user approval/denial.
 * This is called after the user responds to a file write permission prompt.
 *
 * POST /api/files/write-permission/complete
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createAuthenticatedHandler } from '@/lib/api/middleware';
import { logger } from '@/lib/logger';
import { badRequest, serverError } from '@/lib/api/responses';
import { fileStorageManager } from '@/lib/file-storage/manager';
import { createHash } from 'crypto';

// Validation schema for completing a pending write
const completeWriteSchema = z.object({
  chatId: z.string().uuid(),
  action: z.enum(['approve', 'deny']),
  pendingWrite: z.object({
    filename: z.string().min(1),
    content: z.string(),
    mimeType: z.string().optional().default('text/plain'),
    folderPath: z.string().optional().default('/'),
    projectId: z.string().uuid().nullable(),
  }),
});

/**
 * POST /api/files/write-permission/complete
 * Complete a pending file write after user approval/denial
 */
export const POST = createAuthenticatedHandler(
  async (request, { user, repos }) => {
    const log = logger.child({
      module: 'api-files-write-permission-complete',
      userId: user.id,
    });

    try {
      const body = await request.json();
      const parsed = completeWriteSchema.safeParse(body);

      if (!parsed.success) {
        log.debug('Invalid completion request', { errors: parsed.error.errors });
        return badRequest('Invalid request: ' + parsed.error.errors.map(e => e.message).join(', '));
      }

      const { chatId, action, pendingWrite } = parsed.data;

      log.debug('Processing write completion', {
        chatId,
        action,
        filename: pendingWrite.filename,
        projectId: pendingWrite.projectId,
      });

      // Verify chat exists and belongs to user
      const chat = await repos.chats.findById(chatId);
      if (!chat || chat.userId !== user.id) {
        return badRequest('Chat not found');
      }

      // Handle denial
      if (action === 'deny') {
        log.info('File write denied by user', {
          chatId,
          filename: pendingWrite.filename,
        });

        // Create a tool message showing the denial
        const toolMessageId = crypto.randomUUID();
        const toolMessage = {
          id: toolMessageId,
          type: 'message' as const,
          role: 'TOOL' as const,
          content: JSON.stringify({
            toolName: 'file_management',
            success: false,
            result: 'File write request was denied by the user.',
            arguments: {
              action: 'write_file',
              filename: pendingWrite.filename,
            },
          }),
          createdAt: new Date().toISOString(),
          attachments: [],
        };
        await repos.chats.addMessage(chatId, toolMessage);

        return NextResponse.json({
          success: true,
          action: 'denied',
          message: 'File write request denied',
          toolMessageId: toolMessage.id,
        });
      }

      // Handle approval - grant permission first
      const scope = pendingWrite.projectId ? 'PROJECT' : 'GENERAL';

      // Check if permission already exists
      const existingPermissions = await repos.filePermissions.findByUserId(user.id);
      const alreadyExists = existingPermissions.some((p) => {
        if (scope === 'PROJECT') {
          return p.scope === 'PROJECT' && p.projectId === pendingWrite.projectId;
        }
        if (scope === 'GENERAL') {
          return p.scope === 'GENERAL';
        }
        return false;
      });

      // Grant permission if not already granted
      if (!alreadyExists) {
        const now = new Date().toISOString();
        await repos.filePermissions.grantPermission({
          userId: user.id,
          scope,
          fileId: null,
          projectId: scope === 'PROJECT' ? pendingWrite.projectId : null,
          grantedAt: now,
          grantedInChatId: chatId,
        });

        log.info('Permission granted during completion', {
          scope,
          projectId: pendingWrite.projectId,
        });
      }

      // Now execute the file write
      const { filename, content, mimeType, folderPath, projectId } = pendingWrite;
      const contentBuffer = Buffer.from(content, 'utf-8');
      const sha256 = createHash('sha256').update(new Uint8Array(contentBuffer)).digest('hex');
      const fileId = crypto.randomUUID();

      // Upload to file storage
      const { storageKey, mountPointId } = await fileStorageManager.uploadFile({
        userId: user.id,
        fileId,
        filename,
        content: contentBuffer,
        contentType: mimeType,
        projectId,
        folderPath,
      });

      // Create file entry
      const fileEntry = await repos.files.create({
        userId: user.id,
        sha256,
        originalFilename: filename,
        mimeType,
        size: contentBuffer.length,
        linkedTo: [],
        source: 'SYSTEM',
        category: 'DOCUMENT',
        generationPrompt: null,
        generationModel: null,
        generationRevisedPrompt: null,
        description: 'Created by LLM file management tool',
        tags: [],
        projectId,
        folderPath,
        storageKey,
        mountPointId,
      }, { id: fileId });

      log.info('File created after approval', {
        fileId: fileEntry.id,
        filename,
        folderPath,
        projectId,
      });

      // Create a tool message showing the success
      const toolMessageId = crypto.randomUUID();
      const toolMessage = {
        id: toolMessageId,
        type: 'message' as const,
        role: 'TOOL' as const,
        content: JSON.stringify({
          toolName: 'file_management',
          success: true,
          result: `File "${filename}" created successfully in folder "${folderPath}".`,
          arguments: {
            action: 'write_file',
            filename,
            targetFolderPath: folderPath,
          },
          fileId: fileEntry.id,
        }),
        createdAt: new Date().toISOString(),
        attachments: [],
      };
      await repos.chats.addMessage(chatId, toolMessage);

      return NextResponse.json({
        success: true,
        action: 'approved',
        file: {
          id: fileEntry.id,
          filename: fileEntry.originalFilename,
          folderPath,
          projectId,
        },
        toolMessageId: toolMessage.id,
        message: `File "${filename}" created successfully`,
      });
    } catch (error) {
      log.error('Error completing file write', {}, error instanceof Error ? error : undefined);
      return serverError('Failed to complete file write');
    }
  }
);
