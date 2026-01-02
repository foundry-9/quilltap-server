/**
 * Image Generation API Route using Image Profiles
 * Supports placeholder expansion for character/persona descriptions
 *
 * POST /api/image-profiles/[id]/generate - Generate images with placeholder support
 */

import { NextResponse } from 'next/server';
import { createAuthenticatedParamsHandler } from '@/lib/api/middleware';
import { z } from 'zod';
import { executeImageGenerationTool } from '@/lib/tools/handlers/image-generation-handler';
import { logger } from '@/lib/logger';

const generateImageSchema = z.object({
  prompt: z.string().min(1).max(4000),
  chatId: z.string().uuid().optional(),
  count: z.number().int().min(1).max(10).optional().default(1),
  size: z.string().optional(),
  quality: z.enum(['standard', 'hd']).optional(),
  style: z.enum(['vivid', 'natural']).optional(),
  aspectRatio: z.string().optional(),
  negativePrompt: z.string().optional(),
});

/**
 * POST /api/image-profiles/[id]/generate
 * Generate images using an image profile with support for {{placeholder}} expansion
 *
 * Placeholders:
 * - {{CharacterName}} - Expands to character's physical description
 * - {{PersonaName}} - Expands to persona's physical description
 * - {{me}} or {{user}} - Expands to user's persona description (from chat context)
 *
 * Example prompts:
 * - "{{Mirel}} in a bathing suit on a beach"
 * - "{{Mirel}} and {{me}} having coffee together"
 * - "portrait of {{Elena}} wearing elegant evening dress"
 *
 * Body: {
 *   prompt: string (supports {{placeholder}} syntax)
 *   chatId?: string (optional, for {{me}} context)
 *   count?: number (1-10, default: 1)
 *   size?: string
 *   quality?: 'standard' | 'hd'
 *   style?: 'vivid' | 'natural'
 *   aspectRatio?: string
 *   negativePrompt?: string
 * }
 */
export const POST = createAuthenticatedParamsHandler<{ id: string }>(
  async (request, { user }, { id }) => {
    try {
      // Validate request body
      const body = await request.json();
      const validated = generateImageSchema.parse(body);

      // Execute image generation with prompt expansion support
      const result = await executeImageGenerationTool(
        {
          prompt: validated.prompt,
          count: validated.count,
          size: validated.size,
          quality: validated.quality,
          style: validated.style,
          aspectRatio: validated.aspectRatio,
          negativePrompt: validated.negativePrompt,
        },
        {
          userId: user.id,
          profileId: id,
          chatId: validated.chatId,
        }
      );

      if (!result.success) {
        return NextResponse.json(
          {
            error: result.error || 'Image generation failed',
            message: result.message,
          },
          { status: 400 }
        );
      }

      return NextResponse.json({
        success: true,
        data: result.images,
        expandedPrompt: result.expandedPrompt,
        metadata: {
          originalPrompt: validated.prompt,
          provider: result.provider,
          model: result.model,
          count: result.images?.length || 0,
        },
      });
    } catch (error) {
      logger.error('Error generating images:', error as Error);

      if (error instanceof z.ZodError) {
        return NextResponse.json(
          { error: 'Validation error', details: error.errors },
          { status: 400 }
        );
      }

      return NextResponse.json(
        {
          error: 'Failed to generate images',
          details: error instanceof Error ? error.message : String(error),
        },
        { status: 500 }
      );
    }
  }
);
