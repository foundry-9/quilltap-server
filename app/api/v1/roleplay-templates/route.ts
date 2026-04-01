/**
 * Roleplay Template Management Routes v1
 *
 * GET    /api/v1/roleplay-templates   - List all roleplay templates for current user (built-in + user's)
 * POST   /api/v1/roleplay-templates   - Create a new roleplay template
 *
 * Roleplay templates provide formatting instructions that are prepended to character system prompts.
 */

import { NextResponse } from 'next/server';
import { createAuthenticatedHandler } from '@/lib/api/middleware';
import { successResponse, errorResponse } from '@/lib/api/responses';
import { logger } from '@/lib/logger';

/**
 * GET /api/v1/roleplay-templates
 * List all roleplay templates available to the authenticated user
 * Returns both built-in templates and user-created templates
 */
export const GET = createAuthenticatedHandler(async (req, { user, repos }) => {
  try {
    logger.debug('Fetching roleplay templates', {
      endpoint: '/api/v1/roleplay-templates',
      method: 'GET',
    });

    // Get all templates available to user (built-in + user's own)
    const templates = await repos.roleplayTemplates.findAllForUser(user.id);

    logger.debug('Retrieved roleplay templates for user', {
      userId: user.id,
      count: templates.length,
    });

    // Sort: built-in first, then by name
    templates.sort((a, b) => {
      // Built-in templates first
      if (a.isBuiltIn !== b.isBuiltIn) {
        return a.isBuiltIn ? -1 : 1;
      }
      // Then alphabetically by name
      return a.name.localeCompare(b.name);
    });

    return successResponse(templates);
  } catch (error) {
    logger.error(
      'Failed to fetch roleplay templates',
      {
        endpoint: '/api/v1/roleplay-templates',
        method: 'GET',
      },
      error instanceof Error ? error : undefined
    );
    return errorResponse('Failed to fetch roleplay templates', 500);
  }
});

/**
 * POST /api/v1/roleplay-templates
 * Create a new roleplay template
 *
 * Body: {
 *   name: string,
 *   description?: string,
 *   systemPrompt: string
 * }
 */
export const POST = createAuthenticatedHandler(async (req, { user, repos }) => {
  try {
    logger.debug('Creating roleplay template', {
      endpoint: '/api/v1/roleplay-templates',
      method: 'POST',
    });

    const body = await req.json();
    const { name, description, systemPrompt } = body;

    // Validation
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return errorResponse('Name is required', 400);
    }

    if (name.trim().length > 100) {
      return errorResponse('Name must be 100 characters or less', 400);
    }

    if (!systemPrompt || typeof systemPrompt !== 'string' || systemPrompt.trim().length === 0) {
      return errorResponse('System prompt is required', 400);
    }

    if (description && typeof description === 'string' && description.length > 500) {
      return errorResponse('Description must be 500 characters or less', 400);
    }

    // Check for duplicate name among user's own templates
    const existingTemplate = await repos.roleplayTemplates.findByName(user.id, name.trim());
    if (existingTemplate) {
      return errorResponse('A roleplay template with this name already exists', 409);
    }

    // Create template
    const template = await repos.roleplayTemplates.create({
      userId: user.id,
      name: name.trim(),
      description: description?.trim() || null,
      systemPrompt: systemPrompt.trim(),
      isBuiltIn: false,
      tags: [],
      annotationButtons: [],
      renderingPatterns: [],
      dialogueDetection: null,
    });

    logger.info('Roleplay template created', {
      userId: user.id,
      templateId: template.id,
      templateName: template.name,
    });

    return successResponse(template, 201);
  } catch (error) {
    logger.error(
      'Failed to create roleplay template',
      {
        endpoint: '/api/v1/roleplay-templates',
        method: 'POST',
      },
      error instanceof Error ? error : undefined
    );
    return errorResponse('Failed to create roleplay template', 500);
  }
});