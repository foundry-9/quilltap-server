/**
 * Files API v1 - Write Permissions Endpoint
 *
 * GET /api/v1/files/write-permissions - List user's file write permissions
 * POST /api/v1/files/write-permissions - Grant a new file write permission (no action param)
 * POST /api/v1/files/write-permissions?action=revoke - Revoke a permission
 * POST /api/v1/files/write-permissions?action=complete - Complete a pending file write (approve/deny)
 */

import { NextRequest, NextResponse } from 'next/server';
import { createAuthenticatedHandler } from '@/lib/api/middleware';
import { getActionParam } from '@/lib/api/middleware/actions';
import { logger } from '@/lib/logger';
import { z } from 'zod';
import { successResponse, badRequest, notFound, forbidden, serverError, validationError } from '@/lib/api/responses';
import { FileWritePermissionScopeEnum } from '@/lib/schemas/file-permissions.types';
import { fileStorageManager } from '@/lib/file-storage/manager';
import { createHash } from 'crypto';

// ============================================================================
// Schemas
// ============================================================================

const grantPermissionSchema = z.object({
  scope: FileWritePermissionScopeEnum,
  fileId: z.string().uuid().optional(),
  projectId: z.string().uuid().optional(),
  grantedInChatId: z.string().uuid().optional(),
});

const revokePermissionSchema = z.object({
  permissionId: z.string().uuid(),
});

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

// ============================================================================
// GET Handler - List permissions
// ============================================================================

export const GET = createAuthenticatedHandler(async (_request, { user, repos }) => {
  try {
    logger.debug('[Files v1] GET list file write permissions', { userId: user.id });

    const permissions = await repos.filePermissions.findByUserId(user.id);

    // Enrich with project/file names where applicable
    const enrichedPermissions = await Promise.all(
      permissions.map(async (perm: any) => {
        let projectName: string | null = null;
        let filename: string | null = null;

        if (perm.projectId) {
          const project = await repos.projects.findById(perm.projectId);
          projectName = project?.name || null;
        }

        if (perm.fileId) {
          const file = await repos.files.findById(perm.fileId);
          filename = file?.originalFilename || null;
        }

        return {
          id: perm.id,
          scope: perm.scope,
          projectId: perm.projectId,
          projectName,
          fileId: perm.fileId,
          filename,
          grantedAt: perm.grantedAt,
          grantedInChatId: perm.grantedInChatId,
          createdAt: perm.createdAt,
        };
      })
    );

    logger.debug('[Files v1] Retrieved file write permissions', {
      userId: user.id,
      count: enrichedPermissions.length,
    });

    return successResponse({ permissions: enrichedPermissions });
  } catch (error) {
    logger.error('[Files v1] Error fetching file write permissions', {}, error instanceof Error ? error : undefined);
    return serverError('Failed to fetch permissions');
  }
});

// ============================================================================
// POST Handler - Action dispatch
// ============================================================================

export const POST = createAuthenticatedHandler(async (request, { user, repos }) => {
  const action = getActionParam(request);

  switch (action) {
    case 'revoke':
      return handleRevokePermission(request, user, repos);
    case 'complete':
      return handleCompleteWrite(request, user, repos);
    default:
      // No action = grant permission (default POST behavior)
      return handleGrantPermission(request, user, repos);
  }
});

// ============================================================================
// Action: Grant Permission (default POST)
// ============================================================================

async function handleGrantPermission(request: NextRequest, user: any, repos: any): Promise<NextResponse> {
  try {
    const body = await request.json();
    const parsed = grantPermissionSchema.safeParse(body);

    if (!parsed.success) {
      logger.debug('[Files v1] Invalid permission grant request', { errors: parsed.error.errors });
      return validationError(parsed.error);
    }

    const { scope, fileId, projectId, grantedInChatId } = parsed.data;

    logger.debug('[Files v1] Processing file write permission grant', {
      userId: user.id,
      scope,
      fileId,
      projectId,
      grantedInChatId,
    });

    // Validate that required IDs are provided based on scope
    if (scope === 'SINGLE_FILE' && !fileId) {
      return badRequest('fileId is required for SINGLE_FILE scope');
    }
    if (scope === 'PROJECT' && !projectId) {
      return badRequest('projectId is required for PROJECT scope');
    }

    // Verify ownership of referenced entities
    if (fileId) {
      const file = await repos.files.findById(fileId);
      if (!file || file.userId !== user.id) {
        logger.debug('[Files v1] File not found or not owned by user', { fileId });
        return notFound('File');
      }
    }

    if (projectId) {
      const project = await repos.projects.findById(projectId);
      if (!project || project.userId !== user.id) {
        logger.debug('[Files v1] Project not found or not owned by user', { projectId });
        return notFound('Project');
      }
    }

    if (grantedInChatId) {
      const chat = await repos.chats.findById(grantedInChatId);
      if (!chat || chat.userId !== user.id) {
        logger.debug('[Files v1] Chat not found or not owned by user', { grantedInChatId });
        return notFound('Chat');
      }
    }

    // Create the permission
    const permission = await repos.filePermissions.create({
      userId: user.id,
      scope,
      fileId: fileId || null,
      projectId: projectId || null,
      grantedAt: new Date().toISOString(),
      grantedInChatId: grantedInChatId || null,
    });

    logger.info('[Files v1] File write permission granted', {
      userId: user.id,
      permissionId: permission.id,
      scope,
    });

    // Enrich response
    let projectName: string | null = null;
    let filename: string | null = null;

    if (projectId) {
      const project = await repos.projects.findById(projectId);
      projectName = project?.name || null;
    }

    if (fileId) {
      const file = await repos.files.findById(fileId);
      filename = file?.originalFilename || null;
    }

    return successResponse(
      {
        permission: {
          id: permission.id,
          scope: permission.scope,
          projectId: permission.projectId,
          projectName,
          fileId: permission.fileId,
          filename,
          grantedAt: permission.grantedAt,
          grantedInChatId: permission.grantedInChatId,
          createdAt: permission.createdAt,
        },
      },
      201
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return validationError(error);
    }
    logger.error('[Files v1] Error granting file write permission', {}, error instanceof Error ? error : undefined);
    return serverError('Failed to grant permission');
  }
}

// ============================================================================
// Action: Revoke Permission
// ============================================================================

async function handleRevokePermission(request: NextRequest, user: any, repos: any): Promise<NextResponse> {
  try {
    const body = await request.json();
    const parsed = revokePermissionSchema.safeParse(body);

    if (!parsed.success) {
      return validationError(parsed.error);
    }

    const { permissionId } = parsed.data;

    logger.debug('[Files v1] Processing permission revoke request', {
      userId: user.id,
      permissionId,
    });

    // Get the permission to verify ownership
    const permission = await repos.filePermissions.findById(permissionId);

    if (!permission) {
      logger.debug('[Files v1] Permission not found', { permissionId });
      return notFound('Permission');
    }

    // Verify ownership
    if (permission.userId !== user.id) {
      logger.warn('[Files v1] Permission revoke denied - not owner', { permissionId });
      return forbidden();
    }

    // Revoke the permission
    const revoked = await repos.filePermissions.revokePermission(permissionId);

    if (!revoked) {
      logger.warn('[Files v1] Permission revoke failed', { permissionId });
      return notFound('Permission');
    }

    logger.info('[Files v1] File write permission revoked', {
      permissionId,
      scope: permission.scope,
      projectId: permission.projectId,
      fileId: permission.fileId,
    });

    return successResponse({
      message: 'Permission revoked',
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return validationError(error);
    }
    logger.error('[Files v1] Error revoking file write permission', {}, error instanceof Error ? error : undefined);
    return serverError('Failed to revoke permission');
  }
}

// ============================================================================
// Action: Complete Write (Approve/Deny pending file write)
// ============================================================================

async function handleCompleteWrite(request: NextRequest, user: any, repos: any): Promise<NextResponse> {
  try {
    const body = await request.json();
    const parsed = completeWriteSchema.safeParse(body);

    if (!parsed.success) {
      logger.debug('[Files v1] Invalid completion request', { errors: parsed.error.errors });
      return validationError(parsed.error);
    }

    const { chatId, action, pendingWrite } = parsed.data;

    logger.debug('[Files v1] Processing write completion', {
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
      logger.info('[Files v1] File write denied by user', {
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

      return successResponse({
        action: 'denied',
        message: 'File write request denied',
        toolMessageId: toolMessage.id,
      });
    }

    // Handle approval - grant permission first
    const scope = pendingWrite.projectId ? 'PROJECT' : 'GENERAL';

    // Check if permission already exists
    const existingPermissions = await repos.filePermissions.findByUserId(user.id);
    const alreadyExists = existingPermissions.some((p: any) => {
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

      logger.info('[Files v1] Permission granted during completion', {
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

    logger.info('[Files v1] File created after approval', {
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

    return successResponse({
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
    if (error instanceof z.ZodError) {
      return validationError(error);
    }
    logger.error('[Files v1] Error completing file write', {}, error instanceof Error ? error : undefined);
    return serverError('Failed to complete file write');
  }
}
