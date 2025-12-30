// Chat API: List and Create
// GET /api/chats - List all chats for user
// POST /api/chats - Create a new chat with participants

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from '@/lib/auth/session'
import { getRepositories } from '@/lib/repositories/factory'
import { buildChatContext, type ChatContext } from '@/lib/chat/initialize'
import { decryptApiKey } from '@/lib/encryption'
import { generateGreetingMessage } from '@/lib/chat/initial-greeting'
import { logger } from '@/lib/logger'
import { z } from 'zod'
import type { ChatEvent, ChatParticipantBase, ChatParticipantBaseInput, FileEntry, TimestampConfig } from '@/lib/schemas/types'
import { TimestampConfigSchema } from '@/lib/schemas/types'

type Repos = ReturnType<typeof getRepositories>

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

// Result types for participant builders (uses Input type for optional defaults)
type ParticipantBuildSuccess = {
  participant: Omit<ChatParticipantBaseInput, 'id' | 'createdAt' | 'updatedAt'>
  tags: string[]
}
type ParticipantBuildError = { error: string }
type ParticipantBuildResult = ParticipantBuildSuccess | ParticipantBuildError

// Participant schema for chat creation
// Note: PERSONA type is deprecated - use CHARACTER with controlledBy='user' instead
const createParticipantSchema = z.object({
  type: z.enum(['CHARACTER', 'PERSONA']),  // PERSONA kept for backwards compatibility
  characterId: z.string().uuid().optional(),
  personaId: z.string().uuid().optional(),  // @deprecated - use characterId with controlledBy='user'
  connectionProfileId: z.string().uuid().optional(),
  imageProfileId: z.string().uuid().optional(),
  systemPromptOverride: z.string().optional(),
  controlledBy: z.enum(['llm', 'user']).optional(),  // Who controls this participant
})

// Validation schema for creating a chat
const createChatSchema = z.object({
  participants: z.array(createParticipantSchema).min(1, 'At least one participant is required'),
  title: z.string().optional(),
  scenario: z.string().optional(),
  timestampConfig: TimestampConfigSchema.optional(),
})

// Helper to get enriched character for list view
async function getCharacterSummary(characterId: string, repos: Repos) {
  const character = await repos.characters.findById(characterId)
  if (!character) return null

  let defaultImage = null
  if (character.defaultImageId) {
    const fileEntry = await repos.files.findById(character.defaultImageId)
    if (fileEntry) {
      defaultImage = { id: fileEntry.id, filepath: getFilePath(fileEntry), url: null }
    }
  }

  return {
    id: character.id,
    name: character.name,
    title: character.title,
    avatarUrl: character.avatarUrl,
    defaultImageId: character.defaultImageId,
    defaultImage,
    tags: character.tags || [],
  }
}

// Helper to get enriched persona for list view
async function getPersonaSummary(personaId: string, repos: Repos) {
  const persona = await repos.personas.findById(personaId)
  if (!persona) return null

  let defaultImage = null
  if (persona.defaultImageId) {
    const fileEntry = await repos.files.findById(persona.defaultImageId)
    if (fileEntry) {
      defaultImage = { id: fileEntry.id, filepath: getFilePath(fileEntry), url: null }
    }
  }

  return {
    id: persona.id,
    name: persona.name,
    title: persona.title,
    avatarUrl: persona.avatarUrl,
    defaultImageId: persona.defaultImageId,
    defaultImage,
    tags: persona.tags || [],
  }
}

// Helper to enrich participant for list view
async function enrichParticipantSummary(participant: ChatParticipantBase, repos: Repos) {
  const character = participant.type === 'CHARACTER' && participant.characterId
    ? await getCharacterSummary(participant.characterId, repos)
    : null

  const persona = participant.type === 'PERSONA' && participant.personaId
    ? await getPersonaSummary(participant.personaId, repos)
    : null

  return {
    id: participant.id,
    type: participant.type,
    displayOrder: participant.displayOrder,
    isActive: participant.isActive,
    character,
    persona,
  }
}

// GET /api/chats - List all chats
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const repos = getRepositories()
    const user = await repos.users.findById(session.user.id)

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    // Parse query parameters
    const { searchParams } = new URL(req.url)
    const excludeTagIdsParam = searchParams.get('excludeTagIds')
    const limitParam = searchParams.get('limit')
    const excludeTagIds = excludeTagIdsParam ? excludeTagIdsParam.split(',').filter(Boolean) : []
    const limit = limitParam ? parseInt(limitParam, 10) : undefined

    logger.debug('Fetching chats', {
      context: 'GET /api/chats',
      userId: user.id,
      excludeTagIds: excludeTagIds.length > 0 ? excludeTagIds : undefined,
      limit,
    })

    const chatMetadata = await repos.chats.findByUserId(user.id)

    // Sort by updatedAt descending
    chatMetadata.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())

    // Enrich chats with related data
    const chats = await Promise.all(
      chatMetadata.map(async (chat) => {
        // Enrich participants
        const participants = await Promise.all(
          chat.participants.map(p => enrichParticipantSummary(p, repos))
        )

        // Get tags
        const tagData = await Promise.all(
          chat.tags.map(async (tagId) => {
            const tag = await repos.tags.findById(tagId)
            return tag ? { tag: { id: tag.id, name: tag.name } } : null
          })
        )

        // Get message count
        const messageCount = await repos.chats.getMessageCount(chat.id)

        // Collect all tag IDs from chat, characters, and personas for filtering
        const allTagIds: string[] = [...chat.tags]
        for (const participant of participants) {
          if (participant.character?.tags) {
            allTagIds.push(...participant.character.tags)
          }
          if (participant.persona?.tags) {
            allTagIds.push(...participant.persona.tags)
          }
        }

        return {
          id: chat.id,
          title: chat.title,
          contextSummary: chat.contextSummary,
          createdAt: chat.createdAt,
          updatedAt: chat.updatedAt,
          participants,
          tags: tagData.filter(Boolean),
          _count: { messages: messageCount },
          _allTagIds: allTagIds,
        }
      })
    )

    // Filter out chats that have any excluded tags
    let filteredChats = chats
    if (excludeTagIds.length > 0) {
      const excludeSet = new Set(excludeTagIds)
      filteredChats = chats.filter(chat => {
        const hasExcludedTag = chat._allTagIds.some(tagId => excludeSet.has(tagId))
        return !hasExcludedTag
      })
      logger.debug('Filtered chats by excluded tags', {
        context: 'GET /api/chats',
        originalCount: chats.length,
        filteredCount: filteredChats.length,
        excludedCount: chats.length - filteredChats.length,
      })
    }

    // Apply limit if specified
    if (limit && limit > 0) {
      filteredChats = filteredChats.slice(0, limit)
    }

    // Remove internal _allTagIds field before returning
    const result = filteredChats.map(({ _allTagIds, ...chat }) => chat)

    return NextResponse.json({ chats: result })
  } catch (error) {
    logger.error('Error fetching chats', { context: 'GET /api/chats' }, error instanceof Error ? error : undefined)
    return NextResponse.json({ error: 'Failed to fetch chats' }, { status: 500 })
  }
}

// Helper to validate and build a character participant
async function buildCharacterParticipant(
  data: z.infer<typeof createParticipantSchema>,
  displayOrder: number,
  userId: string,
  repos: Repos
): Promise<ParticipantBuildResult> {
  if (!data.characterId) {
    return { error: 'characterId is required for CHARACTER participants' }
  }

  const character = await repos.characters.findById(data.characterId)
  if (character?.userId !== userId) {
    return { error: 'Character not found' }
  }

  // Determine control mode: explicit controlledBy, character's default, or infer from context
  const controlledBy = data.controlledBy || character.controlledBy || 'llm'
  const isUserControlled = controlledBy === 'user'

  // Connection profile is only required for LLM-controlled characters
  if (!isUserControlled && !data.connectionProfileId) {
    return { error: 'connectionProfileId is required for LLM-controlled CHARACTER participants' }
  }

  if (data.connectionProfileId) {
    const profile = await repos.connections.findById(data.connectionProfileId)
    if (profile?.userId !== userId) {
      return { error: 'Connection profile not found' }
    }
  }

  if (data.imageProfileId) {
    const imgProfile = await repos.imageProfiles.findById(data.imageProfileId)
    if (imgProfile?.userId !== userId) {
      return { error: 'Image profile not found' }
    }
  }

  return {
    participant: {
      type: 'CHARACTER',
      characterId: data.characterId,
      personaId: null,
      controlledBy,
      connectionProfileId: isUserControlled ? null : (data.connectionProfileId || null),
      imageProfileId: data.imageProfileId || null,
      systemPromptOverride: data.systemPromptOverride || null,
      displayOrder,
      isActive: true,
    },
    tags: character.tags || [],
  }
}

/**
 * @deprecated Use CHARACTER with controlledBy='user' instead
 * Helper to validate and build a persona participant (legacy support)
 */
async function buildPersonaParticipant(
  data: z.infer<typeof createParticipantSchema>,
  displayOrder: number,
  userId: string,
  repos: Repos
): Promise<ParticipantBuildResult> {
  if (!data.personaId) {
    return { error: 'personaId is required for PERSONA participants' }
  }

  const persona = await repos.personas.findById(data.personaId)
  if (persona?.userId !== userId) {
    return { error: 'Persona not found' }
  }

  logger.warn('PERSONA participant type is deprecated - use CHARACTER with controlledBy=user instead', {
    context: 'buildPersonaParticipant',
    personaId: data.personaId,
  })

  return {
    participant: {
      type: 'PERSONA',
      characterId: null,
      personaId: data.personaId,
      controlledBy: 'user',  // Personas are always user-controlled
      connectionProfileId: null,
      imageProfileId: null,
      systemPromptOverride: data.systemPromptOverride || null,
      displayOrder,
      isActive: true,
    },
    tags: persona.tags || [],
  }
}

// Result type for building all participants (uses Input type for optional defaults)
type BuildParticipantsResult = {
  participants: Omit<ChatParticipantBaseInput, 'id' | 'createdAt' | 'updatedAt'>[]
  tags: Set<string>
  firstCharacter: { characterId: string; userCharacterId?: string }
} | { error: string }

// Helper to build and validate all participants
async function buildAllParticipants(
  participantsData: z.infer<typeof createParticipantSchema>[],
  userId: string,
  repos: Repos
): Promise<BuildParticipantsResult> {
  const builtParticipants: Omit<ChatParticipantBaseInput, 'id' | 'createdAt' | 'updatedAt'>[] = []
  const allTagIds = new Set<string>()
  let firstLLMCharacter: { characterId: string; userCharacterId?: string } | null = null
  let firstUserCharacterId: string | null = null

  for (let i = 0; i < participantsData.length; i++) {
    const participantData = participantsData[i]
    const builder = participantData.type === 'CHARACTER'
      ? buildCharacterParticipant
      : buildPersonaParticipant

    const result = await builder(participantData, i, userId, repos)
    if ('error' in result) {
      return result
    }

    builtParticipants.push(result.participant)
    for (const tag of result.tags) {
      allTagIds.add(tag)
    }

    // Track first LLM-controlled character for context building
    const isUserControlled = result.participant.controlledBy === 'user'
    if (participantData.type === 'CHARACTER' && !isUserControlled && !firstLLMCharacter && participantData.characterId) {
      firstLLMCharacter = { characterId: participantData.characterId }
    }

    // Track first user-controlled character for context building (replaces persona)
    if (participantData.type === 'CHARACTER' && isUserControlled && !firstUserCharacterId && participantData.characterId) {
      firstUserCharacterId = participantData.characterId
    }

    // Legacy: Track persona as user character (for backwards compatibility)
    if (participantData.type === 'PERSONA' && !firstUserCharacterId && participantData.personaId) {
      // For legacy PERSONA type, we don't have a characterId - leave userCharacterId undefined
      // The persona will be handled through the legacy buildChatContext path
      logger.debug('Legacy PERSONA participant - persona data will be used directly', {
        context: 'buildAllParticipants',
        personaId: participantData.personaId,
      })
    }
  }

  if (!firstLLMCharacter) {
    return { error: 'At least one LLM-controlled CHARACTER participant is required' }
  }

  // Attach user character ID to context
  firstLLMCharacter.userCharacterId = firstUserCharacterId || undefined

  return { participants: builtParticipants, tags: allTagIds, firstCharacter: firstLLMCharacter }
}

// Helper to create initial chat messages
async function createInitialMessages(
  chatId: string,
  context: ChatContext,
  participants: ChatParticipantBaseInput[],
  userId: string,
  repos: Repos
): Promise<void> {
  const systemMessage: ChatEvent = {
    type: 'message',
    id: crypto.randomUUID(),
    role: 'SYSTEM',
    content: context.systemPrompt,
    attachments: [],
    createdAt: new Date().toISOString(),
  }
  await repos.chats.addMessage(chatId, systemMessage)

  let firstMessageContent = (context.firstMessage || '').trim()

  if (!firstMessageContent) {
    firstMessageContent = await autoGenerateFirstMessage(context, participants, userId, repos)
  }

  if (!firstMessageContent) {
    firstMessageContent = defaultGreeting(context.character.name)
  }

  const firstMessage: ChatEvent = {
    type: 'message',
    id: crypto.randomUUID(),
    role: 'ASSISTANT',
    content: firstMessageContent,
    attachments: [],
    createdAt: new Date().toISOString(),
  }
  await repos.chats.addMessage(chatId, firstMessage)
}

async function autoGenerateFirstMessage(
  context: ChatContext,
  participants: ChatParticipantBaseInput[],
  userId: string,
  repos: Repos
): Promise<string> {
  const participant = selectCharacterParticipant(context.character.id, participants)

  if (!participant?.connectionProfileId) {
    return ''
  }

  const connectionProfile = await repos.connections.findById(participant.connectionProfileId)
  if (!connectionProfile) {
    return ''
  }

  let apiKey = ''
  if (connectionProfile.apiKeyId) {
    const storedKey = await repos.connections.findApiKeyById(connectionProfile.apiKeyId)
    if (!storedKey) {
      logger.warn('Connection profile is missing its API key; falling back to default greeting', { context: 'autoGenerateFirstMessage' })
      return ''
    }

    try {
      apiKey = decryptApiKey(storedKey.ciphertext, storedKey.iv, storedKey.authTag, userId)
    } catch (error) {
      logger.error('Failed to decrypt API key for greeting generation', { context: 'autoGenerateFirstMessage' }, error instanceof Error ? error : undefined)
      return ''
    }
  }

  const rawParameters = connectionProfile.parameters as Record<string, unknown> | undefined
  const parameters = rawParameters ?? {}

  try {
    const greeting = await generateGreetingMessage({
      systemPrompt: context.systemPrompt,
      characterName: context.character.name,
      provider: connectionProfile.provider,
      modelName: connectionProfile.modelName,
      baseUrl: connectionProfile.baseUrl,
      apiKey,
      temperature: extractNumber(parameters.temperature),
      maxTokens: extractNumber(parameters.maxTokens),
      topP: extractNumber(parameters.topP),
    })
    return greeting
  } catch (error) {
    logger.error('Failed to auto-generate greeting for chat', { context: 'autoGenerateFirstMessage' }, error instanceof Error ? error : undefined)
    return ''
  }
}

function selectCharacterParticipant(
  characterId: string,
  participants: ChatParticipantBaseInput[]
): ChatParticipantBaseInput | null {
  const matches = participants
    .filter(p => p.type === 'CHARACTER' && p.characterId === characterId)
    .sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0))

  if (matches.length > 0) {
    return matches[0]
  }

  const firstCharacter = participants
    .filter(p => p.type === 'CHARACTER')
    .sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0))

  return firstCharacter[0] || null
}

function extractNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && !Number.isNaN(value)) {
    return value
  }

  if (typeof value === 'string') {
    const parsed = Number(value)
    return Number.isNaN(parsed) ? undefined : parsed
  }

  return undefined
}

function defaultGreeting(characterName: string): string {
  return `Hello there! I'm ${characterName}. It's great to meet you. What's on your mind today?`
}

// POST /api/chats - Create a new chat
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const repos = getRepositories()
    const user = await repos.users.findById(session.user.id)

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    const body = await req.json()
    const validatedData = createChatSchema.parse(body)

    const buildResult = await buildAllParticipants(validatedData.participants, user.id, repos)
    if ('error' in buildResult) {
      return NextResponse.json({ error: buildResult.error }, { status: 400 })
    }

    const context = await buildChatContext(
      buildResult.firstCharacter.characterId,
      buildResult.firstCharacter.userCharacterId,
      validatedData.scenario
    )

    // Get user's default roleplay template to inherit for new chat
    const chatSettings = await repos.chatSettings.findByUserId(user.id)
    const defaultRoleplayTemplateId = chatSettings?.defaultRoleplayTemplateId || null

    logger.debug('Creating chat with roleplay template', {
      context: 'POST /api/chats',
      roleplayTemplateId: defaultRoleplayTemplateId,
      inheritedFrom: 'user_default',
    })

    const now = new Date().toISOString()
    // Use input type here - the schema validation will apply defaults
    const participantsWithTimestamps: ChatParticipantBaseInput[] = buildResult.participants.map(p => ({
      ...p,
      id: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
    }))

    const chat = await repos.chats.create({
      userId: user.id,
      participants: participantsWithTimestamps,
      title: validatedData.title || `Chat with ${context.character.name}`,
      contextSummary: validatedData.scenario || null,
      tags: Array.from(buildResult.tags),
      roleplayTemplateId: defaultRoleplayTemplateId,
      // Timestamp config: use provided value or inherit from user settings
      timestampConfig: validatedData.timestampConfig || chatSettings?.defaultTimestampConfig || null,
      messageCount: 0,
      lastMessageAt: null,
      lastRenameCheckInterchange: 0,
    })

    await createInitialMessages(
      chat.id,
      context,
      participantsWithTimestamps,
      user.id,
      repos
    )

    const enrichedParticipants = await Promise.all(
      chat.participants.map(p => enrichParticipantSummary(p, repos))
    )

    return NextResponse.json({
      chat: { ...chat, participants: enrichedParticipants }
    }, { status: 201 })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation error', details: error.errors },
        { status: 400 }
      )
    }

    logger.error('Error creating chat', { context: 'POST /api/chats' }, error instanceof Error ? error : undefined)
    return NextResponse.json({ error: 'Failed to create chat' }, { status: 500 })
  }
}
