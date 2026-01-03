/**
 * System Prompt Builder
 *
 * Builds system prompts for characters in both single-character
 * and multi-character chat scenarios.
 */

import type { Character, Persona, ChatParticipantBase, TimestampConfig } from '@/lib/schemas/types'
import { calculateCurrentTimestamp, shouldInjectTimestamp, formatTimestampForSystemPrompt } from '@/lib/chat/timestamp-utils'
import { buildMultiCharacterContextSection } from '@/lib/llm/message-formatter'
import { logger } from '@/lib/logger'
import { processTemplate, type TemplateContext } from '@/lib/templates/processor'

/**
 * Other participant info for multi-character system prompts
 */
export interface OtherParticipantInfo {
  name: string
  description?: string
  type: 'CHARACTER' | 'PERSONA'
}

/**
 * Project context for system prompts
 */
export interface ProjectContext {
  name: string
  description?: string | null
  instructions?: string | null
}

/**
 * Build the system prompt for a character
 * Supports both single-character and multi-character scenarios
 * Processes {{char}}, {{user}}, and other template variables in all prompts
 */
export function buildSystemPrompt(
  character: Character,
  persona?: { name: string; description: string } | null,
  systemPromptOverride?: string | null,
  /** For multi-character chats: info about other participants */
  otherParticipants?: OtherParticipantInfo[],
  /** Roleplay template to prepend (formatting instructions) */
  roleplayTemplate?: { systemPrompt: string } | null,
  /** Pseudo-tool instructions for models without native function calling */
  pseudoToolInstructions?: string,
  /** Selected system prompt ID from character's systemPrompts array */
  selectedSystemPromptId?: string | null,
  /** Timestamp configuration for injection */
  timestampConfig?: TimestampConfig | null,
  /** Whether this is the first message (for START_ONLY mode) */
  isInitialMessage?: boolean,
  /** Project context to include in system prompt */
  projectContext?: ProjectContext | null
): string {
  const parts: string[] = []

  // Build template context for {{char}}, {{user}}, etc. replacement
  const templateContext: TemplateContext = {
    char: character.name,
    user: persona?.name || 'User',
    description: character.description || '',
    personality: character.personality || '',
    scenario: character.scenario || '',
    persona: persona?.description || '',
  }

  // Handle timestamp injection
  if (timestampConfig && shouldInjectTimestamp(timestampConfig, isInitialMessage ?? false)) {
    const timestamp = calculateCurrentTimestamp(timestampConfig)
    logger.debug('[SystemPromptBuilder] Injecting timestamp into system prompt', {
      mode: timestampConfig.mode,
      format: timestampConfig.format,
      isFictional: timestamp.isFictional,
      formatted: timestamp.formatted,
      autoPrepend: timestampConfig.autoPrepend,
    })

    if (timestampConfig.autoPrepend) {
      // Add timestamp as the first part of the system prompt
      parts.push(formatTimestampForSystemPrompt(timestamp, true))
    } else {
      // Add to template context for {{timestamp}} variable
      templateContext.timestamp = timestamp.formatted
    }
  }

  logger.debug('[SystemPromptBuilder] Building system prompt with template context', {
    characterName: templateContext.char,
    userName: templateContext.user,
    hasTimestamp: !!templateContext.timestamp,
  })

  // Roleplay template system prompt (formatting instructions) - prepended first
  // Process templates to replace {{char}} and {{user}}
  if (roleplayTemplate?.systemPrompt) {
    const processedRoleplayPrompt = processTemplate(roleplayTemplate.systemPrompt, templateContext)
    logger.debug('Prepending roleplay template to system prompt', {
      templatePromptLength: roleplayTemplate.systemPrompt.length,
      processedLength: processedRoleplayPrompt.length,
      hasTemplateVars: roleplayTemplate.systemPrompt.includes('{{'),
    })
    parts.push(processedRoleplayPrompt)
  }

  // Pseudo-tool instructions (for models without native function calling)
  // Added after roleplay template so tool usage instructions are seen early
  // Note: These typically don't contain {{char}}/{{user}} but process anyway for consistency
  if (pseudoToolInstructions) {
    const processedToolInstructions = processTemplate(pseudoToolInstructions, templateContext)
    logger.debug('[SystemPromptBuilder] Adding pseudo-tool instructions', {
      instructionsLength: pseudoToolInstructions.length,
    })
    parts.push(processedToolInstructions)
  }

  // Project context (if chat is associated with a project)
  // Added before character's system prompt so project instructions set the context
  if (projectContext) {
    const projectParts: string[] = [`## Project Context: ${projectContext.name}`]

    if (projectContext.description) {
      projectParts.push(projectContext.description)
    }

    if (projectContext.instructions) {
      const processedInstructions = processTemplate(projectContext.instructions, templateContext)
      projectParts.push(`\n### Project Instructions\n${processedInstructions}`)
    }

    logger.debug('[SystemPromptBuilder] Adding project context', {
      projectName: projectContext.name,
      hasDescription: !!projectContext.description,
      hasInstructions: !!projectContext.instructions,
    })

    parts.push(projectParts.join('\n'))
  }

  // Base system prompt - priority: override > selected prompt > default systemPrompt
  if (systemPromptOverride) {
    const processedOverride = processTemplate(systemPromptOverride, templateContext)
    logger.debug('[SystemPromptBuilder] Using system prompt override', {
      overrideLength: systemPromptOverride.length,
      processedLength: processedOverride.length,
    })
    parts.push(processedOverride)
  } else {
    // Check for selected system prompt from character's prompts array
    let systemPromptContent: string | null = null

    if (selectedSystemPromptId && character.systemPrompts) {
      const selectedPrompt = character.systemPrompts.find(p => p.id === selectedSystemPromptId)
      if (selectedPrompt) {
        systemPromptContent = selectedPrompt.content
        logger.debug('[SystemPromptBuilder] Using selected system prompt', {
          characterId: character.id,
          promptId: selectedSystemPromptId,
          promptName: selectedPrompt.name,
          contentLength: selectedPrompt.content.length,
        })
      } else {
        logger.debug('[SystemPromptBuilder] Selected system prompt not found in character prompts', {
          characterId: character.id,
          selectedPromptId: selectedSystemPromptId,
          availablePromptCount: character.systemPrompts.length,
        })
      }
    }

    // Fall back to default prompt in array, then legacy systemPrompt field
    if (!systemPromptContent && character.systemPrompts) {
      const defaultPrompt = character.systemPrompts.find(p => p.isDefault)
      if (defaultPrompt) {
        systemPromptContent = defaultPrompt.content
        logger.debug('[SystemPromptBuilder] Using default system prompt from array', {
          characterId: character.id,
          promptId: defaultPrompt.id,
          promptName: defaultPrompt.name,
          contentLength: defaultPrompt.content.length,
        })
      }
    }

    if (systemPromptContent) {
      // Process templates in the system prompt content
      const processedSystemPrompt = processTemplate(systemPromptContent, templateContext)
      parts.push(processedSystemPrompt)
    } else {
      logger.debug('[SystemPromptBuilder] No system prompt found for character', {
        characterId: character.id,
        selectedSystemPromptId,
        hasSystemPrompts: !!(character.systemPrompts && character.systemPrompts.length > 0),
      })
    }
  }

  // Character personality - process templates
  if (character.personality) {
    const processedPersonality = processTemplate(character.personality, templateContext)
    parts.push(`\n## Character Personality\n${processedPersonality}`)
  }

  // Scenario/setting - process templates
  if (character.scenario) {
    const processedScenario = processTemplate(character.scenario, templateContext)
    parts.push(`\n## Scenario\n${processedScenario}`)
  }

  // Example dialogues for style reference - process templates
  if (character.exampleDialogues) {
    const processedDialogues = processTemplate(character.exampleDialogues, templateContext)
    parts.push(`\n## Example Dialogue Style\n${processedDialogues}`)
  }

  // Persona information if provided (single-character mode)
  // In multi-character mode, the persona is included in otherParticipants
  if (persona && (!otherParticipants || otherParticipants.length === 0)) {
    parts.push(`\n## User Persona\nYou are speaking with ${persona.name}. ${persona.description}`)
  }

  // Multi-character context section
  if (otherParticipants && otherParticipants.length > 0) {
    const multiCharSection = buildMultiCharacterContextSection(
      otherParticipants,
      character.name
    )
    if (multiCharSection) {
      parts.push(multiCharSection)
    }
  }

  return parts.join('\n\n').trim()
}

/**
 * Build other participants info for system prompt
 * Supports CHARACTER (LLM and user-controlled) and legacy PERSONA types
 */
export function buildOtherParticipantsInfo(
  respondingParticipantId: string,
  allParticipants: ChatParticipantBase[],
  participantCharacters: Map<string, Character>,
  participantPersonas: Map<string, Persona>
): OtherParticipantInfo[] {
  const otherParticipants: OtherParticipantInfo[] = []

  for (const participant of allParticipants) {
    // Skip the responding participant
    if (participant.id === respondingParticipantId) {
      continue
    }

    // Skip inactive participants
    if (!participant.isActive) {
      continue
    }

    // CHARACTER participants (both LLM and user-controlled)
    if (participant.type === 'CHARACTER' && participant.characterId) {
      const character = participantCharacters.get(participant.characterId)
      if (character) {
        // For user-controlled characters, report as 'CHARACTER' type (not 'PERSONA')
        // The controlledBy field determines behavior, not the display type
        otherParticipants.push({
          name: character.name,
          description: character.title || character.description || undefined,
          type: 'CHARACTER',
        })
      }
    }
    // Legacy PERSONA participants (deprecated - use CHARACTER with controlledBy='user' instead)
    else if (participant.type === 'PERSONA' && participant.personaId) {
      const persona = participantPersonas.get(participant.personaId)
      if (persona) {
        otherParticipants.push({
          name: persona.name,
          description: persona.description || undefined,
          type: 'PERSONA',
        })
      }
    }
  }

  return otherParticipants
}
