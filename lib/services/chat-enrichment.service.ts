/**
 * Chat Enrichment Service
 *
 * Consolidates duplicated enrichment functions from:
 * - app/api/chats/route.ts (getCharacterSummary, enrichParticipantSummary)
 * - app/api/chats/[id]/route.ts (getEnrichedCharacter, enrichParticipant)
 *
 * Provides unified enrichment for chat participants with options for different view modes.
 */

import type { ChatParticipantBase, ChatMetadata } from '@/lib/schemas/types'
import type { RepositoryContainer } from '@/lib/repositories/factory'
import { getFilePath } from '@/lib/api/middleware/file-path'
import { logger } from '@/lib/logger'

type Repos = RepositoryContainer

// ============================================================================
// Types
// ============================================================================

/**
 * Image info for enriched entities
 */
export interface EnrichedImage {
  id: string
  filepath: string
  url: string | null
}

/**
 * Base character info shared between summary and detailed views
 */
export interface EnrichedCharacterBase {
  id: string
  name: string
  title: string | null
  avatarUrl: string | null
  defaultImageId: string | null
  defaultImage: EnrichedImage | null
}

/**
 * Character info for list/summary view (includes tags)
 */
export interface EnrichedCharacterSummary extends EnrichedCharacterBase {
  tags: string[]
}

/**
 * Character info for detail view (no tags, used with full participant)
 */
export type EnrichedCharacterDetail = EnrichedCharacterBase


/**
 * Connection profile info for detailed participant view
 */
export interface EnrichedConnectionProfile {
  id: string
  name: string
  provider: string
  modelName: string
  apiKey: {
    id: string
    provider: string
    label: string
  } | null
}

/**
 * Image profile info for detailed participant view
 */
export interface EnrichedImageProfile {
  id: string
  name: string
  provider: string
  modelName: string
}

/**
 * Participant info for list/summary view (simpler, for chat lists)
 */
export interface EnrichedParticipantSummary {
  id: string
  type: 'CHARACTER'
  displayOrder: number
  isActive: boolean
  character: EnrichedCharacterSummary | null
}

/**
 * Participant info for detail view (fuller, for single chat view)
 */
export interface EnrichedParticipantDetail {
  id: string
  type: 'CHARACTER'
  controlledBy: 'llm' | 'user'
  displayOrder: number
  isActive: boolean
  systemPromptOverride: string | null
  character: EnrichedCharacterDetail | null
  connectionProfile: EnrichedConnectionProfile | null
  imageProfile: EnrichedImageProfile | null
  createdAt: string
  updatedAt: string
}

/**
 * Tag info for enriched chats
 */
export interface EnrichedTag {
  tag: {
    id: string
    name: string
  }
}

/**
 * Project info for enriched chats
 */
export interface EnrichedProject {
  id: string
  name: string
  color: string | null
}

/**
 * Enriched chat for list view
 */
export interface EnrichedChatSummary {
  id: string
  title: string
  contextSummary: string | null
  createdAt: string
  updatedAt: string
  participants: EnrichedParticipantSummary[]
  tags: EnrichedTag[]
  project: EnrichedProject | null
  _count: { messages: number }
  _allTagIds: string[] // Internal field for filtering
}

// ============================================================================
// Character Enrichment
// ============================================================================

/**
 * Get enriched character info for list/summary view (includes tags)
 */
export async function getCharacterSummary(
  characterId: string,
  repos: Repos
): Promise<EnrichedCharacterSummary | null> {
  const character = await repos.characters.findById(characterId)
  if (!character) {
    logger.debug('Character not found for enrichment', { characterId })
    return null
  }

  let defaultImage: EnrichedImage | null = null
  if (character.defaultImageId) {
    const fileEntry = await repos.files.findById(character.defaultImageId)
    if (fileEntry) {
      defaultImage = { id: fileEntry.id, filepath: getFilePath(fileEntry), url: null }
    }
  }

  return {
    id: character.id,
    name: character.name,
    title: character.title ?? null,
    avatarUrl: character.avatarUrl ?? null,
    defaultImageId: character.defaultImageId ?? null,
    defaultImage,
    tags: character.tags || [],
  }
}

/**
 * Get enriched character info for detail view (no tags)
 */
export async function getCharacterDetail(
  characterId: string,
  repos: Repos
): Promise<EnrichedCharacterDetail | null> {
  const character = await repos.characters.findById(characterId)
  if (!character) {
    logger.debug('Character not found for enrichment', { characterId })
    return null
  }

  let defaultImage: EnrichedImage | null = null
  if (character.defaultImageId) {
    const fileEntry = await repos.files.findById(character.defaultImageId)
    if (fileEntry) {
      defaultImage = { id: fileEntry.id, filepath: getFilePath(fileEntry), url: null }
    }
  }

  return {
    id: character.id,
    name: character.name,
    title: character.title ?? null,
    avatarUrl: character.avatarUrl ?? null,
    defaultImageId: character.defaultImageId ?? null,
    defaultImage,
  }
}


// ============================================================================
// Profile Enrichment (for detail view)
// ============================================================================

/**
 * Get enriched connection profile info
 */
export async function getConnectionProfile(
  profileId: string,
  repos: Repos
): Promise<EnrichedConnectionProfile | null> {
  const profile = await repos.connections.findById(profileId)
  if (!profile) {
    logger.debug('Connection profile not found for enrichment', { profileId })
    return null
  }

  let apiKeyInfo: EnrichedConnectionProfile['apiKey'] = null
  if (profile.apiKeyId) {
    const apiKey = await repos.connections.findApiKeyById(profile.apiKeyId)
    if (apiKey) {
      apiKeyInfo = { id: apiKey.id, provider: apiKey.provider, label: apiKey.label }
    }
  }

  return {
    id: profile.id,
    name: profile.name,
    provider: profile.provider,
    modelName: profile.modelName,
    apiKey: apiKeyInfo,
  }
}

/**
 * Get enriched image profile info
 */
export async function getImageProfile(
  profileId: string,
  repos: Repos
): Promise<EnrichedImageProfile | null> {
  const imgProfile = await repos.imageProfiles.findById(profileId)
  if (!imgProfile) {
    logger.debug('Image profile not found for enrichment', { profileId })
    return null
  }

  return {
    id: imgProfile.id,
    name: imgProfile.name,
    provider: imgProfile.provider,
    modelName: imgProfile.modelName,
  }
}

// ============================================================================
// Participant Enrichment
// ============================================================================

/**
 * Enrich participant for list/summary view (simpler output)
 */
export async function enrichParticipantSummary(
  participant: ChatParticipantBase,
  repos: Repos
): Promise<EnrichedParticipantSummary> {
  const character = participant.type === 'CHARACTER' && participant.characterId
    ? await getCharacterSummary(participant.characterId, repos)
    : null

  return {
    id: participant.id,
    type: participant.type,
    displayOrder: participant.displayOrder,
    isActive: participant.isActive,
    character,
  }
}

/**
 * Enrich participant for detail view (fuller output with profiles)
 */
export async function enrichParticipantDetail(
  participant: ChatParticipantBase,
  repos: Repos
): Promise<EnrichedParticipantDetail> {
  const character = participant.type === 'CHARACTER' && participant.characterId
    ? await getCharacterDetail(participant.characterId, repos)
    : null

  const connectionProfile = participant.connectionProfileId
    ? await getConnectionProfile(participant.connectionProfileId, repos)
    : null

  const imageProfile = participant.imageProfileId
    ? await getImageProfile(participant.imageProfileId, repos)
    : null

  return {
    id: participant.id,
    type: participant.type,
    controlledBy: participant.controlledBy || 'llm',
    displayOrder: participant.displayOrder,
    isActive: participant.isActive,
    systemPromptOverride: participant.systemPromptOverride ?? null,
    character,
    connectionProfile,
    imageProfile,
    createdAt: participant.createdAt,
    updatedAt: participant.updatedAt,
  }
}

// ============================================================================
// Tag Enrichment
// ============================================================================

/**
 * Enrich tag IDs to full tag objects (batched)
 * Uses a single query to fetch all tags for efficiency.
 */
export async function enrichTags(
  tagIds: string[],
  repos: Repos
): Promise<EnrichedTag[]> {
  if (tagIds.length === 0) {
    return []
  }

  // Use batched query instead of N+1 individual queries
  const tags = await repos.tags.findByIds(tagIds)

  // Map to enriched format, preserving order from input tagIds
  const tagMap = new Map(tags.map(tag => [tag.id, tag]))
  const enriched: EnrichedTag[] = []

  for (const tagId of tagIds) {
    const tag = tagMap.get(tagId)
    if (tag) {
      enriched.push({ tag: { id: tag.id, name: tag.name } })
    }
  }

  return enriched
}

// ============================================================================
// Chat Enrichment
// ============================================================================

/**
 * Enrich a chat with participants for list/summary view
 */
export async function enrichChatForList(
  chat: ChatMetadata,
  repos: Repos
): Promise<EnrichedChatSummary> {
  // Enrich participants
  const participants = await Promise.all(
    chat.participants.map(p => enrichParticipantSummary(p, repos))
  )

  // Get tags
  const tags = await enrichTags(chat.tags, repos)

  // Get message count
  const messageCount = await repos.chats.getMessageCount(chat.id)

  // Get project info if chat belongs to a project
  let project: EnrichedProject | null = null
  if (chat.projectId) {
    const projectData = await repos.projects.findById(chat.projectId)
    if (projectData) {
      project = {
        id: projectData.id,
        name: projectData.name,
        color: projectData.color ?? null,
      }
    }
  }

  // Collect all tag IDs from chat and characters for filtering
  const allTagIds: string[] = [...chat.tags]
  for (const participant of participants) {
    if (participant.character?.tags) {
      allTagIds.push(...participant.character.tags)
    }
  }

  return {
    id: chat.id,
    title: chat.title,
    contextSummary: chat.contextSummary ?? null,
    createdAt: chat.createdAt,
    updatedAt: chat.updatedAt,
    participants,
    tags,
    project,
    _count: { messages: messageCount },
    _allTagIds: allTagIds,
  }
}

/**
 * Enrich multiple chats for list view with sorting
 */
export async function enrichChatsForList(
  chats: ChatMetadata[],
  repos: Repos
): Promise<EnrichedChatSummary[]> {
  // Sort by updatedAt descending
  const sortedChats = [...chats].sort((a, b) =>
    new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  )

  return Promise.all(sortedChats.map(chat => enrichChatForList(chat, repos)))
}

/**
 * Filter enriched chats by excluded tag IDs
 */
export function filterChatsByExcludedTags(
  chats: EnrichedChatSummary[],
  excludeTagIds: string[]
): EnrichedChatSummary[] {
  if (excludeTagIds.length === 0) {
    return chats
  }

  const excludeSet = new Set(excludeTagIds)
  return chats.filter(chat => {
    const hasExcludedTag = chat._allTagIds.some(tagId => excludeSet.has(tagId))
    return !hasExcludedTag
  })
}

/**
 * Remove internal fields from enriched chats before returning
 */
export function cleanEnrichedChats<T extends EnrichedChatSummary>(
  chats: T[]
): Omit<T, '_allTagIds'>[] {
  return chats.map(({ _allTagIds, ...chat }) => chat)
}
