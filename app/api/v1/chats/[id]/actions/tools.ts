/**
 * Chats API v1 - Tool Actions
 *
 * Handles add-tool-result and update-tool-settings actions
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { logger } from '@/lib/logger';
import { validationError, serverError, successResponse } from '@/lib/api/responses';
import { toolResultSchema } from '../schemas';
import type { AuthenticatedContext } from '@/lib/api/middleware';

/**
 * Schema for updating tool settings
 */
const updateToolSettingsSchema = z.object({
  disabledTools: z.array(z.string()).default([]),
  disabledToolGroups: z.array(z.string()).default([]),
});

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

/**
 * Update tool settings for a chat
 */
export async function handleUpdateToolSettings(
  req: NextRequest,
  chatId: string,
  { repos }: AuthenticatedContext
): Promise<NextResponse> {
  try {
    const body = await req.json();
    const validated = updateToolSettingsSchema.parse(body);

    // Update the chat with new tool settings
    // Set forceToolsOnNextMessage to true so tools are re-sent on next message
    await repos.chats.update(chatId, {
      disabledTools: validated.disabledTools,
      disabledToolGroups: validated.disabledToolGroups,
      forceToolsOnNextMessage: true,
    });

    logger.info('[Chats v1] Tool settings updated', {
      chatId,
      disabledToolsCount: validated.disabledTools.length,
      disabledTools: validated.disabledTools,
      disabledGroupsCount: validated.disabledToolGroups.length,
      disabledToolGroups: validated.disabledToolGroups,
    });

    return successResponse({
      disabledTools: validated.disabledTools,
      disabledToolGroups: validated.disabledToolGroups,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return validationError(error);
    }
    logger.error('[Chats v1] Error updating tool settings', { chatId }, error instanceof Error ? error : undefined);
    return serverError('Failed to update tool settings');
  }
}
