/**
 * Roleplay Template Management Routes v1 - Individual Template Endpoint
 *
 * GET    /api/v1/roleplay-templates/[id]   - Get a specific roleplay template
 * PUT    /api/v1/roleplay-templates/[id]   - Update a roleplay template
 * DELETE /api/v1/roleplay-templates/[id]   - Delete a roleplay template
 *
 * Roleplay templates provide formatting instructions that are prepended to character system prompts.
 */

import { createAuthenticatedParamsHandler, checkOwnership } from '@/lib/api/middleware';
import { successResponse, errorResponse, notFound, forbidden } from '@/lib/api/responses';
import { logger } from '@/lib/logger';
import { z } from 'zod';

// ============================================================================
// Schemas
// ============================================================================

const updateRoleplayTemplateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional().nullable(),
  systemPrompt: z.string().min(1).optional(),
  tags: z.array(z.uuid()).optional(),
  annotationButtons: z.array(z.any()).optional(),
  renderingPatterns: z.array(z.any()).optional(),
  dialogueDetection: z.any().optional().nullable(),
});

// ============================================================================
// GET Handler
// ============================================================================

/**
 * GET /api/v1/roleplay-templates/[id]
 * Get a specific roleplay template by ID
 * Returns 404 if template not found or user doesn't own it (for user-created templates)
 */
export const GET = createAuthenticatedParamsHandler<{ id: string }>(
  async (req, { user, repos }, { id }) => {
    try {
      logger.debug('Fetching roleplay template', {
        endpoint: '/api/v1/roleplay-templates/[id]',
        method: 'GET',
        templateId: id,
        userId: user.id,
      });

      const template = await repos.roleplayTemplates.findById(id);

      if (!template) {
        logger.debug('Roleplay template not found', {
          templateId: id,
          userId: user.id,
        });
        return notFound('Roleplay template');
      }

      // Check ownership: user must own it OR it must be built-in
      if (template.userId && template.userId !== user.id) {
        logger.warn('Unauthorized access attempt to roleplay template', {
          templateId: id,
          requestingUserId: user.id,
          templateUserId: template.userId,
        });
        return notFound('Roleplay template');
      }

      logger.debug('Roleplay template retrieved successfully', {
        templateId: id,
        templateName: template.name,
        userId: user.id,
      });

      return successResponse(template);
    } catch (error) {
      logger.error(
        'Failed to fetch roleplay template',
        {
          endpoint: '/api/v1/roleplay-templates/[id]',
          method: 'GET',
          templateId: id,
        },
        error instanceof Error ? error : undefined
      );
      return errorResponse('Failed to fetch roleplay template', 500);
    }
  }
);

// ============================================================================
// PUT Handler
// ============================================================================

/**
 * PUT /api/v1/roleplay-templates/[id]
 * Update a roleplay template
 *
 * Body: {
 *   name?: string,
 *   description?: string | null,
 *   systemPrompt?: string,
 *   tags?: string[],
 *   annotationButtons?: any[],
 *   renderingPatterns?: any[],
 *   dialogueDetection?: any | null
 * }
 */
export const PUT = createAuthenticatedParamsHandler<{ id: string }>(
  async (req, { user, repos }, { id }) => {
    try {
      logger.debug('Updating roleplay template', {
        endpoint: '/api/v1/roleplay-templates/[id]',
        method: 'PUT',
        templateId: id,
        userId: user.id,
      });

      const existingTemplate = await repos.roleplayTemplates.findById(id);

      if (!existingTemplate) {
        logger.debug('Roleplay template not found for update', {
          templateId: id,
          userId: user.id,
        });
        return notFound('Roleplay template');
      }

      // Check ownership
      if (existingTemplate.userId !== user.id) {
        logger.warn('Unauthorized update attempt to roleplay template', {
          templateId: id,
          requestingUserId: user.id,
          templateUserId: existingTemplate.userId,
        });
        return notFound('Roleplay template');
      }

      // Prevent editing built-in templates
      if (existingTemplate.isBuiltIn) {
        logger.warn('Attempted to edit built-in roleplay template', {
          templateId: id,
          userId: user.id,
        });
        return forbidden('Cannot edit built-in roleplay templates');
      }

      const body = await req.json();
      const validatedData = updateRoleplayTemplateSchema.parse(body);

      // If name is being updated, check for duplicates
      if (validatedData.name && validatedData.name !== existingTemplate.name) {
        const existingByName = await repos.roleplayTemplates.findByName(user.id, validatedData.name);
        if (existingByName) {
          logger.warn('Duplicate roleplay template name', {
            templateId: id,
            userId: user.id,
            newName: validatedData.name,
          });
          return errorResponse('A roleplay template with this name already exists', 409);
        }
      }

      // Trim string values
      const updateData = {
        ...validatedData,
        name: validatedData.name?.trim(),
        description: validatedData.description?.trim(),
        systemPrompt: validatedData.systemPrompt?.trim(),
      };

      const updatedTemplate = await repos.roleplayTemplates.update(id, updateData);

      logger.info('Roleplay template updated successfully', {
        templateId: id,
        templateName: updatedTemplate?.name,
        userId: user.id,
      });

      return successResponse(updatedTemplate);
    } catch (error) {
      if (error instanceof z.ZodError) {
        logger.warn('Validation error updating roleplay template', {
          templateId: id,
          errors: error.issues,
        });
        return errorResponse('Invalid request body', 400);
      }

      logger.error(
        'Failed to update roleplay template',
        {
          endpoint: '/api/v1/roleplay-templates/[id]',
          method: 'PUT',
          templateId: id,
        },
        error instanceof Error ? error : undefined
      );
      return errorResponse('Failed to update roleplay template', 500);
    }
  }
);

// ============================================================================
// DELETE Handler
// ============================================================================

/**
 * DELETE /api/v1/roleplay-templates/[id]
 * Delete a roleplay template
 * Returns 404 if template not found or user doesn't own it
 * Returns 403 if trying to delete a built-in template
 */
export const DELETE = createAuthenticatedParamsHandler<{ id: string }>(
  async (req, { user, repos }, { id }) => {
    try {
      logger.debug('Deleting roleplay template', {
        endpoint: '/api/v1/roleplay-templates/[id]',
        method: 'DELETE',
        templateId: id,
        userId: user.id,
      });

      const existingTemplate = await repos.roleplayTemplates.findById(id);

      if (!existingTemplate) {
        logger.debug('Roleplay template not found for deletion', {
          templateId: id,
          userId: user.id,
        });
        return notFound('Roleplay template');
      }

      // Check ownership
      if (existingTemplate.userId !== user.id) {
        logger.warn('Unauthorized deletion attempt on roleplay template', {
          templateId: id,
          requestingUserId: user.id,
          templateUserId: existingTemplate.userId,
        });
        return notFound('Roleplay template');
      }

      // Prevent deleting built-in templates
      if (existingTemplate.isBuiltIn) {
        logger.warn('Attempted to delete built-in roleplay template', {
          templateId: id,
          userId: user.id,
        });
        return forbidden('Cannot delete built-in roleplay templates');
      }

      const deleted = await repos.roleplayTemplates.delete(id);

      if (!deleted) {
        logger.warn('Failed to delete roleplay template', {
          templateId: id,
          userId: user.id,
        });
        return errorResponse('Failed to delete roleplay template', 500);
      }

      logger.info('Roleplay template deleted successfully', {
        templateId: id,
        templateName: existingTemplate.name,
        userId: user.id,
      });

      return successResponse({
        success: true,
        deletedId: id,
      });
    } catch (error) {
      logger.error(
        'Failed to delete roleplay template',
        {
          endpoint: '/api/v1/roleplay-templates/[id]',
          method: 'DELETE',
          templateId: id,
        },
        error instanceof Error ? error : undefined
      );
      return errorResponse('Failed to delete roleplay template', 500);
    }
  }
);
