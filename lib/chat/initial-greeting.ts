// Initial Greeting Helper
// Generates a first message for a chat when no scripted greeting exists

import { createLLMProvider } from '@/lib/llm'
import { logger } from '@/lib/logger'

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
}: GreetingRequest): Promise<string> {
  const providerClient = await createLLMProvider(provider, baseUrl || undefined)

  const augmentedSystemPrompt = `${systemPrompt}\n\nYou are starting a brand new conversation. Before the user says anything, open with a concise greeting that fits ${characterName}'s established voice. Keep it to one or two sentences.`

  const messages = [
    { role: 'system' as const, content: augmentedSystemPrompt },
    {
      role: 'user' as const,
      content: 'The chat is beginning now. Greet the user immediately in-character and invite them to engage.',
    },
  ]

  // Debug log: LLM request
  logger.debug('[LLM Request] initial-greeting.ts:generateGreetingMessage', {
    context: 'llm-api',
    provider,
    model: modelName,
    characterName,
    systemPromptLength: augmentedSystemPrompt.length,
    messages: JSON.stringify(messages.map(m => ({
      role: m.role,
      contentLength: m.content.length,
    }))),
    params: JSON.stringify({ temperature, maxTokens: maxTokens ?? 160, topP }),
  })

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
  logger.debug('[LLM Response] initial-greeting.ts:generateGreetingMessage', {
    context: 'llm-api',
    provider,
    model: modelName,
    responseLength: response.content?.length || 0,
    response: response.content,
    usage: response.usage ? JSON.stringify(response.usage) : undefined,
  })

  return (response.content || '').trim()
}
