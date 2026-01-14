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
 */

import { NextRequest, NextResponse } from 'next/server';
import { createAuthenticatedParamsHandler, checkOwnership, AuthenticatedContext, withActionDispatch } from '@/lib/api/middleware';
import { getFilePath } from '@/lib/api/middleware/file-path';
import { getActionParam } from '@/lib/api/middleware/actions';
import { z } from 'zod';
import { logger } from '@/lib/logger';
import { notFound, badRequest, validationError, serverError, successResponse } from '@/lib/api/responses';

// ============================================================================
// Schemas
// ============================================================================

const updateProjectSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(2000).nullable().optional(),
  instructions: z.string().max(10000).nullable().optional(),
  allowAnyCharacter: z.boolean().optional(),
  characterRoster: z.array(z.string().uuid()).optional(),
  color: z.string().regex(/^#(?:[0-9a-fA-F]{3}){1,2}$/).nullable().optional(),
  icon: z.string().max(50).nullable().optional(),
});

const addCharacterSchema = z.object({
  characterId: z.string().uuid(),
});

const removeCharacterSchema = z.object({
  characterId: z.string().uuid(),
});

const addChatSchema = z.object({
  chatId: z.string().uuid(),
});

const removeChatSchema = z.object({
  chatId: z.string().uuid(),
});

const addFileSchema = z.object({
  fileId: z.string().uuid(),
});

const removeFileSchema = z.object({
  fileId: z.string().uuid(),
});

// ============================================================================
// Helper: Check Project Ownership
// ============================================================================

async function checkProjectOwnership(
  repos: any,
  projectId: string,
  userId: string
): Promise<boolean> {
  const project = await repos.projects.findById(projectId);
  return checkOwnership(project, userId);
}

// ============================================================================
// GET Handlers
// ============================================================================

async function handleGetDefault(req: NextRequest, context: AuthenticatedContext, { id }: { id: string }) {
  const { user, repos } = context;

  try {
    logger.debug('[Projects v1] GET project', { projectId: id, userId: user.id });

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

        return {
          id: char.id,
          name: char.name,
          avatarUrl: char.avatarUrl,
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
    logger.debug('[Projects v1] LIST characters in project', { projectId: id });

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
    logger.debug('[Projects v1] LIST chats in project', { projectId: id });

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

    // Sort by updatedAt descending
    projectChats.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

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
              let defaultImage = null;
              if (char.defaultImageId) {
                const imageFile = await repos.files.findById(char.defaultImageId);
                if (imageFile) {
                  defaultImage = {
                    id: imageFile.id,
                    filepath: `/api/files/${imageFile.id}`,
                  };
                }
              }

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

        return {
          id: chat.id,
          title: chat.title,
          messageCount: chat.messageCount,
          participants: participants.filter(Boolean),
          tags: chatTags,
          updatedAt: chat.updatedAt,
          createdAt: chat.createdAt,
        };
      })
    );

    logger.debug('[Projects v1] Fetched project chats', {
      projectId: id,
      total,
      offset,
      limit,
      returned: enrichedChats.length,
    });

    return successResponse({
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
    logger.debug('[Projects v1] LIST files in project', { projectId: id });

    const project = await repos.projects.findById(id);
    if (!checkOwnership(project, user.id)) {
      return notFound('Project');
    }

    const allFiles = await repos.files.findAll();
    const files = allFiles
      .filter(f => f.projectId === id)
      .map(f => ({
        id: f.id,
        originalFilename: f.originalFilename,
        mimeType: f.mimeType,
        size: f.size,
        createdAt: f.createdAt,
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

export const GET = createAuthenticatedParamsHandler<{ id: string }>(async (req, context, { id }) => {
  const action = getActionParam(req);

  switch (action) {
    case 'list-characters':
      return handleListCharacters(req, context, { id });
    case 'list-chats':
      return handleListChats(req, context, { id });
    case 'list-files':
      return handleListFiles(req, context, { id });
    default:
      return handleGetDefault(req, context, { id });
  }
});

// ============================================================================
// PUT Handler
// ============================================================================

export const PUT = createAuthenticatedParamsHandler<{ id: string }>(async (req, { user, repos }, { id }) => {
  try {
    logger.debug('[Projects v1] PUT project', { projectId: id });

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

    logger.debug('[Projects v1] REMOVE character from project', { projectId: id, characterId });

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

    logger.debug('[Projects v1] REMOVE chat from project', { projectId: id, chatId });

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

    logger.debug('[Projects v1] REMOVE file from project', { projectId: id, fileId });

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

    logger.debug('[Projects v1] DELETE project', { projectId: id });

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

export const DELETE = createAuthenticatedParamsHandler<{ id: string }>(async (req, context, { id }) => {
  const action = getActionParam(req);

  switch (action) {
    case 'remove-character':
      return handleRemoveCharacter(req, context, { id });
    case 'remove-chat':
      return handleRemoveChat(req, context, { id });
    case 'remove-file':
      return handleRemoveFile(req, context, { id });
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

    logger.debug('[Projects v1] ADD character to project', { projectId: id, characterId });

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

    logger.debug('[Projects v1] ADD chat to project', { projectId: id, chatId });

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

    logger.debug('[Projects v1] ADD file to project', { projectId: id, fileId });

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

export const POST = createAuthenticatedParamsHandler<{ id: string }>(async (req, context, { id }) => {
  const action = getActionParam(req);

  switch (action) {
    case 'add-character':
      return handleAddCharacter(req, context, { id });
    case 'add-chat':
      return handleAddChat(req, context, { id });
    case 'add-file':
      return handleAddFile(req, context, { id });
    default:
      return badRequest('Unknown action or missing action parameter');
  }
});
