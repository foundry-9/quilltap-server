/**
 * Shell API v1 - Sudo Approval Endpoint
 *
 * POST /api/v1/shell/sudo-approval?action=complete
 * Handles user approval or denial of pending sudo commands.
 */

import { createAuthenticatedHandler } from '@/lib/api/middleware';
import { getActionParam } from '@/lib/api/middleware/actions';
import { logger } from '@/lib/logger';
import { z } from 'zod';
import { successResponse, badRequest, serverError, validationError } from '@/lib/api/responses';
import { executeSudoCommand, type ShellToolContext } from '@/lib/tools/shell';

// ============================================================================
// Schemas
// ============================================================================

const completeSudoSchema = z.object({
  chatId: z.uuid(),
  decision: z.enum(['approve', 'deny']),
  pendingSudoCommand: z.object({
    command: z.string().min(1),
    parameters: z.array(z.string()).optional(),
    timeout_ms: z.number().int().min(1000).max(300000).optional(),
  }),
});

// ============================================================================
// POST Handler
// ============================================================================

export const POST = createAuthenticatedHandler(async (request, { user, repos }) => {
  const action = getActionParam(request);

  if (action !== 'complete') {
    return badRequest('Invalid action. Use ?action=complete');
  }

  try {
    const body = await request.json();
    const parsed = completeSudoSchema.safeParse(body);

    if (!parsed.success) {
      return validationError(parsed.error);
    }

    const { chatId, decision, pendingSudoCommand } = parsed.data;

    // Verify chat exists and belongs to user
    const chat = await repos.chats.findById(chatId);
    if (!chat || chat.userId !== user.id) {
      return badRequest('Chat not found');
    }

    // Handle denial
    if (decision === 'deny') {
      logger.info('[Shell v1] Sudo command denied by user', {
        chatId,
        command: pendingSudoCommand.command,
      });

      // Create a tool message showing the denial
      const toolMessageId = crypto.randomUUID();
      const toolMessage = {
        id: toolMessageId,
        type: 'message' as const,
        role: 'TOOL' as const,
        content: JSON.stringify({
          toolName: 'sudo_sync',
          success: false,
          result: 'Sudo command was denied by the user.',
          arguments: {
            command: pendingSudoCommand.command,
            parameters: pendingSudoCommand.parameters,
          },
        }),
        createdAt: new Date().toISOString(),
        attachments: [],
      };
      await repos.chats.addMessage(chatId, toolMessage);

      return successResponse({
        action: 'denied',
        message: 'Sudo command denied',
        toolMessageId,
      });
    }

    // Handle approval - execute the command
    logger.info('[Shell v1] Sudo command approved by user', {
      chatId,
      command: pendingSudoCommand.command,
      parameters: pendingSudoCommand.parameters,
    });

    const context: ShellToolContext = {
      userId: user.id,
      chatId,
      projectId: chat.projectId || undefined,
    };

    const result = await executeSudoCommand(
      pendingSudoCommand.command,
      pendingSudoCommand.parameters || [],
      pendingSudoCommand.timeout_ms || 60000,
      context
    );

    // Create a tool message with the result
    const toolMessageId = crypto.randomUUID();
    const toolMessage = {
      id: toolMessageId,
      type: 'message' as const,
      role: 'TOOL' as const,
      content: JSON.stringify({
        toolName: 'sudo_sync',
        success: result.success,
        result: result.formattedText,
        arguments: {
          command: pendingSudoCommand.command,
          parameters: pendingSudoCommand.parameters,
        },
      }),
      createdAt: new Date().toISOString(),
      attachments: [],
    };
    await repos.chats.addMessage(chatId, toolMessage);

    return successResponse({
      action: 'approved',
      result: result.result,
      toolMessageId,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return validationError(error);
    }
    logger.error('[Shell v1] Error processing sudo approval', {}, error instanceof Error ? error : undefined);
    return serverError('Failed to process sudo approval');
  }
});
