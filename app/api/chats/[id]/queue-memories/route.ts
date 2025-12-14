/**
 * Queue Memory Analysis API
 * POST /api/chats/[id]/queue-memories - Queue memory extraction jobs for a chat
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/lib/auth/session';
import { getRepositories } from '@/lib/repositories/factory';
import { enqueueMemoryExtractionBatch, ensureProcessorRunning, type MessagePair } from '@/lib/background-jobs';
import { logger } from '@/lib/logger';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/chats/[id]/queue-memories
 * Queue memory extraction jobs for all message pairs in a chat
 */
export async function POST(req: NextRequest, { params }: RouteParams) {
  try {
    const session = await getServerSession();

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id: chatId } = await params;
    const body = await req.json();
    const { characterId, characterName, connectionProfileId, messagePairs } = body;

    logger.debug('[QueueMemories] Request received', {
      chatId,
      characterId,
      userId: session.user.id,
    });

    const repos = getRepositories();

    // Verify chat belongs to user
    const chat = await repos.chats.findById(chatId);
    if (!chat || chat.userId !== session.user.id) {
      return NextResponse.json({ error: 'Chat not found' }, { status: 404 });
    }

    // Verify character belongs to user
    const character = await repos.characters.findById(characterId);
    if (!character || character.userId !== session.user.id) {
      return NextResponse.json({ error: 'Character not found' }, { status: 404 });
    }

    // Verify connection profile belongs to user
    const profile = await repos.connections.findById(connectionProfileId);
    if (!profile || profile.userId !== session.user.id) {
      return NextResponse.json({ error: 'Connection profile not found' }, { status: 404 });
    }

    // Use provided message pairs or build them from chat messages
    let pairsToQueue: MessagePair[];

    if (messagePairs && Array.isArray(messagePairs) && messagePairs.length > 0) {
      pairsToQueue = messagePairs;
    } else {
      // Build message pairs from chat messages
      const messages = await repos.chats.getMessages(chatId);
      const messageList = messages.filter(
        (m): m is typeof m & { type: 'message'; role: 'USER' | 'ASSISTANT' } =>
          m.type === 'message' && (m.role === 'USER' || m.role === 'ASSISTANT')
      );

      pairsToQueue = [];
      for (let i = 0; i < messageList.length - 1; i++) {
        const current = messageList[i];
        const next = messageList[i + 1];

        if (current.role === 'USER' && next.role === 'ASSISTANT') {
          pairsToQueue.push({
            userMessageId: current.id,
            assistantMessageId: next.id,
            userContent: current.content,
            assistantContent: next.content,
          });
        }
      }
    }

    if (pairsToQueue.length === 0) {
      return NextResponse.json(
        { error: 'No message pairs found to analyze' },
        { status: 400 }
      );
    }

    logger.info('[QueueMemories] Queueing memory extraction jobs', {
      chatId,
      characterId,
      pairCount: pairsToQueue.length,
    });

    // Queue the jobs
    const jobIds = await enqueueMemoryExtractionBatch(
      session.user.id,
      chatId,
      character.id,
      characterName || character.name,
      connectionProfileId,
      pairsToQueue,
      { priority: 0 } // Low priority for bulk operations
    );

    // Start the processor if not already running
    ensureProcessorRunning();

    return NextResponse.json({
      success: true,
      jobCount: jobIds.length,
      chatId,
      characterId,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('[QueueMemories] Error', { error: errorMessage });
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
