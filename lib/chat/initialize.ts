// Chat Initialization Utility
// Phase 0.5: Single Chat MVP
// Updated for characters-not-personas migration

import { getRepositories } from '@/lib/repositories/factory'
import { processCharacterTemplates, processTemplate } from '@/lib/templates/processor'
import { logger } from '@/lib/logger'

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
  personality?: string | null
  scenario?: string | null
  firstMessage?: string | null
  exampleDialogues?: string | null
  systemPrompts?: CharacterSystemPrompt[]
  defaultPartnerId?: string | null
}

/**
 * UserCharacter represents a user-controlled character that the user "plays as"
 * in the conversation. This replaces the old Persona concept.
 */
interface UserCharacter {
  id: string
  name: string
  description?: string | null
  personality?: string | null
}

export interface ChatContext {
  systemPrompt: string
  firstMessage: string
  character: Character
  /** @deprecated Use userCharacter instead */
  persona?: UserCharacter | null
  /** The user-controlled character the user is playing as (replaces persona) */
  userCharacter?: UserCharacter | null
}

/**
 * Build chat context for initializing a new chat or generating responses
 * @param characterId - The AI-controlled character ID
 * @param userCharacterId - Optional user-controlled character ID (replaces personaId)
 * @param customScenario - Optional custom scenario override
 */
export async function buildChatContext(
  characterId: string,
  userCharacterId?: string,
  customScenario?: string
): Promise<ChatContext> {
  const repos = getRepositories()

  const character = await repos.characters.findById(characterId)

  if (!character) {
    throw new Error('Character not found')
  }

  // Look up user-controlled character (replaces persona lookup)
  let userCharacter: UserCharacter | null = null
  if (userCharacterId) {
    const uc = await repos.characters.findById(userCharacterId)
    if (uc && uc.controlledBy === 'user') {
      userCharacter = {
        id: uc.id,
        name: uc.name,
        description: uc.description,
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
        description: defaultPartner.description,
        personality: defaultPartner.personality,
      }

    }
  }

  // Build system prompt (pass userCharacter as 'persona' for template compatibility)
  const systemPrompt = buildSystemPrompt({
    character,
    userCharacter: userCharacter || undefined,
    scenario: customScenario || character.scenario || undefined,
  })

  // Get the default system prompt content for template processing
  const defaultSystemPrompt = getDefaultSystemPrompt(character)

  // Process first message with templates
  // Note: processCharacterTemplates expects 'persona' shape for {{user}} template variable
  const processedCharacter = processCharacterTemplates({
    character,
    persona: userCharacter ? { name: userCharacter.name, description: userCharacter.description } : undefined,
    scenario: customScenario || character.scenario || undefined,
    systemPrompt: defaultSystemPrompt,
  })
  const firstMessage = processedCharacter.firstMessage

  return {
    systemPrompt,
    firstMessage,
    character,
    persona: userCharacter || null,  // For backwards compatibility
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
  const defaultPrompt = character.systemPrompts.find(p => p.isDefault)
  return defaultPrompt?.content || character.systemPrompts[0]?.content || ''
}

function buildSystemPrompt({
  character,
  userCharacter,
  scenario,
}: {
  character: Character
  userCharacter?: UserCharacter
  scenario?: string | null
}): string {
  // Get the default system prompt content
  const systemPromptContent = getDefaultSystemPrompt(character)

  // Process all character templates with the current context
  // Note: processCharacterTemplates expects 'persona' shape for {{user}} template variable
  const processedCharacter = processCharacterTemplates({
    character,
    persona: userCharacter ? { name: userCharacter.name, description: userCharacter.description } : undefined,
    scenario,
    systemPrompt: systemPromptContent,
  })

  let prompt = processedCharacter.systemPrompt || ''

  // Add character identity
  prompt += `\n\nYou are roleplaying as ${character.name}.`

  // Add character description (with templates processed)
  if (processedCharacter.description) {
    prompt += `\n\nCharacter Description:\n${processedCharacter.description}`
  }

  // Add personality (with templates processed)
  if (processedCharacter.personality) {
    prompt += `\n\nPersonality:\n${processedCharacter.personality}`
  }

  // Add user character info (who the AI is talking to)
  // Process templates in the user character's description/personality with their own context
  // ({{char}} in user character's description refers to that character, not the AI character)
  if (userCharacter) {
    prompt += `\n\nYou are talking to ${userCharacter.name}.`
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
