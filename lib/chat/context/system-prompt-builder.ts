/**
 * System Prompt Builder
 *
 * Builds system prompts for characters in both single-character
 * and multi-character chat scenarios.
 */

import type { Character, ChatParticipantBase, TimestampConfig } from '@/lib/schemas/types'
import { calculateCurrentTimestamp, shouldInjectTimestamp, formatTimestampForSystemPrompt } from '@/lib/chat/timestamp-utils'
import { buildMultiCharacterContextSection } from '@/lib/llm/message-formatter'
import { logger } from '@/lib/logger'
import { processTemplate, type TemplateContext } from '@/lib/templates/processor'

/**
 * Other participant info for multi-character system prompts
 */
export interface OtherParticipantInfo {
  name: string
  aliases?: string[]
  pronouns?: { subject: string; object: string; possessive: string }
  description?: string
  type: 'CHARACTER'
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
  /** Tool instructions (native tool rules or pseudo-tool instructions) */
  toolInstructions?: string,
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

    if (timestampConfig.autoPrepend) {
      // Add timestamp as the first part of the system prompt
      parts.push(formatTimestampForSystemPrompt(timestamp, true))
    } else {
      // Add to template context for {{timestamp}} variable
      templateContext.timestamp = timestamp.formatted
    }
  }

  // Roleplay template system prompt (formatting instructions) - prepended first
  // Process templates to replace {{char}} and {{user}}
  if (roleplayTemplate?.systemPrompt) {
    const processedRoleplayPrompt = processTemplate(roleplayTemplate.systemPrompt, templateContext)

    parts.push(processedRoleplayPrompt)
  }

  // Tool instructions (native tool rules or pseudo-tool instructions)
  // Added after roleplay template so tool usage instructions are seen early
  // Note: These typically don't contain {{char}}/{{user}} but process anyway for consistency
  if (toolInstructions) {
    const processedToolInstructions = processTemplate(toolInstructions, templateContext)

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

    parts.push(projectParts.join('\n'))
  }

  // Base system prompt - priority: override > selected prompt > default systemPrompt
  if (systemPromptOverride) {
    const processedOverride = processTemplate(systemPromptOverride, templateContext)

    parts.push(processedOverride)
  } else {
    // Check for selected system prompt from character's prompts array
    let systemPromptContent: string | null = null

    if (selectedSystemPromptId && character.systemPrompts) {
      const selectedPrompt = character.systemPrompts.find(p => p.id === selectedSystemPromptId)
      if (selectedPrompt) {
        systemPromptContent = selectedPrompt.content

      } else {

      }
    }

    // Fall back to default prompt in array, then legacy systemPrompt field
    if (!systemPromptContent && character.systemPrompts) {
      const defaultPrompt = character.systemPrompts.find(p => p.isDefault)
      if (defaultPrompt) {
        systemPromptContent = defaultPrompt.content

      }
    }

    if (systemPromptContent) {
      // Process templates in the system prompt content
      const processedSystemPrompt = processTemplate(systemPromptContent, templateContext)
      parts.push(processedSystemPrompt)
    } else {

    }
  }

  // Character personality - process templates
  if (character.personality) {
    const processedPersonality = processTemplate(character.personality, templateContext)
    parts.push(`\n## Character Personality\n${processedPersonality}`)
  }

  // Character aliases - let the LLM know about alternate names
  if (character.aliases && character.aliases.length > 0) {
    parts.push(`\n## Character Aliases\nThis character also goes by: ${character.aliases.join(', ')}\nOther characters and the user may refer to them by any of these names.`)
  }

  // Character pronouns - let the LLM know what pronouns to use
  if (character.pronouns) {
    parts.push(`\n## Character Pronouns\nThis character's pronouns are: ${character.pronouns.subject}/${character.pronouns.object}/${character.pronouns.possessive}. Always use these pronouns when referring to this character.`)
  }

  // Physical descriptions - appearance context for the LLM
  if (character.physicalDescriptions && character.physicalDescriptions.length > 0) {
    const descriptionLines = character.physicalDescriptions.map(desc => {
      const contextNote = desc.usageContext ? ` (best used: ${desc.usageContext})` : '';
      const descText = desc.shortPrompt || desc.mediumPrompt || desc.longPrompt
        || desc.completePrompt || desc.fullDescription || '';
      if (!descText) return null;
      return `- "${desc.name}"${contextNote}: ${descText}`;
    }).filter(Boolean);

    if (descriptionLines.length > 0) {
      logger.debug('[SystemPrompt] Injecting physical descriptions', {
        characterId: character.id,
        characterName: character.name,
        descriptionCount: descriptionLines.length,
      });
      parts.push(`\n## Physical Appearance\n${descriptionLines.join('\n')}`);
    }
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

  // Character-voiced tool reinforcement (only when tools are available)
  // Placed after character personality/scenario/dialogues so the LLM has full
  // character context before being reminded to actually invoke tools in-character.
  if (toolInstructions) {
    const toolReinforcement = processTemplate(
      'When {{char}} uses his/her workspace tools, he/she CALLS them — he/she does not merely describe calling them. Every tool action produces a tool_use block, not prose.',
      templateContext
    )
    parts.push(toolReinforcement)
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
 * Supports CHARACTER participants (both LLM and user-controlled)
 */
export function buildOtherParticipantsInfo(
  respondingParticipantId: string,
  allParticipants: ChatParticipantBase[],
  participantCharacters: Map<string, Character>
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
        otherParticipants.push({
          name: character.name,
          aliases: character.aliases && character.aliases.length > 0 ? character.aliases : undefined,
          pronouns: character.pronouns || undefined,
          description: character.title || character.description || undefined,
          type: 'CHARACTER',
        })
      }
    }
  }

  return otherParticipants
}

/**
 * Build an identity reinforcement block to append at the very end of the system prompt.
 * This reminds the LLM which character it is playing and who it must NOT write for,
 * placed as close to the generation boundary as possible for maximum compliance.
 */
export function buildIdentityReinforcement(
  characterName: string,
  userName: string = 'User',
  otherParticipantNames?: string[]
): string {
  const hasOtherParticipants = otherParticipantNames && otherParticipantNames.length > 0

  // Build the "do not write for" list
  let doNotWriteFor: string
  if (hasOtherParticipants) {
    // Multi-character: explicitly name other participants plus the user
    const allOthers = [...otherParticipantNames, userName]
    if (allOthers.length === 1) {
      doNotWriteFor = allOthers[0]
    } else {
      const last = allOthers[allOthers.length - 1]
      const rest = allOthers.slice(0, -1)
      doNotWriteFor = `${rest.join(', ')}, ${last}, or any other character`
    }
  } else {
    doNotWriteFor = `{{user}} or any other character`
  }

  const template = hasOtherParticipants
    ? `## Identity Reminder\nYou are {{char}}. Respond only as {{char}}. Do not write dialogue, actions, or thoughts for ${doNotWriteFor}. Your response must contain only {{char}}'s own speech, actions, and inner thoughts, following the response format described above.`
    : `## Identity Reminder\nYou are {{char}}. Respond only as {{char}}. Do not write dialogue, actions, or thoughts for ${doNotWriteFor}. Your response must contain only {{char}}'s own speech, actions, and inner thoughts, following the response format described above.`

  const result = processTemplate(template, {
    char: characterName,
    user: userName,
  })

  logger.debug('[SystemPromptBuilder] Building identity reinforcement', {
    characterName,
    userName,
    otherParticipantCount: otherParticipantNames?.length ?? 0,
    isMultiCharacter: hasOtherParticipants,
  })

  return result
}
