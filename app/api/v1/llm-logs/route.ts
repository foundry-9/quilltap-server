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
import { createContextHandler } from '@/lib/api/middleware';
import { successResponse, badRequest, serverError, notFound } from '@/lib/api/responses';
import { logger } from '@/lib/logger';
import { readPagination } from '@/lib/api/query-params';
import type { LLMLogType } from '@/lib/schemas/types';
import type { LLMLogListScope } from '@/lib/database/repositories/llm-logs.repository';

export const GET = createContextHandler(async (req, { user, repos }) => {
  try {
    const { searchParams } = req.nextUrl;
    const messageId = searchParams.get('messageId');
    const chatId = searchParams.get('chatId');
    const characterId = searchParams.get('characterId');
    const type = searchParams.get('type') as LLMLogType | null;
    const standalone = searchParams.get('standalone') === 'true';
    const includeMessagesParam = searchParams.get('includeMessages') === 'true';
    const { limit, offset } = readPagination(req, {
      defaultLimit: includeMessagesParam ? 500 : 50,
      maxLimit: includeMessagesParam ? 500 : 100,
    });
    let logs;
    let listScope: LLMLogListScope | null = null;

    // Filter by specific entity
    if (messageId) {
      logs = await repos.llmLogs.findByMessageId(messageId);
    } else if (chatId) {
      // Verify chat ownership first
      const chat = await repos.chats.findById(chatId);
      if (!chat) {
        return notFound('Chat');
      }

      if (includeMessagesParam) {
        // Fetch all message IDs for this chat to find associated logs
        const chatMessages = await repos.chats.getMessages(chatId);
        const messageIds = chatMessages.map((m: { id: string }) => m.id);
        logs = await repos.llmLogs.findAllForChat(chatId, messageIds);
      } else {
        logs = await repos.llmLogs.findByChatId(chatId);
      }
    } else if (characterId) {
      // Verify character ownership first
      const character = await repos.characters.findById(characterId);
      if (!character) {
        return notFound('Character');
      }
      logs = await repos.llmLogs.findByCharacterId(characterId);
    } else if (standalone) {
      listScope = { kind: 'standalone' };
      logs = await repos.llmLogs.findStandalone(user.id, limit, offset);
    } else if (type) {
      listScope = { kind: 'type', type };
      logs = await repos.llmLogs.findByType(user.id, type, limit, offset);
    } else {
      // Default: recent logs for user
      listScope = { kind: 'recent' };
      logs = await repos.llmLogs.findRecent(user.id, limit, offset);
    }

    // The user-wide listings page in SQL and count in SQL (#167). The
    // per-entity paths return the whole set, so page those here.
    let totalCount: number;
    if (listScope) {
      totalCount = await repos.llmLogs.countByScope(user.id, listScope);
    } else {
      totalCount = logs.length;
      logs = logs.slice(offset, offset + limit);
    }

    return successResponse({
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
