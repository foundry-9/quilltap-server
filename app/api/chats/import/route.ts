/**
 * Chat Import API
 * POST /api/chats/import - Import a SillyTavern chat
 *
 * Supports two modes:
 * 1. Legacy mode: Single character + optional persona (backwards compatible)
 * 2. Multi-character mode: Speaker mappings with multiple characters and personas
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from '@/lib/auth/session'
import { getRepositories } from '@/lib/repositories/factory'
import { importSTChat } from '@/lib/sillytavern/chat'
import { logger } from '@/lib/logger'
import { generateContextSummaryAsync } from '@/lib/chat/context-summary'
import { enqueueMemoryExtractionBatch, ensureProcessorRunning, type MessagePair } from '@/lib/background-jobs'
import type { ChatParticipantBase, FileEntry, Character, Persona } from '@/lib/schemas/types'
import type { SpeakerMapping } from '@/lib/sillytavern/multi-char-parser'
import { getErrorMessage } from '@/lib/errors'

/**
 * Get the filepath for a file based on storage type
 */
function getFilePath(file: FileEntry): string {
  if (file.s3Key) {
    return `/api/files/${file.id}`
  }
  const ext = file.originalFilename.includes('.')
    ? file.originalFilename.substring(file.originalFilename.lastIndexOf('.'))
    : ''
  return `data/files/storage/${file.id}${ext}`
}

/**
 * Helper to parse send_date which can be either a timestamp or a string
 */
function parseSendDate(sendDate: number | string): Date {
  if (typeof sendDate === 'number') {
    return new Date(sendDate)
  }

  let parsed = new Date(sendDate)

  if (Number.isNaN(parsed.getTime())) {
    const normalized = sendDate
      .replace(/(\d+)(?:st|nd|rd|th)/, '$1')
      .replace(/(\d{1,2}):(\d{2})(am|pm)/i, (match, hours, mins, ampm) => {
        let h = Number.parseInt(hours)
        if (ampm.toLowerCase() === 'pm' && h !== 12) h += 12
        if (ampm.toLowerCase() === 'am' && h === 12) h = 0
        return `${h.toString().padStart(2, '0')}:${mins}`
      })

    parsed = new Date(normalized)
  }

  return Number.isNaN(parsed.getTime()) ? new Date() : parsed
}

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession()

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()
    const repos = getRepositories()

    // Detect which mode we're in based on request body
    if (body.mappings) {
      // Multi-character mode
      return handleMultiCharacterImport(body, session.user.id, repos)
    } else {
      // Legacy single-character mode
      return handleLegacyImport(body, session.user.id, repos)
    }
  } catch (error) {
    const errorMessage = getErrorMessage(error, 'Failed to import chat')
    logger.error('Error importing chat', { context: 'POST /api/chats/import', errorMessage }, error instanceof Error ? error : undefined)
    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    )
  }
}

/**
 * Handle multi-character import with speaker mappings
 */
async function handleMultiCharacterImport(
  body: {
    chatData: any
    mappings: SpeakerMapping[]
    defaultConnectionProfileId: string
    triggerTitleGeneration?: boolean
    createMemories?: boolean
    title?: string
  },
  userId: string,
  repos: ReturnType<typeof getRepositories>
) {
  const { chatData, mappings, defaultConnectionProfileId, triggerTitleGeneration, createMemories, title } = body

  if (!chatData || !mappings || mappings.length === 0) {
    return NextResponse.json(
      { error: 'Chat data and mappings are required' },
      { status: 400 }
    )
  }

  logger.info('[Import] Multi-character import starting', {
    userId,
    mappingCount: mappings.length,
    messageCount: chatData.messages?.length,
  })

  // Build speaker name -> entity mapping
  // Also track which entities we need to create
  const speakerToEntity = new Map<string, {
    entityId: string
    entityType: 'CHARACTER' | 'PERSONA'
    connectionProfileId?: string
  }>()

  const createdEntities: { characters: Character[]; personas: Persona[] } = {
    characters: [],
    personas: [],
  }

  const tagIds = new Set<string>()
  const now = new Date().toISOString()
  const participants: ChatParticipantBase[] = []
  let displayOrder = 0

  // Process each mapping
  for (const mapping of mappings) {
    if (mapping.mappingType === 'skip') {
      logger.debug('[Import] Skipping speaker', { speakerName: mapping.speakerName })
      continue
    }

    let entityId: string
    let entityType: 'CHARACTER' | 'PERSONA'
    let connectionProfileId: string | undefined

    if (mapping.mappingType === 'existing_character') {
      // Verify character exists and belongs to user
      const character = await repos.characters.findById(mapping.entityId!)
      if (!character || character.userId !== userId) {
        return NextResponse.json(
          { error: `Character not found: ${mapping.entityName}` },
          { status: 404 }
        )
      }
      entityId = character.id
      entityType = 'CHARACTER'
      connectionProfileId = mapping.connectionProfileId || defaultConnectionProfileId

      // Collect tags
      if (character.tags) {
        for (const tagId of character.tags) {
          tagIds.add(tagId)
        }
      }
    } else if (mapping.mappingType === 'create_character') {
      // Create a new character
      const character = await repos.characters.create({
        userId,
        name: mapping.entityName || mapping.speakerName,
        title: null,
        description: 'Character created during chat import',
        personality: null,
        scenario: null,
        firstMessage: null,
        exampleDialogues: null,
        avatarUrl: null,
        defaultConnectionProfileId: mapping.connectionProfileId || defaultConnectionProfileId || null,
        isFavorite: false,
        tags: [] as string[],
        personaLinks: [] as { personaId: string; isDefault: boolean }[],
        avatarOverrides: [] as { chatId: string; imageId: string }[],
        defaultImageId: null,
        physicalDescriptions: [],
      })
      entityId = character.id
      entityType = 'CHARACTER'
      connectionProfileId = mapping.connectionProfileId || defaultConnectionProfileId
      createdEntities.characters.push(character)

      logger.info('[Import] Created character', { characterId: character.id, name: character.name })
    } else if (mapping.mappingType === 'existing_persona') {
      // Verify persona exists and belongs to user
      const persona = await repos.personas.findById(mapping.entityId!)
      if (!persona || persona.userId !== userId) {
        return NextResponse.json(
          { error: `Persona not found: ${mapping.entityName}` },
          { status: 404 }
        )
      }
      entityId = persona.id
      entityType = 'PERSONA'

      // Collect tags
      if (persona.tags) {
        for (const tagId of persona.tags) {
          tagIds.add(tagId)
        }
      }
    } else if (mapping.mappingType === 'create_persona') {
      // Create a new persona
      const persona = await repos.personas.create({
        userId,
        name: mapping.entityName || mapping.speakerName,
        title: null,
        description: 'Persona created during chat import',
        personalityTraits: null,
        avatarUrl: null,
        sillyTavernData: null,
        tags: [] as string[],
        characterLinks: [] as string[],
        defaultImageId: null,
        physicalDescriptions: [],
      })
      entityId = persona.id
      entityType = 'PERSONA'
      createdEntities.personas.push(persona)

      logger.info('[Import] Created persona', { personaId: persona.id, name: persona.name })
    } else {
      continue
    }

    // Store mapping for message processing
    speakerToEntity.set(mapping.speakerName, {
      entityId,
      entityType,
      connectionProfileId,
    })

    // Add participant
    participants.push({
      id: crypto.randomUUID(),
      type: entityType,
      characterId: entityType === 'CHARACTER' ? entityId : null,
      personaId: entityType === 'PERSONA' ? entityId : null,
      connectionProfileId: connectionProfileId || null,
      imageProfileId: null,
      systemPromptOverride: null,
      displayOrder: displayOrder++,
      isActive: true,
      hasHistoryAccess: false,
      joinScenario: null,
      createdAt: now,
      updatedAt: now,
    })
  }

  // Verify we have at least one character
  const hasCharacter = participants.some(p => p.type === 'CHARACTER')
  if (!hasCharacter) {
    return NextResponse.json(
      { error: 'At least one character must be mapped' },
      { status: 400 }
    )
  }

  // Verify default connection profile
  const defaultProfile = await repos.connections.findById(defaultConnectionProfileId)
  if (!defaultProfile || defaultProfile.userId !== userId) {
    return NextResponse.json(
      { error: 'Default connection profile not found' },
      { status: 404 }
    )
  }

  // Collect tags from connection profile
  if (defaultProfile.tags) {
    for (const tagId of defaultProfile.tags) {
      tagIds.add(tagId)
    }
  }

  // Get chat metadata
  const chatMetadata = chatData.chat_metadata || {}
  const characterName = chatData.character_name
  const userName = chatData.user_name

  // Generate title if not provided
  const chatTitle = title ||
    (characterName ? `Chat with ${characterName}` : null) ||
    'Imported Chat'

  // Create chat
  const chat = await repos.chats.create({
    userId,
    participants,
    title: chatTitle,
    sillyTavernMetadata: chatMetadata,
    tags: Array.from(tagIds),
    messageCount: 0, // Will update after adding messages
    lastRenameCheckInterchange: 0,
  })

  logger.info('[Import] Created chat', {
    chatId: chat.id,
    title: chatTitle,
    participantCount: participants.length,
  })

  // Process messages
  const messages = chatData.messages || []
  let messageCount = 0
  let skippedCount = 0

  for (let index = 0; index < messages.length; index++) {
    const msg = messages[index]
    const speakerName = msg.name

    // Skip messages with no speaker mapping
    const entityInfo = speakerToEntity.get(speakerName)
    if (!entityInfo) {
      skippedCount++
      continue
    }

    // Determine role based on is_user flag
    const role = msg.is_user === true ? 'USER' : 'ASSISTANT'

    // Handle swipes
    const hasSwipes = msg.swipes && msg.swipes.length > 1
    const swipeGroupId = hasSwipes ? `swipe-${index}` : null

    if (hasSwipes) {
      // Create a message for each swipe
      for (let swipeIdx = 0; swipeIdx < msg.swipes.length; swipeIdx++) {
        const swipeContent = msg.swipes[swipeIdx]
        if (!swipeContent && swipeContent !== '') continue

        await repos.chats.addMessage(chat.id, {
          id: crypto.randomUUID(),
          type: 'message',
          role,
          content: swipeContent,
          swipeGroupId,
          swipeIndex: swipeIdx,
          rawResponse: {
            speakerName,
            ...msg.extra,
            swipe_info: msg.swipe_info?.[swipeIdx],
          },
          attachments: [],
          createdAt: parseSendDate(msg.send_date).toISOString(),
        })
        messageCount++
      }
    } else {
      // Single message
      await repos.chats.addMessage(chat.id, {
        id: crypto.randomUUID(),
        type: 'message',
        role,
        content: msg.mes || '',
        swipeGroupId: null,
        swipeIndex: null,
        rawResponse: {
          speakerName,
          ...msg.extra,
        },
        attachments: [],
        createdAt: parseSendDate(msg.send_date).toISOString(),
      })
      messageCount++
    }
  }

  // Update message count
  await repos.chats.update(chat.id, {
    messageCount,
    updatedAt: now,
  })

  logger.info('[Import] Imported messages', {
    chatId: chat.id,
    messageCount,
    skippedCount,
  })

  // Trigger title generation if requested
  if (triggerTitleGeneration) {
    // Get the first character's connection profile for cheap LLM access
    const firstCharacterParticipant = participants.find(p => p.type === 'CHARACTER' && p.connectionProfileId)
    if (firstCharacterParticipant?.connectionProfileId) {
      const connectionProfile = await repos.connections.findById(firstCharacterParticipant.connectionProfileId)
      if (connectionProfile) {
        // Get user's cheap LLM settings from chat settings
        const chatSettings = await repos.users.getChatSettings(userId)
        const cheapLLMSettings = chatSettings?.cheapLLMSettings || {
          strategy: 'PROVIDER_CHEAPEST' as const,
          userDefinedProfileId: null,
          defaultCheapProfileId: null,
          fallbackToLocal: true,
          embeddingProvider: 'SAME_PROVIDER' as const,
        }

        // Get all connection profiles for fallback
        const allProfiles = await repos.connections.findByUserId(userId)

        // Trigger async context summary generation (which also generates a title)
        logger.info('[Import] Triggering title generation', { chatId: chat.id })
        generateContextSummaryAsync({
          userId,
          chatId: chat.id,
          connectionProfile,
          cheapLLMSettings,
          availableProfiles: allProfiles,
          forceRegenerate: true,
        })
      }
    }
  }

  // Queue memory extraction jobs if requested
  let memoryJobCount = 0
  if (createMemories) {
    const firstCharacterParticipant = participants.find(p => p.type === 'CHARACTER' && p.characterId)
    if (firstCharacterParticipant?.characterId && firstCharacterParticipant.connectionProfileId) {
      // Get character name
      const character = await repos.characters.findById(firstCharacterParticipant.characterId)
      if (character) {
        // Build message pairs from imported messages
        const allImportedMessages = await repos.chats.getMessages(chat.id)
        const messageList = allImportedMessages.filter(
          (m): m is typeof m & { type: 'message'; role: 'USER' | 'ASSISTANT' } =>
            m.type === 'message' && (m.role === 'USER' || m.role === 'ASSISTANT')
        )

        // Pair user messages with their subsequent assistant responses
        const messagePairs: MessagePair[] = []
        for (let i = 0; i < messageList.length - 1; i++) {
          const current = messageList[i]
          const next = messageList[i + 1]

          if (current.role === 'USER' && next.role === 'ASSISTANT') {
            messagePairs.push({
              userMessageId: current.id,
              assistantMessageId: next.id,
              userContent: current.content,
              assistantContent: next.content,
            })
          }
        }

        if (messagePairs.length > 0) {
          logger.info('[Import] Queueing memory extraction jobs', {
            chatId: chat.id,
            characterId: character.id,
            pairCount: messagePairs.length,
          })

          const jobIds = await enqueueMemoryExtractionBatch(
            userId,
            chat.id,
            character.id,
            character.name,
            firstCharacterParticipant.connectionProfileId,
            messagePairs,
            { priority: 0 } // Low priority for bulk imports
          )
          memoryJobCount = jobIds.length

          // Start the processor if not already running
          ensureProcessorRunning()
        }
      }
    }
  }

  // Get complete chat data for response
  const allMessages = await repos.chats.getMessages(chat.id)
  const messageEvents = allMessages.filter(m => m.type === 'message')

  // Get tags data
  const allTags = await repos.tags.findAll()
  const chatTagsData = allTags
    .filter(tag => chat.tags.includes(tag.id))
    .map(tag => ({
      chatId: chat.id,
      tagId: tag.id,
      tag: {
        id: tag.id,
        name: tag.name,
        nameLower: tag.nameLower,
        userId: tag.userId,
        createdAt: tag.createdAt,
        updatedAt: tag.updatedAt,
      },
    }))

  // Build enriched participants for response
  const enrichedParticipants = await Promise.all(
    participants.map(async (p) => {
      if (p.type === 'CHARACTER' && p.characterId) {
        const character = await repos.characters.findById(p.characterId)
        let defaultImage = null
        if (character?.defaultImageId) {
          const fileEntry = await repos.files.findById(character.defaultImageId)
          if (fileEntry) {
            defaultImage = {
              id: fileEntry.id,
              filepath: getFilePath(fileEntry),
              url: null,
            }
          }
        }
        return {
          ...p,
          character: character ? { ...character, defaultImage } : null,
          persona: null,
        }
      } else if (p.type === 'PERSONA' && p.personaId) {
        const persona = await repos.personas.findById(p.personaId)
        return {
          ...p,
          character: null,
          persona,
        }
      }
      return p
    })
  )

  const completeChat = {
    ...chat,
    participants: enrichedParticipants,
    messages: messageEvents.map(msg => ({
      id: msg.id,
      chatId: chat.id,
      role: msg.role,
      content: msg.content,
      createdAt: msg.createdAt,
      updatedAt: msg.createdAt,
      swipeGroupId: msg.swipeGroupId || null,
      swipeIndex: msg.swipeIndex || null,
      tokenCount: msg.tokenCount || null,
      rawResponse: msg.rawResponse || null,
    })),
    tags: chatTagsData,
    _count: {
      messages: messageEvents.length,
    },
    // Include created entities for memory creation UI
    createdEntities,
    triggerTitleGeneration: triggerTitleGeneration || false,
    // Include memory job count if memories were queued
    memoryJobCount: memoryJobCount > 0 ? memoryJobCount : undefined,
  }

  return NextResponse.json(completeChat, { status: 201 })
}

/**
 * Handle legacy single-character import (backwards compatible)
 */
async function handleLegacyImport(
  body: {
    chatData: any
    characterId: string
    connectionProfileId: string
    personaId?: string
    title?: string
  },
  userId: string,
  repos: ReturnType<typeof getRepositories>
) {
  const { chatData, characterId, connectionProfileId, personaId, title } = body

  if (!chatData || !characterId || !connectionProfileId) {
    return NextResponse.json(
      {
        error:
          'Chat data, character ID, and connection profile ID are required',
      },
      { status: 400 }
    )
  }

  // Verify character belongs to user
  const character = await repos.characters.findById(characterId)

  if (!character || character.userId !== userId) {
    return NextResponse.json(
      { error: 'Character not found' },
      { status: 404 }
    )
  }

  // Verify connection profile belongs to user
  const profile = await repos.connections.findById(connectionProfileId)

  if (!profile || profile.userId !== userId) {
    return NextResponse.json(
      { error: 'Connection profile not found' },
      { status: 404 }
    )
  }

  // If persona specified, verify it belongs to user
  let persona = null
  if (personaId) {
    persona = await repos.personas.findById(personaId)

    if (!persona || persona.userId !== userId) {
      return NextResponse.json(
        { error: 'Persona not found' },
        { status: 404 }
      )
    }
  }

  // Import chat from SillyTavern format
  const importedData = importSTChat(chatData, characterId, userId)

  // Collect tags from character, persona, and connection profile
  const tagIds = new Set<string>()

  // Get tags from character
  if (character.tags) {
    for (const tagId of character.tags) {
      tagIds.add(tagId)
    }
  }

  // Get tags from persona if specified
  if (persona?.tags) {
    for (const tagId of persona.tags) {
      tagIds.add(tagId)
    }
  }

  // Get tags from connection profile
  if (profile.tags) {
    for (const tagId of profile.tags) {
      tagIds.add(tagId)
    }
  }

  // Build participants array
  const now = new Date().toISOString()
  const participants: ChatParticipantBase[] = []

  // Add character participant
  participants.push({
    id: crypto.randomUUID(),
    type: 'CHARACTER',
    characterId,
    personaId: null,
    connectionProfileId,
    imageProfileId: null,
    systemPromptOverride: null,
    displayOrder: 0,
    isActive: true,
    hasHistoryAccess: false,
    joinScenario: null,
    createdAt: now,
    updatedAt: now,
  })

  // Add persona participant if specified
  if (personaId) {
    participants.push({
      id: crypto.randomUUID(),
      type: 'PERSONA',
      characterId: null,
      personaId,
      connectionProfileId: null,
      imageProfileId: null,
      systemPromptOverride: null,
      displayOrder: 1,
      isActive: true,
      hasHistoryAccess: false,
      joinScenario: null,
      createdAt: now,
      updatedAt: now,
    })
  }

  // Create chat in database
  const chat = await repos.chats.create({
    userId,
    participants,
    title: title || `Chat with ${character.name}`,
    sillyTavernMetadata: importedData.metadata || null,
    tags: Array.from(tagIds),
    messageCount: importedData.messages.length,
    lastRenameCheckInterchange: 0,
  })

  // Add messages to the chat
  for (const msg of importedData.messages) {
    await repos.chats.addMessage(chat.id, {
      id: crypto.randomUUID(),
      type: 'message',
      role: msg.role,
      content: msg.content,
      swipeGroupId: msg.swipeGroupId || null,
      swipeIndex: msg.swipeIndex || null,
      rawResponse: msg.rawResponse || null,
      attachments: [],
      createdAt: msg.createdAt.toISOString(),
    })
  }

  // Get the complete chat data for response
  const messages = await repos.chats.getMessages(chat.id)
  const messageEvents = messages.filter(m => m.type === 'message')

  // Get character's default image from repository
  let defaultImage = null
  if (character.defaultImageId) {
    const fileEntry = await repos.files.findById(character.defaultImageId)
    if (fileEntry) {
      defaultImage = {
        id: fileEntry.id,
        filepath: getFilePath(fileEntry),
        url: null,
      }
    }
  }

  // Get tags data
  const allTags = await repos.tags.findAll()
  const chatTagsData = allTags
    .filter(tag => chat.tags.includes(tag.id))
    .map(tag => ({
      chatId: chat.id,
      tagId: tag.id,
      tag: {
        id: tag.id,
        name: tag.name,
        nameLower: tag.nameLower,
        userId: tag.userId,
        createdAt: tag.createdAt,
        updatedAt: tag.updatedAt,
      },
    }))

  // Build response with participants
  const completeChat = {
    ...chat,
    messages: messageEvents.map(msg => ({
      id: msg.id,
      chatId: chat.id,
      role: msg.role,
      content: msg.content,
      createdAt: msg.createdAt,
      updatedAt: msg.createdAt,
      swipeGroupId: msg.swipeGroupId || null,
      swipeIndex: msg.swipeIndex || null,
      tokenCount: msg.tokenCount || null,
      rawResponse: msg.rawResponse || null,
    })),
    // Include character and persona for backwards compatibility
    character: {
      ...character,
      defaultImage,
    },
    persona: persona,
    connectionProfile: profile,
    tags: chatTagsData,
    _count: {
      messages: messageEvents.length,
    },
  }

  return NextResponse.json(completeChat, { status: 201 })
}
