import type { GeneratedCharacterData } from '@/components/characters/ai-wizard'

/**
 * The AI Wizard's generated *character* text fields — the ones that are
 * columns (or vault files) of the character row and so travel in its PUT/POST
 * body. The wizard's generated **System Prompt** is deliberately not here: a
 * character has named system prompts, not a scalar, and a `systemPrompt` key
 * in a character body is stripped by the schema and lost (#146). It goes
 * through {@link generatedSystemPrompt} instead.
 */
export const GENERATED_CHARACTER_TEXT_FIELDS = [
  'name',
  'title',
  'identity',
  'description',
  'manifesto',
  'personality',
  'firstMessage',
  'exampleDialogues',
] as const

export type GeneratedCharacterTextField = (typeof GENERATED_CHARACTER_TEXT_FIELDS)[number]

export function getGeneratedCharacterTextEntries(data: GeneratedCharacterData): Array<{
  field: GeneratedCharacterTextField
  value: string
}> {
  return GENERATED_CHARACTER_TEXT_FIELDS.reduce<Array<{ field: GeneratedCharacterTextField; value: string }>>((acc, field) => {
    const value = data[field]
    if (value) {
      acc.push({ field, value })
    }
    return acc
  }, [])
}

/** The wizard's generated system prompt, trimmed, or null when it made none. */
export function generatedSystemPrompt(data: GeneratedCharacterData): string | null {
  const content = data.systemPrompt?.trim()
  return content ? content : null
}

/** The name a wizard-written or create-form system prompt is saved under. */
export const FIRST_SYSTEM_PROMPT_NAME = 'Default'

/**
 * A create-form system prompt as the `systemPrompts` array the character POST
 * accepts: one named prompt, the default. Empty text is no prompt at all.
 */
export function systemPromptsForCreate(
  content: string,
  now: string = new Date().toISOString(),
): Array<{ id: string; name: string; content: string; isDefault: boolean; createdAt: string; updatedAt: string }> {
  const trimmed = content.trim()
  if (!trimmed) return []
  return [
    {
      id: crypto.randomUUID(),
      name: FIRST_SYSTEM_PROMPT_NAME,
      content: trimmed,
      isDefault: true,
      createdAt: now,
      updatedAt: now,
    },
  ]
}

export function buildWizardCurrentData(data: {
  title: string
  identity: string
  description: string
  manifesto: string
  personality: string
  firstMessage?: string
  exampleDialogues: string
  systemPrompt: string
  pronouns?: { subject: string; object: string; possessive: string } | null
  aliases?: string[]
}) {
  return {
    title: data.title,
    identity: data.identity,
    description: data.description,
    manifesto: data.manifesto,
    personality: data.personality,
    firstMessage: data.firstMessage,
    exampleDialogues: data.exampleDialogues,
    systemPrompt: data.systemPrompt,
    pronouns: data.pronouns,
    aliases: data.aliases,
  }
}
