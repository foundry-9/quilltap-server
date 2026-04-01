/**
 * Chat Title Regeneration API
 * POST /api/chats/:id/regenerate-title - Regenerate chat title using cheap LLM
 *
 * Used when user re-enables auto-naming after manual rename.
 * Sets isManuallyRenamed to false and generates a new title.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from '@/lib/auth/session'
import { getRepositories } from '@/lib/repositories/factory'
import { getCheapLLMProvider } from '@/lib/llm/cheap-llm'
import { titleChat, ChatMessage } from '@/lib/memory/cheap-llm-tasks'
import { logger } from '@/lib/logger'

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession()

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id } = await params
    const userId = session.user.id
    const repos = getRepositories()

    // Get chat
    const chat = await repos.chats.findById(id)

    if (!chat || chat.userId !== userId) {
      return NextResponse.json({ error: 'Chat not found' }, { status: 404 })
    }

    logger.debug('[Regenerate Title] Starting title regeneration', {
      chatId: id,
      currentTitle: chat.title,
    })

    // Get chat settings for cheap LLM configuration
    const chatSettings = await repos.users.getChatSettings(userId)

    if (!chatSettings?.cheapLLMSettings) {
      return NextResponse.json(
        { error: 'Cheap LLM settings not configured' },
        { status: 400 }
      )
    }

    // Get available connection profiles
    const availableProfiles = await repos.connections.findByUserId(userId)

    if (availableProfiles.length === 0) {
      return NextResponse.json(
        { error: 'No connection profiles available' },
        { status: 400 }
      )
    }

    // Get the first character participant's connection profile as reference
    const characterParticipant = chat.participants.find(
      (p: { type: string }) => p.type === 'CHARACTER'
    )
    let connectionProfile = availableProfiles[0]

    if (characterParticipant?.connectionProfileId) {
      const participantProfile = availableProfiles.find(
        (p: { id: string }) => p.id === characterParticipant.connectionProfileId
      )
      if (participantProfile) {
        connectionProfile = participantProfile
      }
    }

    // Get cheap LLM provider
    const cheapLLM = getCheapLLMProvider(
      connectionProfile,
      {
        strategy: chatSettings.cheapLLMSettings.strategy,
        userDefinedProfileId: chatSettings.cheapLLMSettings.userDefinedProfileId ?? undefined,
        defaultCheapProfileId: chatSettings.cheapLLMSettings.defaultCheapProfileId ?? undefined,
        fallbackToLocal: chatSettings.cheapLLMSettings.fallbackToLocal,
      },
      availableProfiles
    )

    if (!cheapLLM) {
      return NextResponse.json(
        { error: 'No cheap LLM available for title generation' },
        { status: 400 }
      )
    }

    logger.debug('[Regenerate Title] Using cheap LLM', {
      chatId: id,
      provider: cheapLLM.provider,
      model: cheapLLM.modelName,
    })

    // Get messages for title generation
    const allMessages = await repos.chats.getMessages(id)
    const conversationMessages: ChatMessage[] = allMessages
      .filter(msg => msg.type === 'message')
      .filter(msg => {
        const role = (msg as { role: string }).role
        return role === 'USER' || role === 'ASSISTANT'
      })
      .map(msg => ({
        role: (msg as { role: string }).role.toLowerCase() as 'user' | 'assistant',
        content: (msg as { content: string }).content,
      }))

    if (conversationMessages.length === 0) {
      return NextResponse.json(
        { error: 'No messages in chat to generate title from' },
        { status: 400 }
      )
    }

    // Generate new title
    const result = await titleChat(
      conversationMessages,
      undefined, // Don't pass existing title - we want a fresh generation
      cheapLLM,
      userId
    )

    if (!result.success || !result.result) {
      logger.error('[Regenerate Title] Title generation failed', {
        chatId: id,
        error: result.error,
      })
      return NextResponse.json(
        { error: result.error || 'Failed to generate title' },
        { status: 500 }
      )
    }

    const newTitle = result.result

    // Update chat with new title and set isManuallyRenamed to false
    await repos.chats.update(id, {
      title: newTitle,
      isManuallyRenamed: false,
      updatedAt: new Date().toISOString(),
    })

    logger.info('[Regenerate Title] Title regenerated successfully', {
      chatId: id,
      oldTitle: chat.title,
      newTitle,
    })

    return NextResponse.json({
      success: true,
      title: newTitle,
    })
  } catch (error) {
    logger.error(
      '[Regenerate Title] Error regenerating title',
      { operation: 'regenerateTitle' },
      error instanceof Error ? error : undefined
    )
    return NextResponse.json(
      { error: 'Failed to regenerate title' },
      { status: 500 }
    )
  }
}
