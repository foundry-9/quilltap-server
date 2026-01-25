/**
 * Projects API v1 - Collection Endpoint
 *
 * GET /api/v1/projects - List all projects
 * POST /api/v1/projects - Create a new project
 */

import { NextRequest, NextResponse } from 'next/server';
import { createAuthenticatedHandler } from '@/lib/api/middleware';
import { z } from 'zod';
import { logger } from '@/lib/logger';
import { created, notFound, validationError, serverError, badRequest } from '@/lib/api/responses';

// ============================================================================
// Schemas
// ============================================================================

const createProjectSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  description: z.string().max(2000).optional(),
  instructions: z.string().max(10000).optional(),
  allowAnyCharacter: z.boolean().optional().prefault(false),
  characterRoster: z.array(z.uuid()).optional().prefault([]),
  color: z.string().regex(/^#(?:[0-9a-fA-F]{3}){1,2}$/).optional(),
  icon: z.string().max(50).optional(),
});

// ============================================================================
// GET Handler
// ============================================================================

export const GET = createAuthenticatedHandler(async (req: NextRequest, { user, repos }) => {
  try {

    let projects = await repos.projects.findAll();

    // Sort by createdAt descending
    projects.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    // Enrich with counts
    const enrichedProjects = await Promise.all(
      projects.map(async (project) => {
        // Get chats in this project
        const allChats = await repos.chats.findAll();
        const projectChats = allChats.filter(c => c.projectId === project.id);

        // Get files in this project
        const allFiles = await repos.files.findAll();
        const projectFiles = allFiles.filter(f => f.projectId === project.id);

        return {
          ...project,
          _count: {
            chats: projectChats.length,
            files: projectFiles.length,
            characters: project.characterRoster.length,
          },
        };
      })
    );


    return NextResponse.json({ projects: enrichedProjects });
  } catch (error) {
    logger.error('[Projects v1] Error fetching projects', {}, error instanceof Error ? error : undefined);
    return serverError('Failed to fetch projects');
  }
});

// ============================================================================
// POST Handler
// ============================================================================

export const POST = createAuthenticatedHandler(async (req: NextRequest, { user, repos }) => {
  try {
    const body = await req.json();
    const validatedData = createProjectSchema.parse(body);


    const project = await repos.projects.create({
      userId: user.id,
      name: validatedData.name,
      description: validatedData.description || null,
      instructions: validatedData.instructions || null,
      allowAnyCharacter: validatedData.allowAnyCharacter,
      characterRoster: validatedData.characterRoster,
      color: validatedData.color || null,
      icon: validatedData.icon || null,
    });

    logger.info('[Projects v1] Project created', {
      projectId: project.id,
      name: project.name,
      userId: user.id,
    });

    return created({ project });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return validationError(error);
    }

    logger.error('[Projects v1] Error creating project', {}, error instanceof Error ? error : undefined);
    return serverError('Failed to create project');
  }
});
