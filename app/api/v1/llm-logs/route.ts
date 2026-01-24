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
 *   - limit: Max results (default 50, max 100)
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
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '50', 10), 100);
    const offset = parseInt(url.searchParams.get('offset') || '0', 10);

    logger.debug('[LLM Logs API] GET logs', {
      userId: user.id,
      filters: { messageId, chatId, characterId, type, standalone, limit, offset },
    });

    let logs;

    // Filter by specific entity
    if (messageId) {
      logger.debug('[LLM Logs API] Listing logs by messageId', { userId: user.id, messageId });
      logs = await repos.llmLogs.findByMessageId(messageId);
    } else if (chatId) {
      // Verify chat ownership first
      const chat = await repos.chats.findById(chatId);
      if (!chat || chat.userId !== user.id) {
        logger.debug('[LLM Logs API] Chat not found or unauthorized', { userId: user.id, chatId });
        return notFound('Chat');
      }
      logger.debug('[LLM Logs API] Listing logs by chatId', { userId: user.id, chatId });
      logs = await repos.llmLogs.findByChatId(chatId);
    } else if (characterId) {
      // Verify character ownership first
      const character = await repos.characters.findById(characterId);
      if (!character || character.userId !== user.id) {
        logger.debug('[LLM Logs API] Character not found or unauthorized', { userId: user.id, characterId });
        return notFound('Character');
      }
      logger.debug('[LLM Logs API] Listing logs by characterId', { userId: user.id, characterId });
      logs = await repos.llmLogs.findByCharacterId(characterId);
    } else if (standalone) {
      logger.debug('[LLM Logs API] Listing standalone logs', { userId: user.id });
      logs = await repos.llmLogs.findStandalone(user.id, limit);
    } else if (type) {
      logger.debug('[LLM Logs API] Listing logs by type', { userId: user.id, type });
      logs = await repos.llmLogs.findByType(user.id, type, limit);
    } else {
      // Default: recent logs for user
      logger.debug('[LLM Logs API] Listing recent logs for user', { userId: user.id });
      logs = await repos.llmLogs.findRecent(user.id, limit);
    }

    // Apply pagination if not already limited
    const totalCount = logs.length;
    if (offset > 0) {
      logs = logs.slice(offset);
    }
    if (logs.length > limit) {
      logs = logs.slice(0, limit);
    }

    logger.debug('[LLM Logs API] Logs listed successfully', {
      userId: user.id,
      count: logs.length,
      totalCount,
      offset,
    });

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
