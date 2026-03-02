/**
 * LLM Logs API v1 - Collection Endpoint
 *
 * Consolidated REST API for LLM logging operations.
 *
 * GET /api/v1/llm-logs - List LLM logs with filters
 *   Query params:
 *   - messageId: Filter by message ID
 *   - chatId: Filter by chat ID
 *   - characterId: Filter by character ID
 *   - type: Filter by log type
 *   - standalone: Set to 'true' for logs without entity associations
 *   - includeMessages: Set to 'true' with chatId to include logs linked via message IDs
 *   - limit: Max results (default 50, max 100; default 500, max 500 when includeMessages=true)
 *   - offset: Pagination offset
 */

import { NextRequest, NextResponse } from 'next/server';
import { createAuthenticatedHandler } from '@/lib/api/middleware';
import { successResponse, badRequest, serverError, notFound } from '@/lib/api/responses';
import { logger } from '@/lib/logger';
import type { LLMLogType } from '@/lib/schemas/types';

export const GET = createAuthenticatedHandler(async (req, { user, repos }) => {
  try {
    const url = new URL(req.url);
    const messageId = url.searchParams.get('messageId');
    const chatId = url.searchParams.get('chatId');
    const characterId = url.searchParams.get('characterId');
    const type = url.searchParams.get('type') as LLMLogType | null;
    const standalone = url.searchParams.get('standalone') === 'true';
    const includeMessagesParam = url.searchParams.get('includeMessages') === 'true';
    const limit = Math.min(
      parseInt(url.searchParams.get('limit') || (includeMessagesParam ? '500' : '50'), 10),
      includeMessagesParam ? 500 : 100
    );
    const offset = parseInt(url.searchParams.get('offset') || '0', 10);
    let logs;

    // Filter by specific entity
    if (messageId) {
      logs = await repos.llmLogs.findByMessageId(messageId);
    } else if (chatId) {
      // Verify chat ownership first
      const chat = await repos.chats.findById(chatId);
      if (!chat || chat.userId !== user.id) {
        return notFound('Chat');
      }

      if (includeMessagesParam) {
        // Fetch all message IDs for this chat to find associated logs
        const chatMessages = await repos.chats.getMessages(chatId);
        const messageIds = chatMessages.map((m: { id: string }) => m.id);
        logs = await repos.llmLogs.findAllForChat(chatId, messageIds);
        logger.debug('[LLM Logs API] Fetched combined chat logs', {
          chatId,
          messageCount: messageIds.length,
          logCount: logs.length,
        });
      } else {
        logs = await repos.llmLogs.findByChatId(chatId);
      }
    } else if (characterId) {
      // Verify character ownership first
      const character = await repos.characters.findById(characterId);
      if (!character || character.userId !== user.id) {
        return notFound('Character');
      }
      logs = await repos.llmLogs.findByCharacterId(characterId);
    } else if (standalone) {
      logs = await repos.llmLogs.findStandalone(user.id, limit);
    } else if (type) {
      logs = await repos.llmLogs.findByType(user.id, type, limit);
    } else {
      // Default: recent logs for user
      logs = await repos.llmLogs.findRecent(user.id, limit);
    }

    // Apply pagination if not already limited
    const totalCount = logs.length;
    if (offset > 0) {
      logs = logs.slice(offset);
    }
    if (logs.length > limit) {
      logs = logs.slice(0, limit);
    }return successResponse({
      logs,
      count: logs.length,
      total: totalCount,
      limit,
      offset,
    });
  } catch (error) {
    logger.error('[LLM Logs API] Error listing logs', { userId: user.id }, error instanceof Error ? error : undefined);
    return serverError('Failed to list LLM logs');
  }
});
