/**
 * Prompt Templates API v1 - Individual Template Endpoint
 *
 * GET /api/v1/prompt-templates/[id] - Get a specific template
 * PUT /api/v1/prompt-templates/[id] - Update a user template (built-in templates cannot be updated)
 * DELETE /api/v1/prompt-templates/[id] - Delete a user template (built-in templates cannot be deleted)
 */

import { NextRequest, NextResponse } from 'next/server';
import { createAuthenticatedParamsHandler, checkOwnership } from '@/lib/api/middleware';
import { z } from 'zod';
import { logger } from '@/lib/logger';
import { notFound, forbidden, serverError, validationError } from '@/lib/api/responses';

// ============================================================================
// Schemas
// ============================================================================

const updateTemplateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  content: z.string().min(1).optional(),
  description: z.string().max(500).optional(),
  category: z.string().optional(),
  modelHint: z.string().optional(),
});

type UpdateTemplateInput = z.infer<typeof updateTemplateSchema>;

// ============================================================================
// GET Handler
// ============================================================================

export const GET = createAuthenticatedParamsHandler<{ id: string }>(
  async (req: NextRequest, { user, repos }, { id }) => {
    try {

      const template = await repos.promptTemplates.findById(id);

      if (!template) {
        logger.warn('[Prompt Templates v1] Template not found', {
          templateId: id,
          userId: user.id,
        });
        return notFound('Template');
      }

      // Users can access built-in templates or their own templates
      if (!template.isBuiltIn && template.userId !== user.id) {
        logger.warn('[Prompt Templates v1] Forbidden access to template', {
          templateId: id,
          userId: user.id,
          ownerId: template.userId,
        });
        return forbidden();
      }return NextResponse.json({ template });
    } catch (error) {
      logger.error(
        '[Prompt Templates v1] Error fetching template',
        { templateId: id, userId: user.id },
        error instanceof Error ? error : undefined
      );
      return serverError('Failed to fetch prompt template');
    }
  }
);

// ============================================================================
// PUT Handler
// ============================================================================

export const PUT = createAuthenticatedParamsHandler<{ id: string }>(
  async (req: NextRequest, { user, repos }, { id }) => {
    try {

      const body = await req.json();
      const validatedData = updateTemplateSchema.parse(body);

      const existingTemplate = await repos.promptTemplates.findById(id);

      if (!existingTemplate) {
        logger.warn('[Prompt Templates v1] Template not found for update', {
          templateId: id,
          userId: user.id,
        });
        return notFound('Template');
      }

      // Cannot update built-in templates
      if (existingTemplate.isBuiltIn) {
        logger.warn('[Prompt Templates v1] Attempted to update built-in template', {
          templateId: id,
          userId: user.id,
        });
        return forbidden('Cannot update built-in templates');
      }

      // Can only update own templates
      if (existingTemplate.userId !== user.id) {
        logger.warn('[Prompt Templates v1] Forbidden update attempt on template', {
          templateId: id,
          userId: user.id,
          ownerId: existingTemplate.userId,
        });
        return forbidden();
      }

      const updates: any = {};
      if (validatedData.name !== undefined) updates.name = validatedData.name;
      if (validatedData.content !== undefined) updates.content = validatedData.content;
      if (validatedData.description !== undefined)
        updates.description = validatedData.description || null;
      if (validatedData.category !== undefined) updates.category = validatedData.category || null;
      if (validatedData.modelHint !== undefined)
        updates.modelHint = validatedData.modelHint || null;
      updates.updatedAt = new Date();

      const template = await repos.promptTemplates.update(id, updates);

      if (!template) {
        logger.error('[Prompt Templates v1] Failed to update template', {
          templateId: id,
          userId: user.id,
        });
        return serverError('Failed to update template');
      }

      logger.info('[Prompt Templates v1] Template updated', {
        templateId: id,
        userId: user.id,
        updatedFields: Object.keys(updates),
      });

      return NextResponse.json({ template });
    } catch (error) {
      if (error instanceof z.ZodError) {return validationError(error);
      }

      logger.error(
        '[Prompt Templates v1] Error updating template',
        { templateId: id, userId: user.id },
        error instanceof Error ? error : undefined
      );
      return serverError('Failed to update prompt template');
    }
  }
);

// ============================================================================
// DELETE Handler
// ============================================================================

export const DELETE = createAuthenticatedParamsHandler<{ id: string }>(
  async (req: NextRequest, { user, repos }, { id }) => {
    try {

      const existingTemplate = await repos.promptTemplates.findById(id);

      if (!existingTemplate) {
        logger.warn('[Prompt Templates v1] Template not found for deletion', {
          templateId: id,
          userId: user.id,
        });
        return notFound('Template');
      }

      // Cannot delete built-in templates
      if (existingTemplate.isBuiltIn) {
        logger.warn('[Prompt Templates v1] Attempted to delete built-in template', {
          templateId: id,
          userId: user.id,
        });
        return forbidden('Cannot delete built-in templates');
      }

      // Can only delete own templates
      if (existingTemplate.userId !== user.id) {
        logger.warn('[Prompt Templates v1] Forbidden delete attempt on template', {
          templateId: id,
          userId: user.id,
          ownerId: existingTemplate.userId,
        });
        return forbidden();
      }

      const deleted = await repos.promptTemplates.delete(id);

      if (!deleted) {
        logger.error('[Prompt Templates v1] Failed to delete template', {
          templateId: id,
          userId: user.id,
        });
        return serverError('Failed to delete template');
      }

      logger.info('[Prompt Templates v1] Template deleted', { templateId: id, userId: user.id });

      return NextResponse.json({ success: true });
    } catch (error) {
      logger.error(
        '[Prompt Templates v1] Error deleting template',
        { templateId: id, userId: user.id },
        error instanceof Error ? error : undefined
      );
      return serverError('Failed to delete prompt template');
    }
  }
);
