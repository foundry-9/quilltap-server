/**
 * Prompt Templates API
 *
 * GET /api/prompt-templates - List all templates (built-in + user's)
 * POST /api/prompt-templates - Create a new user template
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createAuthenticatedHandler } from '@/lib/api/middleware';
import { logger } from '@/lib/logger';
import { serverError, badRequest, validationError } from '@/lib/api/responses';

const createTemplateSchema = z.object({
  name: z.string().min(1).max(100),
  content: z.string().min(1),
  description: z.string().max(500).optional(),
  category: z.string().optional(),
  modelHint: z.string().optional(),
});

export const GET = createAuthenticatedHandler(async (req, { user, repos }) => {
  try {
    logger.debug('Fetching prompt templates for user', { userId: user.id });

    const templates = await repos.promptTemplates.findAllForUser(user.id);

    logger.debug('Retrieved prompt templates', { count: templates.length, userId: user.id });
    return NextResponse.json(templates);
  } catch (error) {
    logger.error('Error fetching prompt templates', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    return serverError('Failed to fetch prompt templates');
  }
});

export const POST = createAuthenticatedHandler(async (req, { user, repos }) => {
  try {
    const body = await req.json();
    const validated = createTemplateSchema.parse(body);

    logger.debug('Creating prompt template', {
      userId: user.id,
      name: validated.name,
      category: validated.category,
    });

    const template = await repos.promptTemplates.create({
      userId: user.id,
      name: validated.name,
      content: validated.content,
      description: validated.description || null,
      isBuiltIn: false,
      category: validated.category || null,
      modelHint: validated.modelHint || null,
      tags: [],
    });

    logger.info('Prompt template created', {
      templateId: template.id,
      userId: user.id,
      name: validated.name,
    });

    return NextResponse.json(template, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      logger.warn('Invalid prompt template data', { errors: error.errors });
      return validationError(error);
    }
    logger.error('Error creating prompt template', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    return serverError('Failed to create prompt template');
  }
});
