/**
 * Individual Prompt Template API
 *
 * GET /api/prompt-templates/[id] - Get a specific template
 * PUT /api/prompt-templates/[id] - Update a user template (built-in templates cannot be updated)
 * DELETE /api/prompt-templates/[id] - Delete a user template (built-in templates cannot be deleted)
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createAuthenticatedParamsHandler } from '@/lib/api/middleware';
import { logger } from '@/lib/logger';
import { notFound, forbidden, serverError, validationError } from '@/lib/api/responses';

const updateTemplateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  content: z.string().min(1).optional(),
  description: z.string().max(500).optional(),
  category: z.string().optional(),
  modelHint: z.string().optional(),
});

export const GET = createAuthenticatedParamsHandler<{ id: string }>(
  async (req, { user, repos }, { id }) => {
    try {
      logger.debug('Fetching prompt template', { templateId: id, userId: user.id });

      const template = await repos.promptTemplates.findById(id);

      if (!template) {
        logger.warn('Prompt template not found', { templateId: id, userId: user.id });
        return notFound('Template');
      }

      // Users can access built-in templates or their own templates
      if (!template.isBuiltIn && template.userId !== user.id) {
        logger.warn('Forbidden access to prompt template', {
          templateId: id,
          userId: user.id,
          ownerId: template.userId,
        });
        return forbidden();
      }

      logger.debug('Retrieved prompt template', { templateId: id, userId: user.id });
      return NextResponse.json(template);
    } catch (error) {
      logger.error('Error fetching prompt template', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      return serverError('Failed to fetch prompt template');
    }
  }
);

export const PUT = createAuthenticatedParamsHandler<{ id: string }>(
  async (req, { user, repos }, { id }) => {
    try {
      const body = await req.json();
      const validated = updateTemplateSchema.parse(body);

      logger.debug('Updating prompt template', { templateId: id, userId: user.id });

      const existingTemplate = await repos.promptTemplates.findById(id);

      if (!existingTemplate) {
        logger.warn('Prompt template not found for update', { templateId: id, userId: user.id });
        return notFound('Template');
      }

      // Cannot update built-in templates
      if (existingTemplate.isBuiltIn) {
        logger.warn('Attempted to update built-in template', {
          templateId: id,
          userId: user.id,
        });
        return forbidden('Cannot update built-in templates');
      }

      // Can only update own templates
      if (existingTemplate.userId !== user.id) {
        logger.warn('Forbidden update attempt on prompt template', {
          templateId: id,
          userId: user.id,
          ownerId: existingTemplate.userId,
        });
        return forbidden();
      }

      const updates: any = {};
      if (validated.name !== undefined) updates.name = validated.name;
      if (validated.content !== undefined) updates.content = validated.content;
      if (validated.description !== undefined) updates.description = validated.description || null;
      if (validated.category !== undefined) updates.category = validated.category || null;
      if (validated.modelHint !== undefined) updates.modelHint = validated.modelHint || null;
      updates.updatedAt = new Date();

      const template = await repos.promptTemplates.update(id, updates);

      if (!template) {
        logger.error('Failed to update prompt template', { templateId: id, userId: user.id });
        return serverError('Failed to update template');
      }

      logger.info('Prompt template updated', {
        templateId: id,
        userId: user.id,
        updatedFields: Object.keys(updates),
      });

      return NextResponse.json(template);
    } catch (error) {
      if (error instanceof z.ZodError) {
        logger.warn('Invalid prompt template update data', { errors: error.errors });
        return validationError(error);
      }
      logger.error('Error updating prompt template', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      return serverError('Failed to update prompt template');
    }
  }
);

export const DELETE = createAuthenticatedParamsHandler<{ id: string }>(
  async (req, { user, repos }, { id }) => {
    try {
      logger.debug('Deleting prompt template', { templateId: id, userId: user.id });

      const existingTemplate = await repos.promptTemplates.findById(id);

      if (!existingTemplate) {
        logger.warn('Prompt template not found for deletion', { templateId: id, userId: user.id });
        return notFound('Template');
      }

      // Cannot delete built-in templates
      if (existingTemplate.isBuiltIn) {
        logger.warn('Attempted to delete built-in template', {
          templateId: id,
          userId: user.id,
        });
        return forbidden('Cannot delete built-in templates');
      }

      // Can only delete own templates
      if (existingTemplate.userId !== user.id) {
        logger.warn('Forbidden delete attempt on prompt template', {
          templateId: id,
          userId: user.id,
          ownerId: existingTemplate.userId,
        });
        return forbidden();
      }

      const deleted = await repos.promptTemplates.delete(id);

      if (!deleted) {
        logger.error('Failed to delete prompt template', { templateId: id, userId: user.id });
        return serverError('Failed to delete template');
      }

      logger.info('Prompt template deleted', { templateId: id, userId: user.id });

      return NextResponse.json({ success: true });
    } catch (error) {
      logger.error('Error deleting prompt template', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      return serverError('Failed to delete prompt template');
    }
  }
);
