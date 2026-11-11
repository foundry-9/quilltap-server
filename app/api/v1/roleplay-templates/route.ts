/**
 * Roleplay Template Management Routes v1
 *
 * GET    /api/v1/roleplay-templates   - List all roleplay templates for current user (built-in + user's)
 * POST   /api/v1/roleplay-templates   - Create a new roleplay template
 *
 * Roleplay templates provide formatting instructions that are prepended to character system prompts.
 */

import { createContextHandler } from '@/lib/api/middleware';
import { successResponse, errorResponse } from '@/lib/api/responses';
import { logger } from '@/lib/logger';
import { generateTemplateRenderingPatterns } from '@/lib/chat/annotations';
import { RoleplayTemplateCreateSchema } from '@/lib/roleplay-templates/template-input';

/**
 * GET /api/v1/roleplay-templates
 * List all roleplay templates available to the authenticated user
 * Returns both built-in templates and user-created templates
 */
export const GET = createContextHandler(async (req, { user, repos }) => {
  try {// Get all templates available to user (built-in + user's own)
    const templates = await repos.roleplayTemplates.findAllForUser(user.id);// Sort: built-in first, then by name
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
export const POST = createContextHandler(async (req, { user, repos }) => {
  // A malformed body is the middleware's 400 (rethrown below).
  const input = RoleplayTemplateCreateSchema.parse(await req.json());
  try {
    const { name, narrationDelimiters } = input;

    // Check for duplicate name among user's own templates
    const existingTemplate = await repos.roleplayTemplates.findByName(user.id, name);
    if (existingTemplate) {
      return errorResponse('A roleplay template with this name already exists', 409);
    }

    const unmarkedStyle = input.unmarkedStyle ?? null;
    const markdownAsterisks = input.markdownAsterisks ?? true;
    const templateDelimiters = input.delimiters ?? [];

    // Auto-generate rendering patterns from delimiters if not explicitly provided
    const renderingPatterns =
      input.renderingPatterns && input.renderingPatterns.length > 0
        ? input.renderingPatterns
        : generateTemplateRenderingPatterns({
            delimiters: templateDelimiters,
            narrationDelimiters,
            unmarkedStyle,
            markdownAsterisks,
          });
    logger.debug('Roleplay template patterns resolved for create', {
      delimiterCount: templateDelimiters.length,
      patternCount: renderingPatterns.length,
      unmarkedNarration: narrationDelimiters === null,
      markdownAsterisks,
    });

    // Create template
    const template = await repos.roleplayTemplates.create({
      userId: user.id,
      name,
      description: input.description ?? null,
      systemPrompt: input.systemPrompt,
      isBuiltIn: false,
      tags: [],
      delimiters: templateDelimiters,
      renderingPatterns,
      dialogueDetection: input.dialogueDetection ?? null,
      narrationDelimiters,
      unmarkedStyle,
      markdownAsterisks,
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