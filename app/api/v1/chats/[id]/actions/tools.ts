/**
 * Chats API v1 - Tool Actions
 *
 * Handles add-tool-result action
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { logger } from '@/lib/logger';
import { validationError, serverError } from '@/lib/api/responses';
import { toolResultSchema } from '../schemas';
import type { AuthenticatedContext } from '@/lib/api/middleware';

/**
 * Add a tool result message to the chat
 */
export async function handleAddToolResult(
  req: NextRequest,
  chatId: string,
  { repos }: AuthenticatedContext
): Promise<NextResponse> {
  try {
    const body = await req.json();
    const validated = toolResultSchema.parse(body);

    logger.debug('[Chats v1] Adding tool result', { chatId, tool: validated.tool });

    // Create a TOOL message event
    const toolResultMessage = await repos.chats.addMessage(chatId, {
      type: 'message',
      id: randomUUID(),
      role: 'TOOL',
      content: JSON.stringify({
        tool: validated.tool,
        initiatedBy: validated.initiatedBy,
        prompt: validated.prompt,
        result: validated.result,
        images: validated.images,
        success: validated.initiatedBy === 'user' ? true : validated.result?.success ?? false,
      }),
      createdAt: new Date().toISOString(),
      attachments: [],
    });

    logger.info('[Chats v1] Tool result added', { chatId, tool: validated.tool });

    return NextResponse.json({
      success: true,
      message: toolResultMessage,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return validationError(error);
    }
    logger.error('[Chats v1] Error adding tool result', { chatId }, error instanceof Error ? error : undefined);
    return serverError('Failed to add tool result');
  }
}
