/**
 * Chat Memories API
 * GET /api/chats/[id]/memories - Get count of memories for this chat
 * DELETE /api/chats/[id]/memories - Delete all memories associated with this chat
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/lib/auth/session';
import { getRepositories } from '@/lib/repositories/factory';
import { getCharacterVectorStore } from '@/lib/embedding/vector-store';
import { logger } from '@/lib/logger';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/chats/[id]/memories
 * Get count of memories associated with this chat
 */
export async function GET(req: NextRequest, { params }: RouteParams) {
  try {
    const session = await getServerSession();

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id: chatId } = await params;

    logger.debug('[ChatMemories] GET request received', {
      chatId,
      userId: session.user.id,
    });

    const repos = getRepositories();

    // Verify chat belongs to user
    const chat = await repos.chats.findById(chatId);
    if (!chat || chat.userId !== session.user.id) {
      return NextResponse.json({ error: 'Chat not found' }, { status: 404 });
    }

    // Count memories for this chat
    const count = await repos.memories.countByChatId(chatId);

    logger.debug('[ChatMemories] Memory count retrieved', {
      chatId,
      count,
    });

    return NextResponse.json({
      chatId,
      memoryCount: count,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('[ChatMemories] Error getting memory count', { error: errorMessage });
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}

/**
 * DELETE /api/chats/[id]/memories
 * Delete all memories associated with this chat
 */
export async function DELETE(req: NextRequest, { params }: RouteParams) {
  try {
    const session = await getServerSession();

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id: chatId } = await params;

    logger.debug('[ChatMemories] DELETE request received', {
      chatId,
      userId: session.user.id,
    });

    const repos = getRepositories();

    // Verify chat belongs to user
    const chat = await repos.chats.findById(chatId);
    if (!chat || chat.userId !== session.user.id) {
      return NextResponse.json({ error: 'Chat not found' }, { status: 404 });
    }

    // Get all memories for this chat first (so we can clean up vector stores)
    const memories = await repos.memories.findByChatId(chatId);

    if (memories.length === 0) {
      logger.debug('[ChatMemories] No memories to delete', { chatId });
      return NextResponse.json({
        success: true,
        chatId,
        deletedCount: 0,
      });
    }

    logger.info('[ChatMemories] Deleting memories for chat', {
      chatId,
      memoryCount: memories.length,
    });

    // Group memories by character for vector store cleanup
    const memoriesByCharacter = new Map<string, string[]>();
    for (const memory of memories) {
      const existing = memoriesByCharacter.get(memory.characterId) || [];
      existing.push(memory.id);
      memoriesByCharacter.set(memory.characterId, existing);
    }

    // Clean up vector stores for each character
    for (const [characterId, memoryIds] of memoriesByCharacter) {
      try {
        const vectorStore = await getCharacterVectorStore(characterId);
        for (const memoryId of memoryIds) {
          try {
            await vectorStore.removeVector(memoryId);
          } catch (err) {
            logger.warn('[ChatMemories] Failed to remove vector', {
              characterId,
              memoryId,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }
        await vectorStore.save();
        logger.debug('[ChatMemories] Cleaned up vector store', {
          characterId,
          removedCount: memoryIds.length,
        });
      } catch (err) {
        logger.warn('[ChatMemories] Failed to clean up vector store for character', {
          characterId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // Delete all memories from database
    const deletedCount = await repos.memories.deleteByChatId(chatId);

    logger.info('[ChatMemories] Memories deleted successfully', {
      chatId,
      deletedCount,
    });

    return NextResponse.json({
      success: true,
      chatId,
      deletedCount,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('[ChatMemories] Error deleting memories', { error: errorMessage });
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
