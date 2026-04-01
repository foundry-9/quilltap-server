/**
 * SillyTavern Multi-Character Chat Parser
 *
 * Parses SillyTavern JSONL/JSON chat files and extracts unique speakers
 * for mapping to Quilltap characters and personas.
 *
 * Note: This module is used by both client and server code, so it uses
 * the client logger for browser compatibility.
 */

import { clientLogger } from '@/lib/client-logger'
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
  /** How to map this speaker */
  mappingType: 'existing_character' | 'existing_persona' | 'create_character' | 'create_persona' | 'skip'
  /** Entity ID for existing mappings */
  entityId?: string
  /** Entity name for display or creation */
  entityName?: string
  /** Connection profile ID (required for characters) */
  connectionProfileId?: string
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
  clientLogger.debug('[MultiCharParser] Parsing file', { filename, contentLength: content.length })

  // Try JSON format first - handles both .json files and .jsonl files
  // that are actually single JSON objects (like Quilltap exports)
  try {
    const data = JSON.parse(content)

    // Check if this looks like valid JSON chat data:
    // - It's an array of messages, OR
    // - It's an object with a messages array
    const hasMessages = Array.isArray(data) || (data && Array.isArray(data.messages))

    if (hasMessages) {
      clientLogger.debug('[MultiCharParser] Detected JSON format', { filename })
      return parseJSON(content)
    }
  } catch {
    // JSON parse failed, will try JSONL
    clientLogger.debug('[MultiCharParser] JSON parse failed, trying JSONL', { filename })
  }

  // Fall back to JSONL parsing
  clientLogger.debug('[MultiCharParser] Using JSONL format', { filename })
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
      clientLogger.warn('[MultiCharParser] Skipped invalid JSON line', {
        linePreview: line.substring(0, 50),
        error: String(parseError)
      })
    }
  }

  if (messages.length === 0) {
    throw new Error('No messages found in JSONL file')
  }

  const speakers = extractUniqueSpeakers(messages)

  clientLogger.info('[MultiCharParser] Parsed JSONL file', {
    messageCount: messages.length,
    speakerCount: speakers.length,
    isGroupChat,
    speakers: speakers.map(s => ({ name: s.name, isUser: s.isUser, count: s.messageCount }))
  })

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

  clientLogger.info('[MultiCharParser] Parsed JSON file', {
    messageCount: messages.length,
    speakerCount: speakers.length,
    isGroupChat,
    speakers: speakers.map(s => ({ name: s.name, isUser: s.isUser, count: s.messageCount }))
  })

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
): Map<string, { entityId: string; entityType: 'character' | 'persona'; isUser: boolean }> {
  const map = new Map<string, { entityId: string; entityType: 'character' | 'persona'; isUser: boolean }>()

  for (const mapping of mappings) {
    if (mapping.mappingType === 'skip' || !mapping.entityId) {
      continue
    }

    const entityType = mapping.mappingType.includes('character') ? 'character' : 'persona'

    map.set(mapping.speakerName, {
      entityId: mapping.entityId,
      entityType,
      isUser: mapping.isUser,
    })
  }

  return map
}

/**
 * Create default mappings for speakers (for initial UI state)
 *
 * For user speakers (isUser=true): suggest existing persona or create persona
 * For AI speakers (isUser=false): suggest existing character or create character
 */
export function createDefaultMappings(
  speakers: ParsedSpeaker[],
  existingCharacters: Array<{ id: string; name: string }>,
  existingPersonas: Array<{ id: string; name: string }>
): SpeakerMapping[] {
  return speakers.map(speaker => {
    if (speaker.isUser) {
      // Try to find a matching persona by name
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
        }
      }

      // Default to creating a new persona
      return {
        speakerName: speaker.name,
        isUser: true,
        mappingType: 'create_persona' as const,
        entityName: speaker.name,
      }
    } else {
      // Try to find a matching character by name
      const matchingCharacter = existingCharacters.find(
        c => c.name.toLowerCase() === speaker.name.toLowerCase()
      )

      if (matchingCharacter) {
        return {
          speakerName: speaker.name,
          isUser: false,
          mappingType: 'existing_character' as const,
          entityId: matchingCharacter.id,
          entityName: matchingCharacter.name,
        }
      }

      // Default to creating a new character
      return {
        speakerName: speaker.name,
        isUser: false,
        mappingType: 'create_character' as const,
        entityName: speaker.name,
      }
    }
  })
}

/**
 * Validate that all required mappings have the necessary fields
 */
export function validateMappings(
  mappings: SpeakerMapping[],
  defaultConnectionProfileId: string
): { valid: boolean; errors: string[] } {
  const errors: string[] = []

  // Must have at least one non-skipped character
  const hasCharacter = mappings.some(
    m => m.mappingType !== 'skip' && !m.isUser
  )
  if (!hasCharacter) {
    errors.push('At least one AI character must be mapped')
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

    // Character mappings need a connection profile
    if (mapping.mappingType.includes('character')) {
      const profileId = mapping.connectionProfileId || defaultConnectionProfileId
      if (!profileId) {
        errors.push(`${mapping.speakerName}: Character requires a connection profile`)
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  }
}
