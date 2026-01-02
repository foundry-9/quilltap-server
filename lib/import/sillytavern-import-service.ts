/**
 * SillyTavern Import Service
 *
 * Handles importing of SillyTavern chat format files.
 * Extracted from app/api/chats/import/route.ts for reusability.
 */

import { importSTChat, type STChat } from '@/lib/sillytavern/chat'
import { logger } from '@/lib/logger'
import { generateContextSummaryAsync } from '@/lib/chat/context-summary'
import { enqueueMemoryExtractionBatch, ensureProcessorRunning, type MessagePair } from '@/lib/background-jobs'
import type { ChatParticipantBase, Character, Persona } from '@/lib/schemas/types'
import type { SpeakerMapping } from '@/lib/sillytavern/multi-char-parser'
import type { RepositoryContainer } from '@/lib/repositories/factory'
import { getFilePath } from '@/lib/api/middleware/file-path'

const importLogger = logger.child({ module: 'sillytavern-import' })

// ============================================================================
// Types
// ============================================================================

/**
 * Options for multi-character import
 */
export interface MultiCharacterImportOptions {
  chatData: STChat
  mappings: SpeakerMapping[]
  defaultConnectionProfileId: string
  triggerTitleGeneration?: boolean
  createMemories?: boolean
  title?: string
}

/**
 * Options for legacy single-character import
 */
export interface LegacyImportOptions {
  chatData: STChat
  characterId: string
  connectionProfileId: string
  personaId?: string
  title?: string
}

/**
 * Result of import operation
 */
export interface ImportResult {
  chat: ChatMetadataWithMessages
  createdEntities?: {
    characters: Character[]
    personas: Persona[]
  }
  memoryJobCount?: number
}

/**
 * Chat with messages and enriched data
 */
interface ChatMetadataWithMessages {
  id: string
  userId: string
  title: string
  participants: EnrichedParticipant[]
  tags: TagData[]
  messages: MessageData[]
  sillyTavernMetadata: Record<string, unknown> | null
  createdAt: string
  updatedAt: string
  _count: { messages: number }
}

interface EnrichedParticipant extends ChatParticipantBase {
  character: (Character & { defaultImage: DefaultImageData | null }) | null
  persona: Persona | null
}

interface DefaultImageData {
  id: string
  filepath: string
  url: string | null
}

interface TagData {
  chatId: string
  tagId: string
  tag: {
    id: string
    name: string
    nameLower: string
    userId: string
    createdAt: string
    updatedAt: string
  }
}

interface MessageData {
  id: string
  chatId: string
  role: string
  content: string
  createdAt: string
  updatedAt: string
  swipeGroupId: string | null
  swipeIndex: number | null
  tokenCount: number | null
  rawResponse: Record<string, unknown> | null
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Helper to parse send_date which can be either a timestamp or a string
 */
export function parseSendDate(sendDate: number | string): Date {
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

// ============================================================================
// Multi-Character Import
// ============================================================================

/**
 * Import a SillyTavern chat with multi-character speaker mappings
 */
export async function importMultiCharacterChat(
  userId: string,
  options: MultiCharacterImportOptions,
  repos: RepositoryContainer
): Promise<ImportResult> {
  const {
    chatData,
    mappings,
    defaultConnectionProfileId,
    triggerTitleGeneration,
    createMemories,
    title,
  } = options

  importLogger.info('Multi-character import starting', {
    userId,
    mappingCount: mappings.length,
    messageCount: chatData.messages.length,
  })

  // Build speaker name -> entity mapping
  const speakerToEntity = new Map<
    string,
    {
      entityId: string
      entityType: 'CHARACTER' | 'PERSONA'
      connectionProfileId?: string
    }
  >()

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
      importLogger.debug('Skipping speaker', { speakerName: mapping.speakerName })
      continue
    }

    let entityId: string
    let entityType: 'CHARACTER' | 'PERSONA'
    let connectionProfileId: string | undefined

    if (mapping.mappingType === 'existing_character') {
      const character = await repos.characters.findById(mapping.entityId!)
      if (!character || character.userId !== userId) {
        throw new Error(`Character not found: ${mapping.entityName}`)
      }
      entityId = character.id
      entityType = 'CHARACTER'
      connectionProfileId = mapping.connectionProfileId || defaultConnectionProfileId

      if (character.tags) {
        for (const tagId of character.tags) {
          tagIds.add(tagId)
        }
      }
    } else if (mapping.mappingType === 'create_character') {
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
        defaultConnectionProfileId:
          mapping.connectionProfileId || defaultConnectionProfileId || null,
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

      importLogger.info('Created character', {
        characterId: character.id,
        name: character.name,
      })
    } else if (mapping.mappingType === 'existing_persona') {
      const persona = await repos.personas.findById(mapping.entityId!)
      if (!persona || persona.userId !== userId) {
        throw new Error(`Persona not found: ${mapping.entityName}`)
      }
      entityId = persona.id
      entityType = 'PERSONA'

      if (persona.tags) {
        for (const tagId of persona.tags) {
          tagIds.add(tagId)
        }
      }
    } else if (mapping.mappingType === 'create_persona') {
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

      importLogger.info('Created persona', {
        personaId: persona.id,
        name: persona.name,
      })
    } else {
      continue
    }

    speakerToEntity.set(mapping.speakerName, {
      entityId,
      entityType,
      connectionProfileId,
    })

    participants.push({
      id: crypto.randomUUID(),
      type: entityType,
      characterId: entityType === 'CHARACTER' ? entityId : null,
      personaId: entityType === 'PERSONA' ? entityId : null,
      controlledBy: entityType === 'PERSONA' ? 'user' : 'llm',
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
    throw new Error('At least one character must be mapped')
  }

  // Verify default connection profile
  const defaultProfile = await repos.connections.findById(defaultConnectionProfileId)
  if (!defaultProfile || defaultProfile.userId !== userId) {
    throw new Error('Default connection profile not found')
  }

  if (defaultProfile.tags) {
    for (const tagId of defaultProfile.tags) {
      tagIds.add(tagId)
    }
  }

  // Get chat metadata
  const chatMetadata = chatData.chat_metadata || {}
  const characterName = chatData.character_name

  const chatTitle =
    title || (characterName ? `Chat with ${characterName}` : null) || 'Imported Chat'

  // Create chat
  const chat = await repos.chats.create({
    userId,
    participants,
    title: chatTitle,
    sillyTavernMetadata: chatMetadata,
    tags: Array.from(tagIds),
    messageCount: 0,
    lastRenameCheckInterchange: 0,
  })

  importLogger.info('Created chat', {
    chatId: chat.id,
    title: chatTitle,
    participantCount: participants.length,
  })

  // Process messages
  const messages = chatData.messages
  let messageCount = 0
  let skippedCount = 0

  for (let index = 0; index < messages.length; index++) {
    const msg = messages[index]
    const speakerName = msg.name

    const entityInfo = speakerToEntity.get(speakerName)
    if (!entityInfo) {
      skippedCount++
      continue
    }

    const role = msg.is_user === true ? 'USER' : 'ASSISTANT'
    const hasSwipes = msg.swipes && msg.swipes.length > 1
    const swipeGroupId = hasSwipes ? `swipe-${index}` : null

    if (hasSwipes) {
      for (let swipeIdx = 0; swipeIdx < msg.swipes!.length; swipeIdx++) {
        const swipeContent = msg.swipes![swipeIdx]
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

  importLogger.info('Imported messages', {
    chatId: chat.id,
    messageCount,
    skippedCount,
  })

  // Trigger title generation if requested
  if (triggerTitleGeneration) {
    await triggerTitleGenerationAsync(userId, chat.id, participants, repos)
  }

  // Queue memory extraction jobs if requested
  let memoryJobCount = 0
  if (createMemories) {
    memoryJobCount = await queueMemoryExtractionJobs(
      userId,
      chat.id,
      participants,
      repos
    )
  }

  // Build response
  const result = await buildImportResponse(
    chat,
    participants,
    repos,
    createdEntities,
    triggerTitleGeneration,
    memoryJobCount
  )

  return result
}

// ============================================================================
// Legacy Single-Character Import
// ============================================================================

/**
 * Import a SillyTavern chat with single character (legacy mode)
 */
export async function importLegacyChat(
  userId: string,
  options: LegacyImportOptions,
  repos: RepositoryContainer
): Promise<ImportResult> {
  const { chatData, characterId, connectionProfileId, personaId, title } = options

  // Verify character belongs to user
  const character = await repos.characters.findById(characterId)
  if (!character || character.userId !== userId) {
    throw new Error('Character not found')
  }

  // Verify connection profile belongs to user
  const profile = await repos.connections.findById(connectionProfileId)
  if (!profile || profile.userId !== userId) {
    throw new Error('Connection profile not found')
  }

  // If persona specified, verify it belongs to user
  let persona: Persona | null = null
  if (personaId) {
    persona = await repos.personas.findById(personaId)
    if (!persona || persona.userId !== userId) {
      throw new Error('Persona not found')
    }
  }

  // Import chat from SillyTavern format
  const importedData = importSTChat(chatData, characterId, userId)

  // Collect tags
  const tagIds = new Set<string>()
  if (character.tags) {
    for (const tagId of character.tags) {
      tagIds.add(tagId)
    }
  }
  if (persona?.tags) {
    for (const tagId of persona.tags) {
      tagIds.add(tagId)
    }
  }
  if (profile.tags) {
    for (const tagId of profile.tags) {
      tagIds.add(tagId)
    }
  }

  // Build participants array
  const now = new Date().toISOString()
  const participants: ChatParticipantBase[] = []

  participants.push({
    id: crypto.randomUUID(),
    type: 'CHARACTER',
    characterId,
    personaId: null,
    controlledBy: 'llm',
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

  if (personaId) {
    participants.push({
      id: crypto.randomUUID(),
      type: 'PERSONA',
      characterId: null,
      personaId,
      controlledBy: 'user',
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

  // Create chat
  const chat = await repos.chats.create({
    userId,
    participants,
    title: title || `Chat with ${character.name}`,
    sillyTavernMetadata: importedData.metadata || null,
    tags: Array.from(tagIds),
    messageCount: importedData.messages.length,
    lastRenameCheckInterchange: 0,
  })

  // Add messages
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

  // Build response
  const result = await buildLegacyImportResponse(
    chat,
    character,
    persona,
    profile,
    repos
  )

  return result
}

// ============================================================================
// Helper Functions
// ============================================================================

async function triggerTitleGenerationAsync(
  userId: string,
  chatId: string,
  participants: ChatParticipantBase[],
  repos: RepositoryContainer
): Promise<void> {
  const firstCharacterParticipant = participants.find(
    p => p.type === 'CHARACTER' && p.connectionProfileId
  )
  if (!firstCharacterParticipant?.connectionProfileId) return

  const connectionProfile = await repos.connections.findById(
    firstCharacterParticipant.connectionProfileId
  )
  if (!connectionProfile) return

  const chatSettings = await repos.chatSettings.findByUserId(userId)
  const cheapLLMSettings = chatSettings?.cheapLLMSettings || {
    strategy: 'PROVIDER_CHEAPEST' as const,
    userDefinedProfileId: null,
    defaultCheapProfileId: null,
    fallbackToLocal: true,
    embeddingProvider: 'SAME_PROVIDER' as const,
  }

  const allProfiles = await repos.connections.findByUserId(userId)

  importLogger.info('Triggering title generation', { chatId })
  generateContextSummaryAsync({
    userId,
    chatId,
    connectionProfile,
    cheapLLMSettings,
    availableProfiles: allProfiles,
    forceRegenerate: true,
  })
}

async function queueMemoryExtractionJobs(
  userId: string,
  chatId: string,
  participants: ChatParticipantBase[],
  repos: RepositoryContainer
): Promise<number> {
  const firstCharacterParticipant = participants.find(
    p => p.type === 'CHARACTER' && p.characterId
  )
  if (!firstCharacterParticipant?.characterId || !firstCharacterParticipant.connectionProfileId) {
    return 0
  }

  const character = await repos.characters.findById(firstCharacterParticipant.characterId)
  if (!character) return 0

  const allImportedMessages = await repos.chats.getMessages(chatId)
  const messageList = allImportedMessages.filter(
    (m): m is typeof m & { type: 'message'; role: 'USER' | 'ASSISTANT' } =>
      m.type === 'message' && (m.role === 'USER' || m.role === 'ASSISTANT')
  )

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

  if (messagePairs.length === 0) return 0

  importLogger.info('Queueing memory extraction jobs', {
    chatId,
    characterId: character.id,
    pairCount: messagePairs.length,
  })

  const jobIds = await enqueueMemoryExtractionBatch(
    userId,
    chatId,
    character.id,
    character.name,
    firstCharacterParticipant.connectionProfileId,
    messagePairs,
    { priority: 0 }
  )

  ensureProcessorRunning()
  return jobIds.length
}

async function buildImportResponse(
  chat: { id: string; userId: string; title: string; tags: string[]; sillyTavernMetadata?: Record<string, unknown> | null; createdAt: string; updatedAt: string },
  participants: ChatParticipantBase[],
  repos: RepositoryContainer,
  createdEntities: { characters: Character[]; personas: Persona[] },
  triggerTitleGeneration?: boolean,
  memoryJobCount?: number
): Promise<ImportResult> {
  const allMessages = await repos.chats.getMessages(chat.id)
  const messageEvents = allMessages.filter(m => m.type === 'message')

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

  const enrichedParticipants = await Promise.all(
    participants.map(async p => {
      if (p.type === 'CHARACTER' && p.characterId) {
        const character = await repos.characters.findById(p.characterId)
        let defaultImage: DefaultImageData | null = null
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
      return { ...p, character: null, persona: null }
    })
  )

  const completeChat: ChatMetadataWithMessages = {
    id: chat.id,
    userId: chat.userId,
    title: chat.title,
    participants: enrichedParticipants,
    tags: chatTagsData,
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
    sillyTavernMetadata: chat.sillyTavernMetadata || null,
    createdAt: chat.createdAt,
    updatedAt: chat.updatedAt,
    _count: { messages: messageEvents.length },
  }

  return {
    chat: completeChat,
    createdEntities,
    memoryJobCount: memoryJobCount && memoryJobCount > 0 ? memoryJobCount : undefined,
  }
}

async function buildLegacyImportResponse(
  chat: { id: string; userId: string; title: string; tags: string[]; sillyTavernMetadata?: Record<string, unknown> | null; createdAt: string; updatedAt: string; participants: ChatParticipantBase[] },
  character: Character,
  persona: Persona | null,
  profile: { id: string; name: string; provider: string; modelName: string },
  repos: RepositoryContainer
): Promise<ImportResult> {
  const messages = await repos.chats.getMessages(chat.id)
  const messageEvents = messages.filter(m => m.type === 'message')

  let defaultImage: DefaultImageData | null = null
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

  const enrichedParticipants: EnrichedParticipant[] = chat.participants.map(p => {
    if (p.type === 'CHARACTER') {
      return {
        ...p,
        character: { ...character, defaultImage },
        persona: null,
      }
    }
    return {
      ...p,
      character: null,
      persona,
    }
  })

  const completeChat: ChatMetadataWithMessages = {
    id: chat.id,
    userId: chat.userId,
    title: chat.title,
    participants: enrichedParticipants,
    tags: chatTagsData,
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
    sillyTavernMetadata: chat.sillyTavernMetadata || null,
    createdAt: chat.createdAt,
    updatedAt: chat.updatedAt,
    _count: { messages: messageEvents.length },
  }

  return { chat: completeChat }
}
