/**
 * Projects API v1 - Individual Project Endpoint
 *
 * GET /api/v1/projects/[id] - Get project details
 * PUT /api/v1/projects/[id] - Update project
 * DELETE /api/v1/projects/[id] - Delete project
 *
 * Actions:
 * GET /api/v1/projects/[id]?action=list-characters - List character roster
 * POST /api/v1/projects/[id]?action=add-character - Add character to roster
 * DELETE /api/v1/projects/[id]?action=remove-character - Remove character from roster
 *
 * GET /api/v1/projects/[id]?action=list-chats - List project chats
 * POST /api/v1/projects/[id]?action=add-chat - Associate chat with project
 * DELETE /api/v1/projects/[id]?action=remove-chat - Remove chat from project
 *
 * GET /api/v1/projects/[id]?action=list-files - List project files
 * POST /api/v1/projects/[id]?action=add-file - Associate file with project
 * DELETE /api/v1/projects/[id]?action=remove-file - Remove file from project
 *
 * GET /api/v1/projects/[id]?action=get-mount-point - Get project mount point config
 * PUT /api/v1/projects/[id]?action=set-mount-point - Set project mount point
 * DELETE /api/v1/projects/[id]?action=clear-mount-point - Clear project mount point (use system default)
 *
 * GET /api/v1/projects/[id]?action=get-state - Get project state
 * GET /api/v1/projects/[id]?action=get-background - Get project story background URL
 * PUT /api/v1/projects/[id]?action=set-state - Set project state
 * DELETE /api/v1/projects/[id]?action=reset-state - Reset project state to empty
 */

import { NextRequest, NextResponse } from 'next/server';
import { createAuthenticatedParamsHandler, checkOwnership, AuthenticatedContext, enrichWithDefaultImage, getFilePath } from '@/lib/api/middleware';
import { getActionParam } from '@/lib/api/middleware/actions';
import { z } from 'zod';
import { logger } from '@/lib/logger';
import { notFound, badRequest, validationError, serverError, successResponse } from '@/lib/api/responses';
import { mountPointsRepository } from '@/lib/database/repositories/mount-points.repository';
import { fileStorageManager } from '@/lib/file-storage/manager';

// ============================================================================
// Schemas
// ============================================================================

const updateProjectSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(2000).nullable().optional(),
  instructions: z.string().max(10000).nullable().optional(),
  allowAnyCharacter: z.boolean().optional(),
  characterRoster: z.array(z.uuid()).optional(),
  color: z.string().regex(/^#(?:[0-9a-fA-F]{3}){1,2}$/).nullable().optional(),
  icon: z.string().max(50).nullable().optional(),
  defaultAgentModeEnabled: z.boolean().nullable().optional(),
  backgroundDisplayMode: z.enum(['latest_chat', 'project', 'static', 'theme']).optional(),
});

const addCharacterSchema = z.object({
  characterId: z.uuid(),
});

const removeCharacterSchema = z.object({
  characterId: z.uuid(),
});

const addChatSchema = z.object({
  chatId: z.uuid(),
});

const removeChatSchema = z.object({
  chatId: z.uuid(),
});

const addFileSchema = z.object({
  fileId: z.uuid(),
});

const removeFileSchema = z.object({
  fileId: z.uuid(),
});

const setMountPointSchema = z.object({
  mountPointId: z.uuid(),
  migrateFiles: z.boolean().optional().default(false),
});

const updateToolSettingsSchema = z.object({
  defaultDisabledTools: z.array(z.string()),
  defaultDisabledToolGroups: z.array(z.string()),
});

const setStateSchema = z.object({
  state: z.record(z.string(), z.unknown()),
});

// ============================================================================
// GET Handlers
// ============================================================================

async function handleGetDefault(req: NextRequest, context: AuthenticatedContext, { id }: { id: string }) {
  const { user, repos } = context;

  try {

    const project = await repos.projects.findById(id);

    if (!checkOwnership(project, user.id)) {
      return notFound('Project');
    }

    // Get chats in this project
    const allChats = await repos.chats.findAll();
    const projectChats = allChats.filter(c => c.projectId === project.id);

    // Get files in this project
    const allFiles = await repos.files.findAll();
    const projectFiles = allFiles.filter(f => f.projectId === project.id);

    // Get characters in roster with their details
    const enrichedCharacterRoster = await Promise.all(
      project.characterRoster.map(async (charId: string) => {
        const char = await repos.characters.findById(charId);
        if (!char) return null;

        // Count chats with this character in this project
        const charProjectChats = projectChats.filter(chat =>
          chat.participants?.some((p: any) => p.characterId === charId)
        );

        // Get default image for avatar display
        const defaultImage = await enrichWithDefaultImage(char.defaultImageId, repos);

        return {
          id: char.id,
          name: char.name,
          avatarUrl: char.avatarUrl,
          defaultImageId: char.defaultImageId,
          defaultImage,
          tags: char.tags || [],
          chatCount: charProjectChats.length,
        };
      })
    );

    const enrichedProject = {
      ...project,
      characterRoster: enrichedCharacterRoster.filter(Boolean),
      _count: {
        chats: projectChats.length,
        files: projectFiles.length,
        characters: project.characterRoster.length,
      },
    };

    return successResponse({ project: enrichedProject });
  } catch (error) {
    logger.error('[Projects v1] Error fetching project', { projectId: id }, error instanceof Error ? error : undefined);
    return serverError('Failed to fetch project');
  }
}

async function handleListCharacters(req: NextRequest, context: AuthenticatedContext, { id }: { id: string }) {
  const { user, repos } = context;

  try {

    const project = await repos.projects.findById(id);
    if (!checkOwnership(project, user.id)) {
      return notFound('Project');
    }

    // Get character details for each in roster
    const characters = await Promise.all(
      project.characterRoster.map(async (charId: string) => {
        const char = await repos.characters.findById(charId);
        if (!char) return null;

        return {
          id: char.id,
          name: char.name,
          avatarUrl: char.avatarUrl,
          tags: char.tags || [],
        };
      })
    );

    return successResponse({
      characters: characters.filter(Boolean),
      count: characters.filter(Boolean).length,
    });
  } catch (error) {
    logger.error('[Projects v1] Error listing project characters', { projectId: id }, error instanceof Error ? error : undefined);
    return serverError('Failed to list characters');
  }
}

async function handleListChats(req: NextRequest, context: AuthenticatedContext, { id }: { id: string }) {
  const { user, repos } = context;

  try {

    const project = await repos.projects.findById(id);
    if (!checkOwnership(project, user.id)) {
      return notFound('Project');
    }

    // Parse pagination params
    const { searchParams } = new URL(req.url);
    const limit = parseInt(searchParams.get('limit') || '20', 10);
    const offset = parseInt(searchParams.get('offset') || '0', 10);

    const allChats = await repos.chats.findAll();
    const projectChats = allChats.filter(c => c.projectId === id);

    // Sort by lastMessageAt descending, falling back to updatedAt for chats without messages
    projectChats.sort((a, b) => {
      const aTime = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : new Date(a.updatedAt).getTime();
      const bTime = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : new Date(b.updatedAt).getTime();
      return bTime - aTime;
    });

    // Get total count before pagination
    const total = projectChats.length;

    // Apply pagination
    const paginatedChats = projectChats.slice(offset, offset + limit);

    // Fetch all tags for resolving tag names
    const allTags = await repos.tags.findAll();
    const tagMap = new Map(allTags.map(t => [t.id, t]));

    // Enrich with participant info and tags
    const enrichedChats = await Promise.all(
      paginatedChats.map(async (chat) => {
        const participants = await Promise.all(
          chat.participants.map(async (p: any) => {
            if (p.characterId) {
              const char = await repos.characters.findById(p.characterId);
              if (!char) return null;

              // Fetch defaultImage if character has one
              const defaultImage = await enrichWithDefaultImage(char.defaultImageId, repos);

              return {
                id: p.id,
                name: char.name,
                avatarUrl: char.avatarUrl,
                defaultImage,
                tags: char.tags || [],
              };
            }
            return null;
          })
        );

        // Resolve chat tags to include tag objects with names
        const chatTags = (chat.tags || [])
          .map((tagId: string) => {
            const tag = tagMap.get(tagId);
            return tag ? { tag: { id: tag.id, name: tag.name } } : null;
          })
          .filter(Boolean);

        // Get story background if available
        let storyBackground = null;
        if (chat.storyBackgroundImageId) {
          const bgFile = await repos.files.findById(chat.storyBackgroundImageId);
          if (bgFile) {
            storyBackground = {
              id: bgFile.id,
              filepath: getFilePath(bgFile),
            };
          }
        }

        return {
          id: chat.id,
          title: chat.title,
          messageCount: chat.messageCount,
          participants: participants.filter(Boolean),
          tags: chatTags,
          storyBackground,
          isDangerousChat: chat.isDangerousChat === true,
          lastMessageAt: chat.lastMessageAt ?? null,
          updatedAt: chat.updatedAt,
          createdAt: chat.createdAt,
        };
      })
    );return successResponse({
      chats: enrichedChats,
      pagination: {
        total,
        offset,
        limit,
        hasMore: offset + enrichedChats.length < total,
      },
    });
  } catch (error) {
    logger.error('[Projects v1] Error listing project chats', { projectId: id }, error instanceof Error ? error : undefined);
    return serverError('Failed to list chats');
  }
}

async function handleListFiles(req: NextRequest, context: AuthenticatedContext, { id }: { id: string }) {
  const { user, repos } = context;

  try {

    const project = await repos.projects.findById(id);
    if (!checkOwnership(project, user.id)) {
      return notFound('Project');
    }

    const allFiles = await repos.files.findAll();
    const files = allFiles
      .filter(f => f.projectId === id)
      .map(f => ({
        id: f.id,
        userId: f.userId,
        originalFilename: f.originalFilename,
        filename: f.originalFilename,
        mimeType: f.mimeType,
        size: f.size,
        category: f.category,
        description: f.description,
        projectId: f.projectId,
        folderPath: f.folderPath || '/',
        width: f.width,
        height: f.height,
        createdAt: f.createdAt,
        updatedAt: f.updatedAt,
      }));

    return successResponse({
      files,
      count: files.length,
    });
  } catch (error) {
    logger.error('[Projects v1] Error listing project files', { projectId: id }, error instanceof Error ? error : undefined);
    return serverError('Failed to list files');
  }
}

async function handleGetState(req: NextRequest, context: AuthenticatedContext, { id }: { id: string }) {
  const { user, repos } = context;

  try {
    const project = await repos.projects.findById(id);
    if (!checkOwnership(project, user.id)) {
      return notFound('Project');
    }

    const projectState = (project.state || {}) as Record<string, unknown>;

    return successResponse({
      success: true,
      state: projectState,
    });
  } catch (error) {
    logger.error('[Projects v1] Error getting state', { projectId: id }, error instanceof Error ? error : undefined);
    return serverError('Failed to get state');
  }
}

async function handleGetBackground(req: NextRequest, context: AuthenticatedContext, { id }: { id: string }) {
  const { user, repos } = context;

  try {
    const project = await repos.projects.findById(id);
    if (!checkOwnership(project, user.id)) {
      return notFound('Project');
    }

    // Determine the background based on backgroundDisplayMode
    const displayMode = project.backgroundDisplayMode || 'theme';

    // If mode is 'theme', no background
    if (displayMode === 'theme') {
      return NextResponse.json({ backgroundUrl: null, displayMode });
    }

    // If mode is 'static', use staticBackgroundImageId
    if (displayMode === 'static' && project.staticBackgroundImageId) {
      const file = await repos.files.findById(project.staticBackgroundImageId);
      if (file) {
        return NextResponse.json({
          backgroundUrl: getFilePath(file),
          displayMode,
        });
      }
    }

    // If mode is 'project', use storyBackgroundImageId
    if (displayMode === 'project' && project.storyBackgroundImageId) {
      const file = await repos.files.findById(project.storyBackgroundImageId);
      if (file) {
        return NextResponse.json({
          backgroundUrl: getFilePath(file),
          displayMode,
        });
      }
    }

    // If mode is 'latest_chat', find the most recently updated chat with a background
    if (displayMode === 'latest_chat') {
      const allChats = await repos.chats.findAll();
      const projectChats = allChats
        .filter(c => c.projectId === id && c.storyBackgroundImageId)
        .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

      if (projectChats.length > 0 && projectChats[0].storyBackgroundImageId) {
        const file = await repos.files.findById(projectChats[0].storyBackgroundImageId);
        if (file) {
          return NextResponse.json({
            backgroundUrl: getFilePath(file),
            displayMode,
            sourceChatId: projectChats[0].id,
          });
        }
      }
    }

    // No background available
    return NextResponse.json({ backgroundUrl: null, displayMode });
  } catch (error) {
    logger.error('[Projects v1] Error getting background', { projectId: id }, error instanceof Error ? error : undefined);
    return serverError('Failed to get background');
  }
}

async function handleGetMountPoint(req: NextRequest, context: AuthenticatedContext, { id }: { id: string }) {
  const { user, repos } = context;

  try {

    const project = await repos.projects.findById(id);
    if (!checkOwnership(project, user.id)) {
      return notFound('Project');
    }

    // Get current mount point if set
    let currentMountPoint = null;
    if (project.mountPointId) {
      const mp = await mountPointsRepository.findById(project.mountPointId);
      if (mp) {
        currentMountPoint = {
          id: mp.id,
          name: mp.name,
          backendType: mp.backendType,
          healthStatus: mp.healthStatus,
        };
      }
    }

    // Get system default mount point
    let defaultMountPoint = null;
    const defaultMp = await mountPointsRepository.findDefault();
    if (defaultMp) {
      defaultMountPoint = {
        id: defaultMp.id,
        name: defaultMp.name,
        backendType: defaultMp.backendType,
        healthStatus: defaultMp.healthStatus,
      };
    }

    // Effective mount point is current if set, otherwise default
    const effectiveMountPoint = currentMountPoint || defaultMountPoint;

    // Count files in this project
    const allFiles = await repos.files.findAll();
    const fileCount = allFiles.filter(f => f.projectId === id).length;

    return successResponse({
      projectId: id,
      mountPointId: project.mountPointId || null,
      currentMountPoint,
      defaultMountPoint,
      effectiveMountPoint,
      fileCount,
    });
  } catch (error) {
    logger.error('[Projects v1] Error getting project mount point', { projectId: id }, error instanceof Error ? error : undefined);
    return serverError('Failed to get mount point');
  }
}

export const GET = createAuthenticatedParamsHandler<{ id: string }>(async (req, context, { id }) => {
  const action = getActionParam(req);

  switch (action) {
    case 'list-characters':
      return handleListCharacters(req, context, { id });
    case 'list-chats':
      return handleListChats(req, context, { id });
    case 'list-files':
      return handleListFiles(req, context, { id });
    case 'get-mount-point':
      return handleGetMountPoint(req, context, { id });
    case 'get-state':
      return handleGetState(req, context, { id });
    case 'get-background':
      return handleGetBackground(req, context, { id });
    default:
      return handleGetDefault(req, context, { id });
  }
});

// ============================================================================
// PUT Handlers
// ============================================================================

async function handlePutDefault(req: NextRequest, context: AuthenticatedContext, { id }: { id: string }) {
  const { user, repos } = context;

  try {

    const existingProject = await repos.projects.findById(id);

    if (!checkOwnership(existingProject, user.id)) {
      return notFound('Project');
    }

    const body = await req.json();
    const validatedData = updateProjectSchema.parse(body);

    const project = await repos.projects.update(id, validatedData);

    logger.info('[Projects v1] Project updated', { projectId: id, userId: user.id });

    return successResponse({ project });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return validationError(error);
    }

    logger.error('[Projects v1] Error updating project', { projectId: id }, error instanceof Error ? error : undefined);
    return serverError('Failed to update project');
  }
}

async function handleSetState(req: NextRequest, context: AuthenticatedContext, { id }: { id: string }) {
  const { user, repos } = context;

  try {
    const project = await repos.projects.findById(id);
    if (!checkOwnership(project, user.id)) {
      return notFound('Project');
    }

    const body = await req.json();
    const validated = setStateSchema.parse(body);

    // Update state
    const updatedProject = await repos.projects.update(id, {
      state: validated.state,
    });

    logger.info('[Projects v1] State updated', {
      projectId: id,
      userId: user.id,
      stateKeys: Object.keys(validated.state),
    });

    return successResponse({
      success: true,
      state: updatedProject?.state || validated.state,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return validationError(error);
    }
    logger.error('[Projects v1] Error setting state', { projectId: id }, error instanceof Error ? error : undefined);
    return serverError('Failed to set state');
  }
}

async function handleSetMountPoint(req: NextRequest, context: AuthenticatedContext, { id }: { id: string }) {
  const { user, repos } = context;

  try {
    const project = await repos.projects.findById(id);
    if (!checkOwnership(project, user.id)) {
      return notFound('Project');
    }

    const body = await req.json();
    const { mountPointId, migrateFiles } = setMountPointSchema.parse(body);


    // Verify mount point exists
    const mountPoint = await mountPointsRepository.findById(mountPointId);
    if (!mountPoint) {
      return notFound('Mount point');
    }

    // If migrateFiles is requested, migrate all project files to the new mount point
    let migrationResult = { migrated: 0, failed: 0, errors: [] as Array<{ fileId: string; error: string }> };

    if (migrateFiles) {
      const allFiles = await repos.files.findAll();
      const projectFiles = allFiles.filter(f => f.projectId === id);

      for (const file of projectFiles) {
        try {
          // Skip if file is already on the target mount point
          if (file.mountPointId === mountPointId) {
            continue;
          }

          // Download file from current location
          const buffer = await fileStorageManager.downloadFile(file);

          // Upload to new mount point
          const uploadResult = await fileStorageManager.uploadFile({
            userId: user.id,
            fileId: file.id,
            filename: file.originalFilename,
            content: buffer,
            contentType: file.mimeType,
            projectId: id,
            mountPointId: mountPointId,
          });

          // Update file record with new storage info
          await repos.files.update(file.id, {
            mountPointId: uploadResult.mountPointId,
            storageKey: uploadResult.storageKey,
          });

          // Delete from old mount point
          await fileStorageManager.deleteFile(file);

          migrationResult.migrated++;
        } catch (error) {
          migrationResult.failed++;
          migrationResult.errors.push({
            fileId: file.id,
            error: error instanceof Error ? error.message : String(error),
          });
          logger.error('[Projects v1] Failed to migrate file', {
            fileId: file.id,
            projectId: id,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      logger.info('[Projects v1] File migration completed', {
        projectId: id,
        mountPointId,
        migrated: migrationResult.migrated,
        failed: migrationResult.failed,
      });
    }

    // Update project with new mount point
    await repos.projects.setMountPoint(id, mountPointId);

    logger.info('[Projects v1] Mount point set for project', { projectId: id, mountPointId });

    return successResponse({
      success: true,
      mountPointId,
      migration: migrateFiles ? migrationResult : undefined,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return validationError(error);
    }

    logger.error('[Projects v1] Error setting mount point', { projectId: id }, error instanceof Error ? error : undefined);
    return serverError('Failed to set mount point');
  }
}

export const PUT = createAuthenticatedParamsHandler<{ id: string }>(async (req, context, { id }) => {
  const action = getActionParam(req);

  switch (action) {
    case 'set-mount-point':
      return handleSetMountPoint(req, context, { id });
    case 'set-state':
      return handleSetState(req, context, { id });
    default:
      return handlePutDefault(req, context, { id });
  }
});

// ============================================================================
// DELETE Handlers
// ============================================================================

async function handleRemoveCharacter(req: NextRequest, context: AuthenticatedContext, { id }: { id: string }) {
  const { user, repos } = context;

  try {
    const project = await repos.projects.findById(id);
    if (!checkOwnership(project, user.id)) {
      return notFound('Project');
    }

    const body = await req.json();
    const { characterId } = removeCharacterSchema.parse(body);


    // Remove from roster
    const updatedRoster = project.characterRoster.filter((cid: string) => cid !== characterId);
    await repos.projects.update(id, { characterRoster: updatedRoster });

    logger.info('[Projects v1] Character removed from project', { projectId: id, characterId });

    return successResponse({ success: true });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return validationError(error);
    }

    logger.error('[Projects v1] Error removing character', { projectId: id }, error instanceof Error ? error : undefined);
    return serverError('Failed to remove character');
  }
}

async function handleRemoveChat(req: NextRequest, context: AuthenticatedContext, { id }: { id: string }) {
  const { user, repos } = context;

  try {
    const project = await repos.projects.findById(id);
    if (!checkOwnership(project, user.id)) {
      return notFound('Project');
    }

    const body = await req.json();
    const { chatId } = removeChatSchema.parse(body);


    // Remove projectId from chat
    await repos.chats.update(chatId, { projectId: null });

    logger.info('[Projects v1] Chat removed from project', { projectId: id, chatId });

    return successResponse({ success: true });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return validationError(error);
    }

    logger.error('[Projects v1] Error removing chat', { projectId: id }, error instanceof Error ? error : undefined);
    return serverError('Failed to remove chat');
  }
}

async function handleRemoveFile(req: NextRequest, context: AuthenticatedContext, { id }: { id: string }) {
  const { user, repos } = context;

  try {
    const project = await repos.projects.findById(id);
    if (!checkOwnership(project, user.id)) {
      return notFound('Project');
    }

    const body = await req.json();
    const { fileId } = removeFileSchema.parse(body);


    // Remove projectId from file
    await repos.files.update(fileId, { projectId: null });

    logger.info('[Projects v1] File removed from project', { projectId: id, fileId });

    return successResponse({ success: true });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return validationError(error);
    }

    logger.error('[Projects v1] Error removing file', { projectId: id }, error instanceof Error ? error : undefined);
    return serverError('Failed to remove file');
  }
}

async function handleDeleteProject(req: NextRequest, context: AuthenticatedContext, { id }: { id: string }) {
  const { user, repos } = context;

  try {
    const existingProject = await repos.projects.findById(id);

    if (!checkOwnership(existingProject, user.id)) {
      return notFound('Project');
    }


    // Remove projectId from associated chats
    const allChats = await repos.chats.findAll();
    const projectChats = allChats.filter(c => c.projectId === id);
    for (const chat of projectChats) {
      await repos.chats.update(chat.id, { projectId: null });
    }

    // Remove projectId from associated files
    const allFiles = await repos.files.findAll();
    const projectFiles = allFiles.filter(f => f.projectId === id);
    for (const file of projectFiles) {
      await repos.files.update(file.id, { projectId: null });
    }

    // Delete the project
    await repos.projects.delete(id);

    logger.info('[Projects v1] Project deleted', { projectId: id, userId: user.id });

    return successResponse({ success: true });
  } catch (error) {
    logger.error('[Projects v1] Error deleting project', { projectId: id }, error instanceof Error ? error : undefined);
    return serverError('Failed to delete project');
  }
}

async function handleClearMountPoint(req: NextRequest, context: AuthenticatedContext, { id }: { id: string }) {
  const { user, repos } = context;

  try {
    const project = await repos.projects.findById(id);
    if (!checkOwnership(project, user.id)) {
      return notFound('Project');
    }


    // Clear mount point (will use system default)
    await repos.projects.setMountPoint(id, null);

    logger.info('[Projects v1] Mount point cleared for project', { projectId: id });

    return successResponse({ success: true });
  } catch (error) {
    logger.error('[Projects v1] Error clearing mount point', { projectId: id }, error instanceof Error ? error : undefined);
    return serverError('Failed to clear mount point');
  }
}

async function handleResetState(req: NextRequest, context: AuthenticatedContext, { id }: { id: string }) {
  const { user, repos } = context;

  try {
    const project = await repos.projects.findById(id);
    if (!checkOwnership(project, user.id)) {
      return notFound('Project');
    }

    const previousState = (project.state || {}) as Record<string, unknown>;

    // Reset to empty object
    await repos.projects.update(id, {
      state: {},
    });

    logger.info('[Projects v1] State reset', {
      projectId: id,
      userId: user.id,
    });

    return successResponse({
      success: true,
      previousState,
    });
  } catch (error) {
    logger.error('[Projects v1] Error resetting state', { projectId: id }, error instanceof Error ? error : undefined);
    return serverError('Failed to reset state');
  }
}

export const DELETE = createAuthenticatedParamsHandler<{ id: string }>(async (req, context, { id }) => {
  const action = getActionParam(req);

  switch (action) {
    case 'remove-character':
      return handleRemoveCharacter(req, context, { id });
    case 'remove-chat':
      return handleRemoveChat(req, context, { id });
    case 'remove-file':
      return handleRemoveFile(req, context, { id });
    case 'clear-mount-point':
      return handleClearMountPoint(req, context, { id });
    case 'reset-state':
      return handleResetState(req, context, { id });
    default:
      return handleDeleteProject(req, context, { id });
  }
});

// ============================================================================
// POST Handlers
// ============================================================================

async function handleAddCharacter(req: NextRequest, context: AuthenticatedContext, { id }: { id: string }) {
  const { user, repos } = context;

  try {
    const project = await repos.projects.findById(id);
    if (!checkOwnership(project, user.id)) {
      return notFound('Project');
    }

    const body = await req.json();
    const { characterId } = addCharacterSchema.parse(body);


    // Check character exists and is owned by user
    const character = await repos.characters.findById(characterId);
    if (!character || character.userId !== user.id) {
      return notFound('Character');
    }

    // Add to roster if not already there
    if (!project.characterRoster.includes(characterId)) {
      const updatedRoster = [...project.characterRoster, characterId];
      await repos.projects.update(id, { characterRoster: updatedRoster });
    }

    logger.info('[Projects v1] Character added to project', { projectId: id, characterId });

    return successResponse({ success: true });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return validationError(error);
    }

    logger.error('[Projects v1] Error adding character', { projectId: id }, error instanceof Error ? error : undefined);
    return serverError('Failed to add character');
  }
}

async function handleAddChat(req: NextRequest, context: AuthenticatedContext, { id }: { id: string }) {
  const { user, repos } = context;

  try {
    const project = await repos.projects.findById(id);
    if (!checkOwnership(project, user.id)) {
      return notFound('Project');
    }

    const body = await req.json();
    const { chatId } = addChatSchema.parse(body);


    // Check chat exists and is owned by user
    const chat = await repos.chats.findById(chatId);
    if (!chat || chat.userId !== user.id) {
      return notFound('Chat');
    }

    // Associate chat with project
    await repos.chats.update(chatId, { projectId: id });

    logger.info('[Projects v1] Chat added to project', { projectId: id, chatId });

    return successResponse({ success: true });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return validationError(error);
    }

    logger.error('[Projects v1] Error adding chat', { projectId: id }, error instanceof Error ? error : undefined);
    return serverError('Failed to add chat');
  }
}

async function handleAddFile(req: NextRequest, context: AuthenticatedContext, { id }: { id: string }) {
  const { user, repos } = context;

  try {
    const project = await repos.projects.findById(id);
    if (!checkOwnership(project, user.id)) {
      return notFound('Project');
    }

    const body = await req.json();
    const { fileId } = addFileSchema.parse(body);


    // Check file exists and is owned by user
    const file = await repos.files.findById(fileId);
    if (!file || file.userId !== user.id) {
      return notFound('File');
    }

    // Associate file with project
    await repos.files.update(fileId, { projectId: id });

    logger.info('[Projects v1] File added to project', { projectId: id, fileId });

    return successResponse({ success: true });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return validationError(error);
    }

    logger.error('[Projects v1] Error adding file', { projectId: id }, error instanceof Error ? error : undefined);
    return serverError('Failed to add file');
  }
}

async function handleUpdateToolSettings(req: NextRequest, context: AuthenticatedContext, { id }: { id: string }) {
  const { user, repos } = context;

  try {
    const project = await repos.projects.findById(id);
    if (!checkOwnership(project, user.id)) {
      return notFound('Project');
    }

    const body = await req.json();
    const { defaultDisabledTools, defaultDisabledToolGroups } = updateToolSettingsSchema.parse(body);

    // Update project with new default tool settings
    await repos.projects.update(id, {
      defaultDisabledTools,
      defaultDisabledToolGroups,
    });

    logger.info('[Projects v1] Default tool settings updated', {
      projectId: id,
      disabledToolsCount: defaultDisabledTools.length,
      disabledGroupsCount: defaultDisabledToolGroups.length,
    });

    return successResponse({
      success: true,
      defaultDisabledTools,
      defaultDisabledToolGroups,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return validationError(error);
    }

    logger.error('[Projects v1] Error updating tool settings', { projectId: id }, error instanceof Error ? error : undefined);
    return serverError('Failed to update tool settings');
  }
}

export const POST = createAuthenticatedParamsHandler<{ id: string }>(async (req, context, { id }) => {
  const action = getActionParam(req);

  switch (action) {
    case 'add-character':
      return handleAddCharacter(req, context, { id });
    case 'add-chat':
      return handleAddChat(req, context, { id });
    case 'add-file':
      return handleAddFile(req, context, { id });
    case 'update-tool-settings':
      return handleUpdateToolSettings(req, context, { id });
    default:
      return badRequest('Unknown action or missing action parameter');
  }
});
