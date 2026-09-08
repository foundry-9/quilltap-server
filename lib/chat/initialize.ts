// Chat Initialization Utility
// Phase 0.5: Single Chat MVP
// Updated for characters-not-personas migration

import { getRepositories } from '@/lib/repositories/factory'
import { processCharacterTemplates, processTemplate } from '@/lib/templates/processor'
import type { SubpromptForPrompt } from '@/lib/subprompts/subprompts'
import { logger } from '@/lib/logger'
import { buildProgressionsSection } from '@/lib/progressions/prompt-section'

interface CharacterSystemPrompt {
  id: string
  name: string
  content: string
  isDefault: boolean
}

interface Character {
  id: string
  name: string
  description?: string | null
  manifesto?: string | null
  personality?: string | null
  scenarios?: Array<{ id: string; title: string; content: string }>
  firstMessage?: string | null
  exampleDialogues?: string | null
  systemPrompts?: CharacterSystemPrompt[]
  defaultPartnerId?: string | null
  defaultSystemPromptId?: string | null
}

/**
 * UserCharacter represents a user-controlled character that the user "plays as"
 * in the conversation.
 */
interface UserCharacter {
  id: string
  name: string
  aliases?: string[]
  pronouns?: { subject: string; object: string; possessive: string }
  description?: string | null
  manifesto?: string | null
  personality?: string | null
}

export interface ChatContext {
  systemPrompt: string
  firstMessage: string
  character: Character
  /** The user-controlled character the user is playing as */
  userCharacter?: UserCharacter | null
}

/**
 * Build chat context for initializing a new chat or generating responses
 * @param characterId - The AI-controlled character ID
 * @param userCharacterId - Optional user-controlled character ID
 * @param customScenario - Optional custom scenario override
 * @param selectedSystemPromptId - Optional specific system prompt ID from the character's prompts array
 */
export async function buildChatContext(
  characterId: string,
  userCharacterId?: string,
  customScenario?: string,
  selectedSystemPromptId?: string,
  subprompts?: readonly SubpromptForPrompt[],
): Promise<ChatContext> {
  const repos = getRepositories()

  const character = await repos.characters.findById(characterId)

  if (!character) {
    throw new Error('Character not found')
  }

  // Look up user-controlled character
  let userCharacter: UserCharacter | null = null
  if (userCharacterId) {
    const uc = await repos.characters.findById(userCharacterId)
    if (uc && uc.controlledBy === 'user') {
      userCharacter = {
        id: uc.id,
        name: uc.name,
        aliases: uc.aliases && uc.aliases.length > 0 ? uc.aliases : undefined,
        pronouns: uc.pronouns || undefined,
        description: uc.description,
        manifesto: uc.manifesto,
        personality: uc.personality,
      }

    }
  } else if (character.defaultPartnerId) {
    // Fall back to character's default partner
    const defaultPartner = await repos.characters.findById(character.defaultPartnerId)
    if (defaultPartner && defaultPartner.controlledBy === 'user') {
      userCharacter = {
        id: defaultPartner.id,
        name: defaultPartner.name,
        aliases: defaultPartner.aliases && defaultPartner.aliases.length > 0 ? defaultPartner.aliases : undefined,
        pronouns: defaultPartner.pronouns || undefined,
        description: defaultPartner.description,
        manifesto: defaultPartner.manifesto,
        personality: defaultPartner.personality,
      }

    }
  }

  // Use the scenario explicitly provided by the caller (already resolved from scenarioId or custom text)
  const resolvedScenario = customScenario || undefined

  // Build system prompt
  const systemPrompt = buildSystemPrompt({
    character,
    userCharacter: userCharacter || undefined,
    scenario: resolvedScenario,
    selectedSystemPromptId,
    subprompts,
  })

  // Get the system prompt content for template processing (selected or default)
  const defaultSystemPrompt = getSelectedOrDefaultSystemPrompt(character, selectedSystemPromptId)

  // Process first message with templates
  const processedCharacter = processCharacterTemplates({
    character,
    userCharacter: userCharacter ? { name: userCharacter.name, description: userCharacter.description } : undefined,
    scenario: resolvedScenario,
    systemPrompt: defaultSystemPrompt,
  })
  const firstMessage = processedCharacter.firstMessage

  return {
    systemPrompt,
    firstMessage,
    character,
    userCharacter: userCharacter || null,
  }
}

/**
 * Get the default system prompt content from a character's systemPrompts array
 */
function getDefaultSystemPrompt(character: Character): string {
  if (!character.systemPrompts || character.systemPrompts.length === 0) {
    return ''
  }
  // Check defaultSystemPromptId first, then isDefault flag, then first prompt
  if (character.defaultSystemPromptId) {
    const byId = character.systemPrompts.find(p => p.id === character.defaultSystemPromptId)
    if (byId) return byId.content
  }
  const defaultPrompt = character.systemPrompts.find(p => p.isDefault)
  return defaultPrompt?.content || character.systemPrompts[0]?.content || ''
}

/**
 * Get the selected system prompt content, falling back to the default
 */
function getSelectedOrDefaultSystemPrompt(character: Character, selectedSystemPromptId?: string): string {
  if (selectedSystemPromptId && character.systemPrompts) {
    const selected = character.systemPrompts.find(p => p.id === selectedSystemPromptId)
    if (selected) {
      return selected.content
    }
    logger.warn('[Chat Initialize] selectedSystemPromptId not found on character, falling back to default', {
      characterId: character.id,
      selectedSystemPromptId,
    })
  }
  return getDefaultSystemPrompt(character)
}

function buildSystemPrompt({
  character,
  userCharacter,
  scenario,
  selectedSystemPromptId,
  subprompts,
}: {
  character: Character
  userCharacter?: UserCharacter
  scenario?: string | null
  selectedSystemPromptId?: string
  /** Subprompts in play for the opener — appended right after the system prompt. */
  subprompts?: readonly SubpromptForPrompt[]
}): string {
  // Get the selected or default system prompt content
  const systemPromptContent = getSelectedOrDefaultSystemPrompt(character, selectedSystemPromptId)

  // Process all character templates with the current context
  const processedCharacter = processCharacterTemplates({
    character,
    userCharacter: userCharacter ? { name: userCharacter.name, description: userCharacter.description } : undefined,
    scenario,
    systemPrompt: systemPromptContent,
  })

  let prompt = processedCharacter.systemPrompt || ''

  // Subprompts ticked on for this chat — same register as the system prompt,
  // so they follow it directly (mirrors buildIdentityStack's placement).
  if (subprompts && subprompts.length > 0) {
    const templateContext = {
      char: character.name,
      user: userCharacter?.name || 'User',
      description: character.description || '',
      personality: character.personality || '',
      scenario: scenario || '',
      persona: userCharacter?.description || '',
    }
    const rendered = subprompts
      .map((s) => `### ${s.title}\n${processTemplate(s.content, templateContext)}`)
      .join('\n\n')
    prompt += `\n\n## Additional Instructions\nThe following also apply to you in this conversation.\n${rendered}`
  }

  // Character progressions — the timed conditions this character is carrying.
  // The opener should know she is pregnant, so the report is FORCED here: a
  // greeting has no turn history to derive a cadence from, and `force` is what
  // "report everything, once" means to the engine.
  //
  // This is the greeting's own flat builder, NOT the cached identity stack, so
  // a per-turn clock landing here costs no cache: the opener is composed once
  // and never rebuilt. Anywhere else, progressions ride the uncached trailing
  // tail — see `lib/progressions/prompt-section.ts`.
  const progressionsSection = buildProgressionsSection({
    character,
    nowMs: Date.now(),
    force: true,
  })
  if (progressionsSection) {
    prompt += `\n\n${progressionsSection}`
  }

  // Add character identity
  prompt += `\n\nYou are roleplaying as ${character.name}.`

  // Add character description (with templates processed)
  if (processedCharacter.description) {
    prompt += `\n\nCharacter Description:\n${processedCharacter.description}`
  }

  // Add manifesto (with templates processed)
  if (processedCharacter.manifesto) {
    prompt += `\n\nManifesto:\n${processedCharacter.manifesto}`
  }

  // Add personality (with templates processed)
  if (processedCharacter.personality) {
    prompt += `\n\nPersonality:\n${processedCharacter.personality}`
  }

  // Add user character info (who the AI is talking to)
  // Process templates in the user character's description/personality with their own context
  // ({{char}} in user character's description refers to that character, not the AI character)
  if (userCharacter) {
    const aliasNote = userCharacter.aliases && userCharacter.aliases.length > 0
      ? ` (also known as: ${userCharacter.aliases.join(', ')})`
      : ''
    const pronounNote = userCharacter.pronouns
      ? ` (pronouns: ${userCharacter.pronouns.subject}/${userCharacter.pronouns.object}/${userCharacter.pronouns.possessive})`
      : ''
    prompt += `\n\nYou are talking to ${userCharacter.name}${aliasNote}${pronounNote}.`
    if (userCharacter.description) {
      const processedUserDesc = processTemplate(userCharacter.description, {
        char: userCharacter.name,
        user: character.name, // From user character's perspective, the AI is the "user"
      })
      prompt += `\n${processedUserDesc}`
    }
    if (userCharacter.personality) {
      const processedUserPersonality = processTemplate(userCharacter.personality, {
        char: userCharacter.name,
        user: character.name,
      })
      prompt += `\nThey are: ${processedUserPersonality}`
    }
  }

  // Add scenario (with templates processed)
  if (processedCharacter.scenario) {
    prompt += `\n\nScenario:\n${processedCharacter.scenario}`
  }

  // Add example dialogues (with templates processed)
  if (processedCharacter.exampleDialogues) {
    prompt += `\n\nExample Dialogue:\n${processedCharacter.exampleDialogues}`
  }

  // Add roleplay instructions
  prompt += `\n\nStay in character at all times. Respond naturally and consistently with ${character.name}'s personality and the current scenario.`

  return prompt.trim()
}
