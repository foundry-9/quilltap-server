/**
 * System Prompt Builder
 *
 * Builds system prompts for characters in both single-character
 * and multi-character chat scenarios.
 */

import type { Character, ChatParticipantBase, TimestampConfig } from '@/lib/schemas/types'
import { isParticipantPresent, type ParticipantStatus } from '@/lib/schemas/types'
import { calculateCurrentTimestamp, shouldInjectTimestamp, formatTimestampForSystemPrompt } from '@/lib/chat/timestamp-utils'
import { buildMultiCharacterContextSection } from '@/lib/llm/message-formatter'
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
  /** Current participation status */
  status?: 'active' | 'silent' | 'absent' | 'removed'
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
  /** For multi-character chats: info about other participants */
  otherParticipants?: OtherParticipantInfo[],
  /** Roleplay template to prepend (formatting instructions) */
  roleplayTemplate?: { systemPrompt: string } | null,
  /** Tool instructions (native tool rules or text-block tool instructions) */
  toolInstructions?: string,
  /** Selected system prompt ID from character's systemPrompts array */
  selectedSystemPromptId?: string | null,
  /** Timestamp configuration for injection */
  timestampConfig?: TimestampConfig | null,
  /** Whether this is the first message (for START_ONLY mode) */
  isInitialMessage?: boolean,
  /** Project context to include in system prompt */
  projectContext?: ProjectContext | null,
  /** Resolved IANA timezone name for timestamp formatting */
  timezone?: string,
  /** Status change notifications to include (e.g., "Alice is now silent") */
  statusChangeNotifications?: string[],
  /** The responding character's own participation status */
  respondingCharacterStatus?: 'active' | 'silent' | 'absent' | 'removed',
  /** Scenario text override (from chat-level scenario selection) */
  scenarioText?: string | null
): string {
  const parts: string[] = []

  // Build template context for {{char}}, {{user}}, etc. replacement
  const templateContext: TemplateContext = {
    char: character.name,
    user: persona?.name || 'User',
    description: character.description || '',
    personality: character.personality || '',
    scenario: scenarioText || character.scenarios?.[0]?.content || '',
    persona: persona?.description || '',
  }

  // Identity preamble: establish who the character is from the very first tokens.
  // This anchors the LLM's identity before any formatting, tool, or project instructions.
  // The identity reinforcement at the end of the prompt bookends this.
  parts.push(processTemplate(
    '## Character Identity\nYou are {{char}}. Everything that follows defines who you are and how you behave. Stay in character at all times.',
    templateContext
  ))

  // Handle timestamp injection
  if (timestampConfig && shouldInjectTimestamp(timestampConfig, isInitialMessage ?? false)) {
    const timestamp = calculateCurrentTimestamp(timestampConfig, timezone)

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

  // Tool instructions (native tool rules or text-block tool instructions)
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

  // Base system prompt - priority: selected prompt > default systemPrompt
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
      parts.push(`\n## Physical Appearance\n${descriptionLines.join('\n')}`);
    }
  }

  // Clothing records - outfit context for the LLM
  if (character.clothingRecords && character.clothingRecords.length > 0) {
    const clothingLines = character.clothingRecords.map(record => {
      const contextNote = record.usageContext ? ` (when: ${record.usageContext})` : '';
      const descText = record.description || '';
      if (!descText) return `- "${record.name}"${contextNote}`;
      return `- "${record.name}"${contextNote}: ${descText}`;
    });

    parts.push(`\n## Clothing / Outfits\n${clothingLines.join('\n')}`);
  }

  // Scenario/setting - use first scenario in the array, process templates
  // A scenario describes the environment, setting, and circumstances of the interaction —
  // it provides context for where the conversation takes place without changing who the character is.
  const scenarioContent = scenarioText || character.scenarios?.[0]?.content
  if (scenarioContent) {
    const processedScenario = processTemplate(scenarioContent, templateContext)
    parts.push(`\n## Scenario\nThe following describes the setting and circumstances of this interaction. Stay in character as defined above — the scenario provides environmental context, not a change in personality.\n\n${processedScenario}`)
  }

  // Example dialogues for style reference - process templates
  if (character.exampleDialogues) {
    const processedDialogues = processTemplate(character.exampleDialogues, templateContext)
    parts.push(`\n## Example Dialogue Style\n${processedDialogues}`)
  }

  // Character-voiced tool reinforcement (only when tools are available)
  // Placed after character personality/scenario/dialogues so the LLM has full
  // character context before being reminded to actually invoke tools in-character.
  // Uses character's actual pronouns when available.
  if (toolInstructions) {
    const subject = character.pronouns?.subject || 'they'
    const toolReinforcement = processTemplate(
      `When {{char}} uses workspace tools, ${subject} CALLS them — ${subject} does not merely describe calling them. Every tool action produces a tool_use block, not prose.`,
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

  // Your own status reminder — so the LLM always knows its participation mode
  if (respondingCharacterStatus && otherParticipants && otherParticipants.length > 0) {
    parts.push(`## Your Current Status\nYour participation status is: **${respondingCharacterStatus}**.`)
  }

  // Silent mode instructions for the responding character
  if (respondingCharacterStatus === 'silent') {
    parts.push(
      '## Silent Mode Active\n' +
      'You are currently in SILENT mode. You are present in the scene but MUST NOT speak out loud — ' +
      'no dialogue that others can hear. You may:\n' +
      '- Have inner thoughts and internal monologue (use *italics* or describe as thoughts)\n' +
      '- Take physical actions (gestures, movements, facial expressions)\n' +
      '- React emotionally or physically to what others say and do\n\n' +
      'You MUST NOT:\n' +
      '- Speak any dialogue out loud\n' +
      '- Whisper, murmur, or make any vocal sounds others could hear\n' +
      '- Communicate verbally in any way'
    )
  }

  // Status change notifications
  if (statusChangeNotifications && statusChangeNotifications.length > 0) {
    parts.push(
      '## Recent Status Changes\n' +
      'The following changes have occurred since your last turn:\n' +
      statusChangeNotifications.map(n => `- ${n}`).join('\n')
    )
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

    // Skip removed participants
    if (participant.status === 'removed') {
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
          status: participant.status as ParticipantStatus,
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

  const template = `## Identity Reminder\nYou are {{char}}. Respond only as {{char}}. Do not write dialogue, actions, or thoughts for ${doNotWriteFor}. Your response must contain only {{char}}'s own speech, actions, and inner thoughts, following the response format described above.\nDo not prefix or label your response with your name (e.g., do not start with "[{{char}}]" or "{{char}}:"). Simply respond in character directly.`

  const result = processTemplate(template, {
    char: characterName,
    user: userName,
  })

  return result
}
