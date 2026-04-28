/**
 * System Prompt Builder
 *
 * Builds system prompts for characters in both single-character
 * and multi-character chat scenarios.
 */

import type { Character, ChatParticipantBase, TimestampConfig } from '@/lib/schemas/types'
import { type ParticipantStatus } from '@/lib/schemas/types'
import { calculateCurrentTimestamp, shouldInjectTimestamp } from '@/lib/chat/timestamp-utils'
import { processTemplate, type TemplateContext } from '@/lib/templates/processor'

/**
 * Other participant info for multi-character system prompts.
 *
 * Phase C moved the multi-character roster out of the system prompt and into
 * Host whispers in the transcript, but this type is still consumed by the
 * orchestrator → context-builder pipeline for non-prompt purposes (mentioned-
 * characters scan, identity reinforcement names) so it stays exported.
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
 * Build the system prompt for a character.
 *
 * After the Phase A–G refactor, the per-turn system prompt only carries the
 * character's identity stack (preamble, base prompt, personality, aliases,
 * pronouns, physical appearance, example dialogue) plus the chat-level
 * roleplay template, tool instructions, and tool reinforcement. Everything
 * dynamic — scenario, user-character intro, multi-character roster, status,
 * silent-mode rule, status-change notes, project context, current outfit /
 * wardrobe, outfit-change notices, conversation summary, memory tail,
 * timestamp — has been moved to Staff-authored whispers in the transcript.
 *
 * Templates are still processed: `{{char}}`, `{{user}}`, `{{scenario}}`,
 * `{{persona}}`, and (when `timestampConfig.autoPrepend` is false)
 * `{{timestamp}}` resolve from the same `templateContext`.
 */
export interface BuildSystemPromptOptions {
  character: Character
  userCharacter?: { name: string; description: string } | null
  /** Roleplay template to prepend (formatting instructions). */
  roleplayTemplate?: { systemPrompt: string } | null
  /** Tool instructions (native tool rules or text-block tool instructions). */
  toolInstructions?: string
  /** Selected system prompt ID from the character's `systemPrompts` array. */
  selectedSystemPromptId?: string | null
  /** Timestamp configuration. Used only for the `{{timestamp}}` template variable path. */
  timestampConfig?: TimestampConfig | null
  /** Whether this is the first message (for START_ONLY timestamp mode). */
  isInitialMessage?: boolean
  /** Resolved IANA timezone name for timestamp formatting. */
  timezone?: string
  /** Scenario text used to feed the `{{scenario}}` template variable. */
  scenarioText?: string | null
}

export function buildSystemPrompt(options: BuildSystemPromptOptions): string {
  const {
    character,
    userCharacter,
    roleplayTemplate,
    toolInstructions,
    selectedSystemPromptId,
    timestampConfig,
    isInitialMessage,
    timezone,
    scenarioText,
  } = options
  const parts: string[] = []

  // Build template context for {{char}}, {{user}}, etc. replacement
  const templateContext: TemplateContext = {
    char: character.name,
    user: userCharacter?.name || 'User',
    description: character.description || '',
    personality: character.personality || '',
    scenario: scenarioText || character.scenarios?.[0]?.content || '',
    persona: userCharacter?.description || '',
  }

  // Identity preamble: establish who the character is from the very first tokens.
  // This anchors the LLM's identity before any formatting, tool, or project instructions.
  // The identity reinforcement at the end of the prompt bookends this.
  parts.push(processTemplate(
    '## Character Identity\nYou are {{char}}. Everything that follows defines who you are and how you behave. Stay in character at all times.',
    templateContext
  ))

  // Phase D: outfit-change notices, current outfit, and available wardrobe
  // are now Aurora-authored whispers in the chat transcript instead of
  // system-prompt blocks.

  // Phase G: when `timestampConfig.autoPrepend` is set, the timestamp is now
  // delivered as a Host whisper from `lib/chat/context-manager.ts`. The
  // `{{timestamp}}` template variable path remains for character/template
  // content that wants to inline the time directly.
  if (timestampConfig && shouldInjectTimestamp(timestampConfig, isInitialMessage ?? false)) {
    if (!timestampConfig.autoPrepend) {
      const timestamp = calculateCurrentTimestamp(timestampConfig, timezone)
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

  // Phase E: project context is now emitted as Prospero whispers in the
  // transcript (chat-start + cadence-based refresh in the orchestrator).

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

  // Phase D: current outfit + available wardrobe moved to Aurora whispers
  // (chat-start opening + debounced wardrobe announcement on equip/unequip).

  // Scenario, user-character introduction, multi-character roster, own-status,
  // silent-mode rule, and status-change notifications all moved to Host
  // whispers in Phase C. They live in the transcript now, not the per-turn
  // system prompt.

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
