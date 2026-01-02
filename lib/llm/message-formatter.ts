/**
 * Message Formatter Utility
 * Phase 3: Multi-Character Context Building
 *
 * Handles provider-aware message formatting for multi-character chats.
 * Provides name field support or content prefix fallback depending on provider.
 *
 * NOTE: Registered plugins provide message format support via messageFormat.
 * The legacy fallback constants are imported from fallback-data.ts and used
 * only when no plugin is registered for a provider.
 *
 * @see lib/llm/fallback-data.ts for legacy fallback constants
 */

import { Provider } from '@/lib/schemas/types'
import { logger } from '@/lib/logger'
import { getMessageFormat } from '@/lib/plugins/provider-registry'
import {
  LEGACY_PROVIDER_NAME_SUPPORT,
  type LegacyProviderNameSupport,
} from './fallback-data'

/**
 * Provider capabilities for name field support
 */
export interface ProviderNameSupport {
  /** Whether the provider supports a name field on messages */
  supportsNameField: boolean
  /** Which roles support the name field */
  supportedRoles: ('user' | 'assistant')[]
  /** Maximum length for name field (if limited) */
  maxNameLength?: number
}

/**
 * Provider-specific name field support information
 * Re-exported from fallback-data.ts for backward compatibility
 *
 * @deprecated Use getMessageFormat() from provider-registry instead
 */
const PROVIDER_NAME_SUPPORT: Record<string, ProviderNameSupport> =
  LEGACY_PROVIDER_NAME_SUPPORT as Record<string, ProviderNameSupport>

/**
 * Get name field support info for a provider
 */
export function getProviderNameSupport(provider: Provider): ProviderNameSupport {
  // First try the plugin registry (plugins register their own message format support)
  const pluginFormat = getMessageFormat(provider)
  if (pluginFormat.supportsNameField || pluginFormat.supportedRoles.length > 0) {
    return pluginFormat
  }

  // Fall back to hardcoded support for known providers
  const normalized = provider.toUpperCase()
  const support = PROVIDER_NAME_SUPPORT[normalized]

  if (!support) {
    logger.debug('[MessageFormatter] Unknown provider, using conservative default (no name field)', {
      provider,
    })
    return {
      supportsNameField: false,
      supportedRoles: [],
    }
  }

  return support
}

/**
 * Check if a provider supports the name field for a given role
 */
export function supportsNameField(provider: Provider, role: 'user' | 'assistant'): boolean {
  const support = getProviderNameSupport(provider)
  return support.supportsNameField && support.supportedRoles.includes(role)
}

/**
 * Format a participant name for use in the name field or content prefix
 * Sanitizes and truncates as needed
 */
export function formatParticipantName(name: string, maxLength: number = 64): string {
  // Remove or replace characters that might cause issues
  // OpenAI name field: a-zA-Z0-9_- only, no spaces
  const sanitized = name
    .trim()
    // Replace spaces with underscores
    .replace(/\s+/g, '_')
    // Remove any characters that aren't alphanumeric, underscore, or hyphen
    .replace(/[^a-zA-Z0-9_-]/g, '')
    // Truncate to max length
    .slice(0, maxLength)

  // Ensure we have at least something
  return sanitized || 'Unknown'
}

/**
 * Format a display name for content prefix (more lenient than name field)
 */
export function formatDisplayName(name: string): string {
  return name.trim() || 'Unknown'
}

/**
 * Message with optional name and participant info for multi-character context
 */
export interface MultiCharacterMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
  /** Name of the participant (character or persona) */
  name?: string
  /** Participant ID for tracking */
  participantId?: string
  /** Google Gemini thought signature */
  thoughtSignature?: string | null
}

/**
 * Format messages for a provider, applying name field or content prefix as needed
 *
 * @param messages Array of messages with optional names
 * @param provider The LLM provider
 * @param respondingCharacterName Name of the character who will respond (their messages become 'assistant')
 * @returns Formatted messages ready for the provider
 */
export function formatMessagesForProvider(
  messages: MultiCharacterMessage[],
  provider: Provider,
  respondingCharacterName: string
): Array<{
  role: 'system' | 'user' | 'assistant'
  content: string
  name?: string
  thoughtSignature?: string
}> {
  const nameSupport = getProviderNameSupport(provider)

  logger.debug('[MessageFormatter] Formatting messages for provider', {
    provider,
    messageCount: messages.length,
    supportsNameField: nameSupport.supportsNameField,
    respondingCharacterName,
  })

  return messages.map((msg) => {
    // System messages don't get name attribution
    if (msg.role === 'system') {
      return {
        role: msg.role,
        content: msg.content,
        thoughtSignature: msg.thoughtSignature ?? undefined,
      }
    }

    // No name to attribute - return as is
    if (!msg.name) {
      return {
        role: msg.role,
        content: msg.content,
        thoughtSignature: msg.thoughtSignature ?? undefined,
      }
    }

    const roleForProvider = msg.role === 'assistant' ? 'assistant' : 'user'

    // Check if provider supports name field for this role
    if (nameSupport.supportsNameField && nameSupport.supportedRoles.includes(roleForProvider)) {
      // Use native name field
      const formattedName = formatParticipantName(msg.name, nameSupport.maxNameLength)
      return {
        role: roleForProvider,
        content: msg.content,
        name: formattedName,
        thoughtSignature: msg.thoughtSignature ?? undefined,
      }
    }

    // Fallback: prefix content with [Name]
    // Only add prefix if it's a multi-character scenario (i.e., the name matters)
    const displayName = formatDisplayName(msg.name)

    // Check if content already has this name prefix to avoid duplication
    // Pattern: content starts with [Name] where Name matches (case-insensitive)
    const existingPrefixPattern = new RegExp(`^\\[${displayName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\]\\s*`, 'i')
    const alreadyPrefixed = existingPrefixPattern.test(msg.content)

    const prefixedContent = alreadyPrefixed ? msg.content : `[${displayName}] ${msg.content}`

    if (alreadyPrefixed) {
      logger.debug('[MessageFormatter] Skipping duplicate name prefix', {
        name: displayName,
        contentPreview: msg.content.slice(0, 50),
      })
    }

    return {
      role: roleForProvider,
      content: prefixedContent,
      thoughtSignature: msg.thoughtSignature ?? undefined,
    }
  })
}

/**
 * Build a multi-character context description for the system prompt
 *
 * @param otherParticipants Array of other participants (name and brief description)
 * @param respondingCharacterName Name of the character who will respond
 * @returns String to append to system prompt
 */
export function buildMultiCharacterContextSection(
  otherParticipants: Array<{ name: string; description?: string; type: 'CHARACTER' | 'PERSONA' }>,
  respondingCharacterName: string
): string {
  if (otherParticipants.length === 0) {
    return ''
  }

  const lines: string[] = [
    '',
    '## Other Participants in This Conversation',
    '',
  ]

  for (const participant of otherParticipants) {
    const typeLabel = participant.type === 'PERSONA' ? '(the user)' : ''
    const description = participant.description ? ` - ${participant.description}` : ''
    lines.push(`- **${participant.name}** ${typeLabel}${description}`)
  }

  lines.push('')
  lines.push(
    `You are ${respondingCharacterName}. Stay in character when responding to the other participants. ` +
    `Messages from other characters and the user will be marked with their names. ` +
    `Your responses will be attributed to you (${respondingCharacterName}).`
  )

  return lines.join('\n')
}

/**
 * Strip character name prefixes from the beginning of a response
 *
 * LLMs sometimes mimic the [Name] prefix format from the input in their responses.
 * This function removes any such prefixes from the start of the response,
 * including multiple occurrences across newlines.
 *
 * @param content The response content to clean
 * @param characterName The responding character's name (to specifically target)
 * @returns Cleaned content without leading name prefixes
 */
export function stripCharacterNamePrefix(content: string, characterName?: string): string {
  if (!content) return content

  // If we know the specific character name, build a specific pattern
  // Otherwise, use a general pattern to match any [Name] prefix
  let result = content

  // Pattern to match [Name] at the start, possibly across multiple lines
  // Matches: [Name], [Name]\n, [Name] \n, [Name]\n\n, etc.
  // The name can contain letters, numbers, spaces, and common punctuation
  const generalPrefixPattern = /^\s*\[[^\]]+\]\s*/

  // If we have a specific character name, also build a specific pattern
  // that's more targeted (case-insensitive)
  let specificPattern: RegExp | null = null
  if (characterName) {
    const escapedName = characterName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    specificPattern = new RegExp(`^\\s*\\[${escapedName}\\]\\s*`, 'i')
  }

  // Keep stripping prefixes until we don't find any more
  // This handles cases like "[Name]\n[Name]\n[Name]\n*content*"
  let previousLength = -1
  let iterations = 0
  const MAX_ITERATIONS = 10 // Safety limit

  while (result.length !== previousLength && iterations < MAX_ITERATIONS) {
    previousLength = result.length
    iterations++

    // Try specific pattern first (if available)
    if (specificPattern && specificPattern.test(result)) {
      result = result.replace(specificPattern, '')
      continue
    }

    // Then try general pattern
    if (generalPrefixPattern.test(result)) {
      result = result.replace(generalPrefixPattern, '')
      continue
    }

    // No more prefixes found
    break
  }

  if (iterations > 1) {
    logger.debug('[MessageFormatter] Stripped character name prefixes from response', {
      characterName,
      prefixesStripped: iterations - 1,
      originalLength: content.length,
      resultLength: result.length,
    })
  }

  return result
}
