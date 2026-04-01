// Initial Greeting Helper
// Generates a first message for a chat when no scripted greeting exists

import { createLLMProvider } from '@/lib/llm'
import { logger } from '@/lib/logger'

export interface ParticipantMemoryForGreeting {
  aboutCharacterName: string
  summary: string
}

export interface ProjectContextForGreeting {
  name: string
  description?: string | null
  instructions?: string | null
}

export type GreetingRequest = {
  systemPrompt: string
  characterName: string
  provider: string
  modelName: string
  apiKey?: string
  baseUrl?: string | null
  temperature?: number
  maxTokens?: number
  topP?: number
  /** Memories about other participants in the chat */
  participantMemories?: ParticipantMemoryForGreeting[]
  /** Project context if chat is in a project */
  projectContext?: ProjectContextForGreeting | null
}

/**
 * Build the context section for project and memories to include in the system prompt
 */
function buildContextSection(
  projectContext?: ProjectContextForGreeting | null,
  participantMemories?: ParticipantMemoryForGreeting[]
): string {
  const sections: string[] = []

  // Add project context if present
  if (projectContext) {
    const projectParts: string[] = [`## Project Context: ${projectContext.name}`]
    if (projectContext.description) {
      projectParts.push(projectContext.description)
    }
    if (projectContext.instructions) {
      projectParts.push(`### Project Instructions\n${projectContext.instructions}`)
    }
    sections.push(projectParts.join('\n'))
  }

  // Add participant memories if present
  if (participantMemories && participantMemories.length > 0) {
    const memoryParts: string[] = ['## What You Remember About Other Participants']

    // Group memories by character name
    const memoryByCharacter = new Map<string, string[]>()
    for (const memory of participantMemories) {
      const existing = memoryByCharacter.get(memory.aboutCharacterName) || []
      existing.push(memory.summary)
      memoryByCharacter.set(memory.aboutCharacterName, existing)
    }

    for (const [characterName, summaries] of memoryByCharacter) {
      memoryParts.push(`\nAbout ${characterName}:`)
      for (const summary of summaries) {
        memoryParts.push(`- ${summary}`)
      }
    }

    sections.push(memoryParts.join('\n'))
  }

  return sections.join('\n\n')
}

/**
 * Ask the configured LLM to produce a short greeting that fits the character.
 */
export async function generateGreetingMessage({
  systemPrompt,
  characterName,
  provider,
  modelName,
  apiKey,
  baseUrl,
  temperature,
  maxTokens,
  topP,
  participantMemories,
  projectContext,
}: GreetingRequest): Promise<string> {
  const providerClient = await createLLMProvider(provider, baseUrl || undefined)

  // Build enhanced system prompt with context sections
  const contextSection = buildContextSection(projectContext, participantMemories)
  const basePromptWithContext = contextSection
    ? `${systemPrompt}\n\n${contextSection}`
    : systemPrompt

  const augmentedSystemPrompt = `${basePromptWithContext}\n\nYou are starting a brand new conversation. Before the user says anything, open with a concise greeting that fits ${characterName}'s established voice. Keep it to one or two sentences.`

  const messages = [
    { role: 'system' as const, content: augmentedSystemPrompt },
    {
      role: 'user' as const,
      content: 'The chat is beginning now. Greet the user immediately in-character and invite them to engage.',
    },
  ]

  const response = await providerClient.sendMessage(
    {
      messages,
      model: modelName,
      temperature,
      maxTokens: maxTokens ?? 160,
      topP,
    },
    apiKey ?? ''
  )

  // Debug log: LLM response

  const trimmedContent = (response.content || '').trim()

  // Warn if we got an empty response - likely content filtering
  if (!trimmedContent && response.usage && response.usage.completionTokens > 0) {
    logger.warn('[Greeting Generation] LLM returned empty content despite consuming tokens - likely content filter hit', {
      context: 'initial-greeting',
      provider,
      model: modelName,
      characterName,
      promptTokens: response.usage.promptTokens,
      completionTokens: response.usage.completionTokens,
      hadProjectContext: !!projectContext,
      memoryCount: participantMemories?.length || 0,
    })
  } else if (!trimmedContent) {
    logger.warn('[Greeting Generation] LLM returned empty content', {
      context: 'initial-greeting',
      provider,
      model: modelName,
      characterName,
      hadProjectContext: !!projectContext,
      memoryCount: participantMemories?.length || 0,
    })
  }

  return trimmedContent
}
