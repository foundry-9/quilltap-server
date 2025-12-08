/**
 * Message Formatter Utility
 * Phase 3: Multi-Character Context Building
 *
 * Handles provider-aware message formatting for multi-character chats.
 * Provides name field support or content prefix fallback depending on provider.
 */

import { Provider } from '@/lib/schemas/types'
import { logger } from '@/lib/logger'

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
 * Based on API documentation as of late 2024/early 2025
 */
const PROVIDER_NAME_SUPPORT: Record<string, ProviderNameSupport> = {
  // OpenAI supports name field on both user and assistant messages
  OPENAI: {
    supportsNameField: true,
    supportedRoles: ['user', 'assistant'],
    maxNameLength: 64,
  },
  // Anthropic does NOT support name field in the standard API
  // We'll use content prefix fallback
  ANTHROPIC: {
    supportsNameField: false,
    supportedRoles: [],
  },
  // Google/Gemini does NOT support name field
  // We'll use content prefix fallback
  GOOGLE: {
    supportsNameField: false,
    supportedRoles: [],
  },
  // OpenRouter passes through to underlying provider, assume no name support for safety
  OPENROUTER: {
    supportsNameField: false,
    supportedRoles: [],
  },
  // xAI/Grok uses OpenAI-compatible format
  GROK: {
    supportsNameField: true,
    supportedRoles: ['user', 'assistant'],
    maxNameLength: 64,
  },
  // Ollama uses OpenAI-compatible format but name support varies by model
  OLLAMA: {
    supportsNameField: false, // Conservative default
    supportedRoles: [],
  },
  // OpenAI Compatible providers - assume OpenAI behavior
  'OPENAI-COMPATIBLE': {
    supportsNameField: true,
    supportedRoles: ['user', 'assistant'],
    maxNameLength: 64,
  },
  // Gab.AI - assume no name support
  'GAB-AI': {
    supportsNameField: false,
    supportedRoles: [],
  },
}

/**
 * Get name field support info for a provider
 */
export function getProviderNameSupport(provider: Provider): ProviderNameSupport {
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
    const prefixedContent = `[${displayName}] ${msg.content}`

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
