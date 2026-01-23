/**
 * Prompt Templates API v1 - Collection Endpoint
 *
 * GET /api/v1/prompt-templates - List all templates (built-in + user's)
 * POST /api/v1/prompt-templates - Create a new user template
 */

import { NextRequest, NextResponse } from 'next/server';
import { createAuthenticatedHandler } from '@/lib/api/middleware';
import { z } from 'zod';
import { logger } from '@/lib/logger';
import { badRequest, serverError, validationError } from '@/lib/api/responses';

// ============================================================================
// Schemas
// ============================================================================

const createTemplateSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  content: z.string().min(1, 'Content is required'),
  description: z.string().max(500).optional(),
  category: z.string().optional(),
  modelHint: z.string().optional(),
});

type CreateTemplateInput = z.infer<typeof createTemplateSchema>;

// ============================================================================
// GET Handler
// ============================================================================

export const GET = createAuthenticatedHandler(async (req: NextRequest, { user, repos }) => {
  try {
    logger.debug('[Prompt Templates v1] GET list', { userId: user.id });

    const templates = await repos.promptTemplates.findAllForUser(user.id);

    logger.debug('[Prompt Templates v1] Retrieved templates', {
      userId: user.id,
      count: templates.length,
    });

    return NextResponse.json({
      templates,
      count: templates.length,
    });
  } catch (error) {
    logger.error(
      '[Prompt Templates v1] Error listing templates',
      { userId: user.id },
      error instanceof Error ? error : undefined
    );
    return serverError('Failed to fetch prompt templates');
  }
});

// ============================================================================
// POST Handler
// ============================================================================

export const POST = createAuthenticatedHandler(async (req: NextRequest, { user, repos }) => {
  try {
    const body = await req.json();
    const validatedData = createTemplateSchema.parse(body);

    logger.debug('[Prompt Templates v1] POST create', {
      userId: user.id,
      name: validatedData.name,
    });

    const template = await repos.promptTemplates.create({
      userId: user.id,
      name: validatedData.name,
      content: validatedData.content,
      description: validatedData.description || null,
      isBuiltIn: false,
      category: validatedData.category || null,
      modelHint: validatedData.modelHint || null,
      tags: [],
    });

    logger.info('[Prompt Templates v1] Template created', {
      templateId: template.id,
      userId: user.id,
      name: validatedData.name,
    });

    return NextResponse.json({ template }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      logger.debug('[Prompt Templates v1] Validation error', { errors: error.errors });
      return validationError(error);
    }

    logger.error(
      '[Prompt Templates v1] Error creating template',
      { userId: user.id },
      error instanceof Error ? error : undefined
    );
    return serverError('Failed to create prompt template');
  }
});
