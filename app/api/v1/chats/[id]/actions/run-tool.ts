/**
 * Chats API v1 - Run Tool Action
 *
 * Handles user-initiated tool execution from the Run Tool modal
 * POST /api/v1/chats/[id]?action=run-tool
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { logger } from '@/lib/logger';
import { badRequest } from '@/lib/api/responses';
import { executeToolCallWithContext } from '@/lib/chat/tool-executor';
import type { ToolExecutionContext } from '@/lib/chat/tool-executor';
import type { AuthenticatedContext } from '@/lib/api/middleware';

/**
 * Tools that cannot be invoked directly by users
 */
const NON_USER_INVOCABLE_TOOLS = new Set([
  'submit_final_response',
  'request_full_context',
]);

/**
 * Schema for run-tool request
 */
const runToolRequestSchema = z.object({
  toolName: z.string().min(1, 'Tool name is required'),
  arguments: z.record(z.string(), z.unknown()).default({}),
});

/**
 * Execute an arbitrary tool and add result as a message to the chat
 */
export async function handleRunTool(
  req: NextRequest,
  chatId: string,
  { user, repos }: AuthenticatedContext
): Promise<NextResponse> {
  const body = await req.json();
  const validated = runToolRequestSchema.parse(body);

  // Reject non-user-invocable tools
  if (NON_USER_INVOCABLE_TOOLS.has(validated.toolName)) {
    logger.warn('[Chats v1] Rejected user invocation of internal tool', {
      chatId,
      userId: user.id,
      toolName: validated.toolName,
    });
    return badRequest(`Tool '${validated.toolName}' cannot be invoked directly`);
  }

  // Load chat to derive execution context
  const chat = await repos.chats.findById(chatId);
  if (!chat) {
    return badRequest('Chat not found');
  }

  // Find the active character participant for context
  const characterParticipant = chat.participants.find(
    p => p.type === 'CHARACTER' && p.isActive
  );

  const executionContext: ToolExecutionContext = {
    chatId,
    userId: user.id,
    imageProfileId: chat.imageProfileId || characterParticipant?.imageProfileId || undefined,
    characterId: characterParticipant?.characterId || undefined,
    callingParticipantId: characterParticipant?.id || undefined,
    projectId: chat.projectId || undefined,
  };

  // Execute the tool
  const result = await executeToolCallWithContext(
    { name: validated.toolName, arguments: validated.arguments },
    executionContext
  );

  // Format the result for storage
  // Use string result if available, otherwise JSON-stringify
  const resultContent = typeof result.result === 'string'
    ? result.result
    : JSON.stringify(result.result, null, 2);

  // Build a human-readable prompt description
  const argsEntries = Object.entries(validated.arguments);
  const promptParts = argsEntries.length > 0
    ? argsEntries.map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`).join(', ')
    : '';
  const requestPrompt = promptParts
    ? `${validated.toolName}(${promptParts})`
    : validated.toolName;

  // Add the result as a TOOL message to the chat
  const toolResultMessage = await repos.chats.addMessage(chatId, {
    type: 'message',
    id: randomUUID(),
    role: 'TOOL',
    content: JSON.stringify({
      tool: validated.toolName,
      toolName: validated.toolName,
      initiatedBy: 'user',
      success: result.success,
      result: resultContent,
      error: result.error || undefined,
      prompt: requestPrompt,
      arguments: validated.arguments,
    }),
    createdAt: new Date().toISOString(),
    attachments: [],
  });

  logger.info('[Chats v1] User-invoked tool result added to chat', {
    chatId,
    userId: user.id,
    toolName: validated.toolName,
    success: result.success,
  });

  return NextResponse.json({
    success: true,
    message: toolResultMessage,
    result: {
      toolName: result.toolName,
      success: result.success,
      result: result.result,
      error: result.error,
    },
  });
}
