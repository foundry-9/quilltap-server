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

export interface GreetingResult {
  content: string
  /** True when the LLM consumed tokens but returned empty content — likely a content filter */
  contentFilterDetected: boolean
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
}: GreetingRequest): Promise<GreetingResult> {
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

  // Consume the provider's streaming endpoint so the greeting uses the same
  // path as normal chat replies. The chunks are concatenated server-side;
  // streaming them to the UI is a planned follow-up (see CHANGELOG v2.9.x).
  let accumulated = ''
  let finalUsage: { promptTokens: number; completionTokens: number; totalTokens: number } | undefined
  for await (const chunk of providerClient.streamMessage(
    {
      messages,
      model: modelName,
      temperature,
      maxTokens,
      topP,
    },
    apiKey ?? ''
  )) {
    if (chunk.content) {
      accumulated += chunk.content
    }
    if (chunk.usage) {
      finalUsage = {
        promptTokens: chunk.usage.promptTokens ?? 0,
        completionTokens: chunk.usage.completionTokens ?? 0,
        totalTokens: chunk.usage.totalTokens ?? 0,
      }
    }
  }

  const trimmedContent = accumulated.trim()
  const contentFilterDetected = !trimmedContent && !!finalUsage && finalUsage.completionTokens > 0

  if (contentFilterDetected) {
    logger.warn('[Greeting Generation] LLM returned empty content despite consuming tokens - likely content filter hit', {
      context: 'initial-greeting',
      provider,
      model: modelName,
      characterName,
      promptTokens: finalUsage!.promptTokens,
      completionTokens: finalUsage!.completionTokens,
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

  return { content: trimmedContent, contentFilterDetected }
}
