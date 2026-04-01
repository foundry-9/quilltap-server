/**
 * SillyTavern Multi-Character Chat Parser
 *
 * Parses SillyTavern JSONL/JSON chat files and extracts unique speakers
 * for mapping to Quilltap characters and personas.
 */

import type { STMessage } from './chat'

/**
 * A speaker extracted from a SillyTavern chat
 */
export interface ParsedSpeaker {
  /** The speaker's display name from messages */
  name: string
  /** Whether this is a user (persona) or AI (character) speaker */
  isUser: boolean
  /** Avatar path if available */
  avatarPath?: string
  /** Number of messages from this speaker */
  messageCount: number
}

/**
 * Metadata extracted from the first line of a JSONL file
 */
export interface STChatMetadata {
  chatMetadata?: {
    notePrompt?: string
    noteInterval?: number
    noteDepth?: number
    notePosition?: number
    [key: string]: unknown
  }
  characterName?: string
  userName?: string
  createDate?: number
}

/**
 * Result of parsing a SillyTavern chat file
 */
export interface ParseResult {
  /** Unique speakers found in the chat */
  speakers: ParsedSpeaker[]
  /** All messages from the chat */
  messages: STMessage[]
  /** Chat-level metadata */
  metadata: STChatMetadata
  /** Whether this is a group chat */
  isGroupChat: boolean
}

/**
 * Mapping configuration for a single speaker
 */
export interface SpeakerMapping {
  /** The speaker name from the source file */
  speakerName: string
  /** Whether this speaker is a user (persona) */
  isUser: boolean
  /**
   * How to map this speaker
   * Note: 'existing_persona' and 'create_persona' are deprecated.
   * Use 'existing_character' or 'create_character' with controlledBy: 'user' instead.
   */
  mappingType: 'existing_character' | 'existing_persona' | 'create_character' | 'create_persona' | 'skip'
  /** Entity ID for existing mappings */
  entityId?: string
  /** Entity name for display or creation */
  entityName?: string
  /** Connection profile ID (required for LLM-controlled characters) */
  connectionProfileId?: string
  /**
   * Whether this character is controlled by user or LLM
   * Characters Not Personas - Phase 6
   * For user speakers, this should be 'user'. For AI speakers, this should be 'llm'.
   */
  controlledBy?: 'llm' | 'user'
}

/**
 * Full import mapping configuration
 */
export interface ImportMappingConfig {
  /** Mappings for each speaker */
  mappings: SpeakerMapping[]
  /** Default connection profile for new characters */
  defaultConnectionProfileId: string
  /** Whether to trigger title generation after import */
  triggerTitleGeneration?: boolean
}

/**
 * Parse a SillyTavern chat file (JSONL or JSON format)
 *
 * Detection strategy:
 * 1. Try parsing as a single JSON object first
 * 2. If that succeeds and looks like valid chat data, use it
 * 3. Otherwise, fall back to JSONL (line-delimited) parsing
 *
 * This handles cases where files have incorrect extensions (e.g., .jsonl
 * files that actually contain a single JSON object).
 */
export function parseSTFile(content: string, filename: string): ParseResult {
  // Try JSON format first - handles both .json files and .jsonl files
  // that are actually single JSON objects (like Quilltap exports)
  try {
    const data = JSON.parse(content)

    // Check if this looks like valid JSON chat data:
    // - It's an array of messages, OR
    // - It's an object with a messages array
    const hasMessages = Array.isArray(data) || (data && Array.isArray(data.messages))

    if (hasMessages) {
      return parseJSON(content)
    }
  } catch {
    // JSON parse failed, will try JSONL
  }

  // Fall back to JSONL parsing
  return parseJSONL(content)
}

/**
 * Parse JSONL format (line-delimited JSON)
 */
function parseJSONL(content: string): ParseResult {
  const lines = content.trim().split('\n').filter(line => line.trim())

  if (lines.length === 0) {
    throw new Error('Empty JSONL file')
  }

  let metadata: STChatMetadata = {}
  const messages: STMessage[] = []
  let isGroupChat = false

  for (const line of lines) {
    try {
      const obj = JSON.parse(line)

      // First line with chat_metadata is the metadata
      if (obj.chat_metadata && Object.keys(metadata).length === 0) {
        metadata = {
          chatMetadata: obj.chat_metadata,
          characterName: obj.character_name,
          userName: obj.user_name,
          createDate: obj.create_date,
        }
      } else if (obj.mes !== undefined || obj.name !== undefined) {
        // Lines with 'mes' or 'name' field are messages
        messages.push(obj)

        // Check if it's a group chat
        if (obj.is_group === true) {
          isGroupChat = true
        }
      }
    } catch (parseError) {
      // Skipped invalid JSON line
    }
  }

  if (messages.length === 0) {
    throw new Error('No messages found in JSONL file')
  }

  const speakers = extractUniqueSpeakers(messages)

  return { speakers, messages, metadata, isGroupChat }
}

/**
 * Parse JSON format (single JSON object)
 */
function parseJSON(content: string): ParseResult {
  const data = JSON.parse(content)

  // Handle array of messages or object with messages property
  const messages: STMessage[] = Array.isArray(data) ? data : (data.messages || [])

  if (messages.length === 0) {
    throw new Error('No messages found in JSON file')
  }

  const metadata: STChatMetadata = Array.isArray(data) ? {} : {
    chatMetadata: data.chat_metadata,
    characterName: data.character_name,
    userName: data.user_name,
    createDate: data.create_date,
  }

  const isGroupChat = messages.some(msg => msg.is_group === true)
  const speakers = extractUniqueSpeakers(messages)

  return { speakers, messages, metadata, isGroupChat }
}

/**
 * Extract unique speakers from a list of messages
 */
export function extractUniqueSpeakers(messages: STMessage[]): ParsedSpeaker[] {
  const speakerMap = new Map<string, ParsedSpeaker>()

  for (const msg of messages) {
    const name = msg.name
    if (!name) continue

    // Skip empty messages (sometimes used as placeholders)
    if (!msg.mes && msg.mes !== '') continue

    const existing = speakerMap.get(name)

    if (existing) {
      existing.messageCount++
      // Update avatar if we find one and don't have one yet
      if (!existing.avatarPath && (msg.force_avatar || (msg as unknown as Record<string, unknown>).original_avatar)) {
        existing.avatarPath = msg.force_avatar || (msg as unknown as Record<string, unknown>).original_avatar as string
      }
    } else {
      speakerMap.set(name, {
        name,
        isUser: msg.is_user === true,
        avatarPath: msg.force_avatar || (msg as unknown as Record<string, unknown>).original_avatar as string | undefined,
        messageCount: 1,
      })
    }
  }

  // Sort: user speakers first, then by message count descending
  const speakers = Array.from(speakerMap.values())
  speakers.sort((a, b) => {
    if (a.isUser !== b.isUser) {
      return a.isUser ? -1 : 1 // Users first
    }
    return b.messageCount - a.messageCount // Then by message count
  })

  return speakers
}

/**
 * Build a speaker name to entity ID map from mappings
 */
export function buildSpeakerEntityMap(
  mappings: SpeakerMapping[]
): Map<string, { entityId: string; entityType: 'character' | 'persona'; isUser: boolean; controlledBy?: 'llm' | 'user' }> {
  const map = new Map<string, { entityId: string; entityType: 'character' | 'persona'; isUser: boolean; controlledBy?: 'llm' | 'user' }>()

  for (const mapping of mappings) {
    if (mapping.mappingType === 'skip' || !mapping.entityId) {
      continue
    }

    // Determine entity type - new approach treats user speakers as user-controlled characters
    const entityType = mapping.mappingType.includes('character') ? 'character' : 'persona'
    // Determine controlledBy - user speakers should be user-controlled
    const controlledBy = mapping.controlledBy || (mapping.isUser ? 'user' : 'llm')

    map.set(mapping.speakerName, {
      entityId: mapping.entityId,
      entityType,
      isUser: mapping.isUser,
      controlledBy,
    })
  }

  return map
}

/**
 * Create default mappings for speakers (for initial UI state)
 *
 * Characters Not Personas - Phase 6:
 * Both user speakers and AI speakers are now mapped to characters.
 * User speakers get controlledBy: 'user', AI speakers get controlledBy: 'llm'.
 *
 * For backwards compatibility, we still check existing personas but prefer
 * existing characters. New creations always create characters.
 */
export function createDefaultMappings(
  speakers: ParsedSpeaker[],
  existingCharacters: Array<{ id: string; name: string; controlledBy?: 'llm' | 'user' }>,
  existingPersonas: Array<{ id: string; name: string }>
): SpeakerMapping[] {
  return speakers.map(speaker => {
    if (speaker.isUser) {
      // First, try to find a matching user-controlled character
      const matchingCharacter = existingCharacters.find(
        c => c.name.toLowerCase() === speaker.name.toLowerCase() && c.controlledBy === 'user'
      )

      if (matchingCharacter) {
        return {
          speakerName: speaker.name,
          isUser: true,
          mappingType: 'existing_character' as const,
          entityId: matchingCharacter.id,
          entityName: matchingCharacter.name,
          controlledBy: 'user' as const,
        }
      }

      // Fallback: Try to find a matching persona (for backwards compatibility)
      const matchingPersona = existingPersonas.find(
        p => p.name.toLowerCase() === speaker.name.toLowerCase()
      )

      if (matchingPersona) {
        return {
          speakerName: speaker.name,
          isUser: true,
          mappingType: 'existing_persona' as const,
          entityId: matchingPersona.id,
          entityName: matchingPersona.name,
          controlledBy: 'user' as const,
        }
      }

      // Default to creating a new user-controlled character (not persona)
      return {
        speakerName: speaker.name,
        isUser: true,
        mappingType: 'create_character' as const,
        entityName: speaker.name,
        controlledBy: 'user' as const,
      }
    } else {
      // Try to find a matching LLM-controlled character by name
      const matchingCharacter = existingCharacters.find(
        c => c.name.toLowerCase() === speaker.name.toLowerCase() && c.controlledBy !== 'user'
      )

      if (matchingCharacter) {
        return {
          speakerName: speaker.name,
          isUser: false,
          mappingType: 'existing_character' as const,
          entityId: matchingCharacter.id,
          entityName: matchingCharacter.name,
          controlledBy: 'llm' as const,
        }
      }

      // Fallback: Try any character with matching name
      const anyMatchingCharacter = existingCharacters.find(
        c => c.name.toLowerCase() === speaker.name.toLowerCase()
      )

      if (anyMatchingCharacter) {
        return {
          speakerName: speaker.name,
          isUser: false,
          mappingType: 'existing_character' as const,
          entityId: anyMatchingCharacter.id,
          entityName: anyMatchingCharacter.name,
          controlledBy: 'llm' as const,
        }
      }

      // Default to creating a new LLM-controlled character
      return {
        speakerName: speaker.name,
        isUser: false,
        mappingType: 'create_character' as const,
        entityName: speaker.name,
        controlledBy: 'llm' as const,
      }
    }
  })
}

/**
 * Validate that all required mappings have the necessary fields
 *
 * Characters Not Personas - Phase 6:
 * User-controlled characters (controlledBy: 'user') do NOT require a connection profile.
 * LLM-controlled characters still require one.
 */
export function validateMappings(
  mappings: SpeakerMapping[],
  defaultConnectionProfileId: string
): { valid: boolean; errors: string[] } {
  const errors: string[] = []

  // Must have at least one non-skipped LLM-controlled character
  const hasLLMCharacter = mappings.some(
    m => m.mappingType !== 'skip' && !m.isUser && m.controlledBy !== 'user'
  )
  if (!hasLLMCharacter) {
    errors.push('At least one AI-controlled character must be mapped')
  }

  // Check each mapping
  for (const mapping of mappings) {
    if (mapping.mappingType === 'skip') {
      continue
    }

    // Existing mappings need an entityId
    if (mapping.mappingType.startsWith('existing_') && !mapping.entityId) {
      errors.push(`${mapping.speakerName}: Must select an existing entity`)
    }

    // Only LLM-controlled character mappings need a connection profile
    // User-controlled characters don't need one since they're user-controlled
    if (mapping.mappingType.includes('character') && mapping.controlledBy !== 'user') {
      const profileId = mapping.connectionProfileId || defaultConnectionProfileId
      if (!profileId) {
        errors.push(`${mapping.speakerName}: AI character requires a connection profile`)
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  }
}
