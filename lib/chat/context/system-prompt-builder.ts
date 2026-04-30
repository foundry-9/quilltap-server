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
 * Inputs that uniquely determine a character's static identity stack within a
 * given chat. The stack is the bulk of the per-turn system prompt — identity
 * preamble, base prompt, personality, aliases, pronouns, physical appearance,
 * example dialogues — with `{{user}}` / `{{scenario}}` / `{{persona}}`
 * resolved at compile time.
 *
 * Phase H caches the result of `buildIdentityStack` on
 * `chats.compiledIdentityStacks` keyed by participantId, so the per-turn
 * `buildSystemPrompt` can skip the rebuild work and the LLM provider sees a
 * stable cache-friendly prefix.
 */
export interface BuildIdentityStackOptions {
  character: Character
  userCharacter?: { name: string; description: string } | null
  selectedSystemPromptId?: string | null
  scenarioText?: string | null
}

/**
 * Build just the static character-identity portion of the system prompt,
 * with chat-level template variables resolved. The result is suitable for
 * caching across turns within a chat.
 */
export function buildIdentityStack(options: BuildIdentityStackOptions): string {
  const { character, userCharacter, selectedSystemPromptId, scenarioText } = options
  const parts: string[] = []

  const templateContext: TemplateContext = {
    char: character.name,
    user: userCharacter?.name || 'User',
    description: character.description || '',
    personality: character.personality || '',
    scenario: scenarioText || character.scenarios?.[0]?.content || '',
    persona: userCharacter?.description || '',
  }

  // Identity preamble — anchors the LLM's identity from the very first tokens.
  parts.push(processTemplate(
    '## Character Identity\nYou are {{char}}. Everything that follows defines who you are and how you behave. Stay in character at all times.',
    templateContext
  ))

  // Base system prompt — selected > default > nothing.
  let systemPromptContent: string | null = null
  if (selectedSystemPromptId && character.systemPrompts) {
    const selectedPrompt = character.systemPrompts.find(p => p.id === selectedSystemPromptId)
    if (selectedPrompt) {
      systemPromptContent = selectedPrompt.content
    }
  }
  if (!systemPromptContent && character.systemPrompts) {
    const defaultPrompt = character.systemPrompts.find(p => p.isDefault)
    if (defaultPrompt) {
      systemPromptContent = defaultPrompt.content
    }
  }
  if (systemPromptContent) {
    parts.push(processTemplate(systemPromptContent, templateContext))
  }

  if (character.personality) {
    parts.push(`\n## Character Personality\n${processTemplate(character.personality, templateContext)}`)
  }

  if (character.aliases && character.aliases.length > 0) {
    parts.push(`\n## Character Aliases\nThis character also goes by: ${character.aliases.join(', ')}\nOther characters and the user may refer to them by any of these names.`)
  }

  if (character.pronouns) {
    parts.push(`\n## Character Pronouns\nThis character's pronouns are: ${character.pronouns.subject}/${character.pronouns.object}/${character.pronouns.possessive}. Always use these pronouns when referring to this character.`)
  }

  if (character.physicalDescriptions && character.physicalDescriptions.length > 0) {
    const descriptionLines = character.physicalDescriptions.map(desc => {
      const contextNote = desc.usageContext ? ` (best used: ${desc.usageContext})` : ''
      const descText = desc.shortPrompt || desc.mediumPrompt || desc.longPrompt
        || desc.completePrompt || desc.fullDescription || ''
      if (!descText) return null
      return `- "${desc.name}"${contextNote}: ${descText}`
    }).filter(Boolean)

    if (descriptionLines.length > 0) {
      parts.push(`\n## Physical Appearance\n${descriptionLines.join('\n')}`)
    }
  }

  if (character.exampleDialogues) {
    parts.push(`\n## Example Dialogue Style\n${processTemplate(character.exampleDialogues, templateContext)}`)
  }

  return parts.join('\n\n').trim()
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
 * Phase H: the static identity-stack portion may be supplied via
 * `precompiledIdentityStack`; when present it replaces the rebuild. This is
 * the cache-hit path. When absent, the stack is built fresh (read-through
 * fallback) using the same `buildIdentityStack` helper.
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
  /** Phase H: precompiled identity-stack from `chats.compiledIdentityStacks`. */
  precompiledIdentityStack?: string | null
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
    precompiledIdentityStack,
  } = options

  const parts: string[] = []

  // Phase H: prefer the precompiled identity stack when supplied. Falls back
  // to building fresh so the function is safe to call on chats that haven't
  // had their stack compiled yet (legacy chats, missing key in the map).
  const identityStack = precompiledIdentityStack
    && precompiledIdentityStack.trim().length > 0
    ? precompiledIdentityStack
    : buildIdentityStack({ character, userCharacter, selectedSystemPromptId, scenarioText })

  // Template context for the per-turn additions (roleplay template, tool
  // instructions, tool reinforcement). The {{user}}/{{scenario}}/{{persona}}
  // substitutions in the identity stack are already resolved by the time we
  // get here (either via build-time compile or via the fallback path above).
  const templateContext: TemplateContext = {
    char: character.name,
    user: userCharacter?.name || 'User',
    description: character.description || '',
    personality: character.personality || '',
    scenario: scenarioText || character.scenarios?.[0]?.content || '',
    persona: userCharacter?.description || '',
  }

  // Phase G: timestamp template variable path remains for character/template
  // content that wants to inline the time directly. Only kicks in when
  // timestampConfig.autoPrepend is false (the auto-prepend path is now a
  // Host whisper).
  if (timestampConfig && shouldInjectTimestamp(timestampConfig, isInitialMessage ?? false)) {
    if (!timestampConfig.autoPrepend) {
      const timestamp = calculateCurrentTimestamp(timestampConfig, timezone)
      templateContext.timestamp = timestamp.formatted
    }
  }

  // Lead with the identity stack — bulk of the prompt, cache-friendly.
  parts.push(identityStack)

  // Roleplay template (chat-level formatting instructions).
  if (roleplayTemplate?.systemPrompt) {
    parts.push(processTemplate(roleplayTemplate.systemPrompt, templateContext))
  }

  // Tool instructions (per-turn dynamic — varies with enabled tools, danger
  // routing, provider tool support).
  if (toolInstructions) {
    parts.push(processTemplate(toolInstructions, templateContext))
  }

  // Character-voiced tool reinforcement (only when tools are available).
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
 * Build an identity reinforcement block emitted as a separate, fully-static
 * system message. The text deliberately avoids naming individual participants
 * — those join/leave the chat via Host announcements that already live in the
 * conversation history, and every history message carries `name` attribution
 * — so this block can sit downstream of a prompt-cache breakpoint without
 * invalidating it on participant changes.
 */
export function buildIdentityReinforcement(
  characterName: string,
): string {
  // WHY static: any inline list of "other participants" is the kind of
  // turn-variable content that bisects provider prompt caching. The model
  // already knows who is in the scene from Host roster announcements and
  // per-message name attribution; the reminder only needs to emphasise
  // staying in {{char}}'s voice.
  const template = `## Identity Reminder\nYou are {{char}}. Respond only as {{char}}. Do not write dialogue, actions, or thoughts for any other character. Your response must contain only {{char}}'s own speech, actions, and inner thoughts, following the response format described above.\nDo not prefix or label your response with your name (e.g., do not start with "[{{char}}]" or "{{char}}:"). Simply respond in character directly.`

  return processTemplate(template, {
    char: characterName,
  })
}
