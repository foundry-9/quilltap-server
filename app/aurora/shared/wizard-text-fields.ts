import type { GeneratedCharacterData } from '@/components/characters/ai-wizard'

export const GENERATED_CHARACTER_TEXT_FIELDS = [
  'name',
  'title',
  'identity',
  'description',
  'manifesto',
  'personality',
  'exampleDialogues',
  'systemPrompt',
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

export function buildWizardCurrentData(data: {
  title: string
  identity: string
  description: string
  manifesto: string
  personality: string
  exampleDialogues: string
  systemPrompt: string
}) {
  return {
    title: data.title,
    identity: data.identity,
    description: data.description,
    manifesto: data.manifesto,
    personality: data.personality,
    exampleDialogues: data.exampleDialogues,
    systemPrompt: data.systemPrompt,
  }
}
