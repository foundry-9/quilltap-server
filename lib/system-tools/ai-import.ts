/**
 * System Tools — AI character import from source material, streamed as SSE.
 *
 * Served by `app/api/v1/system/tools/route.ts`:
 *   POST ?action=ai-import-stream
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import type { RequestContext } from '@/lib/api/middleware';
import { serverError } from '@/lib/api/responses';
import { logger } from '@/lib/logger';
import { runAIImportStreaming } from '@/lib/services/ai-import.service';
import type {
  AIImportRequest,
  AIImportProgressEvent,
  AIImportStepName,
  AIImportStepResults,
} from '@/lib/services/ai-import.service';

/** Every `AIImportStepName`, as an enum-like object (the mapped type keeps it exhaustive). */
const AI_IMPORT_STEP_NAMES: { [K in AIImportStepName]: K } = {
  analyzing: 'analyzing',
  character_basics: 'character_basics',
  first_message: 'first_message',
  system_prompts: 'system_prompts',
  physical_descriptions: 'physical_descriptions',
  wardrobe_items: 'wardrobe_items',
  pronouns: 'pronouns',
  memories: 'memories',
  chats: 'chats',
  assembly: 'assembly',
  validation: 'validation',
  repair: 'repair',
};

/**
 * Earlier step results handed back for a partial regeneration. They are the
 * server's own output round-tripped through the client, so only the shape of
 * the container is checked here; each step's content is re-validated by the
 * pipeline's own validation step.
 */
const existingResultSchema = z.custom<Partial<AIImportStepResults>>(
  (value) => typeof value === 'object' && value !== null && !Array.isArray(value),
  { error: 'existingResult must be an object' }
);

/** POST ?action=ai-import-stream body. */
export const aiImportBodySchema = z
  .object({
    profileId: z
      .string({ error: 'Missing required field: profileId' })
      .min(1, 'Missing required field: profileId'),
    sourceFileIds: z.array(z.string()).nullish(),
    sourceText: z.string().nullish(),
    includeMemories: z.boolean().nullish(),
    includeChats: z.boolean().nullish(),
    existingResult: existingResultSchema.nullish(),
    regenerateSteps: z.array(z.enum(AI_IMPORT_STEP_NAMES)).nullish(),
  })
  .refine(
    (body) => (body.sourceFileIds?.length ?? 0) > 0 || !!body.sourceText?.trim(),
    { error: 'Must provide at least one source file or source text' }
  );

export async function handleAIImportStream(req: NextRequest, context: RequestContext) {
  const { user, repos } = context;

  try {
    const body = aiImportBodySchema.parse(await req.json());

    const request: AIImportRequest = {
      profileId: body.profileId,
      sourceFileIds: body.sourceFileIds || [],
      sourceText: body.sourceText || '',
      includeMemories: body.includeMemories ?? true,
      includeChats: body.includeChats ?? false,
      existingResult: body.existingResult || undefined,
      regenerateSteps: body.regenerateSteps || undefined,
    };

    logger.info('[System Tools v1] AI Import stream starting', {
      userId: user.id,
      profileId: request.profileId,
      sourceFileCount: request.sourceFileIds.length,
      hasSourceText: !!request.sourceText.trim(),
      includeMemories: request.includeMemories,
      includeChats: request.includeChats,
    });

    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      async start(controller) {
        const enqueue = (event: AIImportProgressEvent) => {
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
          } catch {
            // Stream may be closed
          }
        };

        await runAIImportStreaming(request, user.id, repos, enqueue);

        try {
          controller.close();
        } catch {
          // Stream may already be closed
        }
      },
    });

    return new NextResponse(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) throw error;
    const errorMessage = error instanceof Error ? error.message : 'AI import failed';
    logger.error('[System Tools v1] AI Import stream failed', {
      userId: user.id,
      error: errorMessage,
    });
    return serverError(errorMessage);
  }
}
