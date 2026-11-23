'use client'

import { useMemo } from 'react'
import { escapeRegex } from '@/lib/utils/regex'

interface HighlightMatch {
  type: 'char' | 'user'
  start: number
  end: number
}

interface TemplateHighlighterProps {
  content: string
  characterName: string
  userCharacterName?: string | null
  showHighlights?: boolean
}

/**
 * Highlights occurrences of character and user character names in text
 * that could be replaced with {{char}} and {{user}} templates.
 * Uses case-insensitive matching.
 */
export function TemplateHighlighter({
  content,
  characterName,
  userCharacterName,
  showHighlights = true,
}: TemplateHighlighterProps) {
  const { highlightedContent, charCount, userCount } = useMemo(() => {
    if (!content || !showHighlights) {
      return { highlightedContent: content, charCount: 0, userCount: 0 }
    }

    const matches: HighlightMatch[] = []

    // Find all character name matches (case-insensitive)
    if (characterName && characterName.length > 0) {
      const charRegex = new RegExp(escapeRegex(characterName), 'gi')
      let match
      while ((match = charRegex.exec(content)) !== null) {
        matches.push({
          type: 'char',
          start: match.index,
          end: match.index + match[0].length,
        })
      }
    }

    // Find all user character name matches (case-insensitive)
    if (userCharacterName && userCharacterName.length > 0) {
      const userRegex = new RegExp(escapeRegex(userCharacterName), 'gi')
      let match
      while ((match = userRegex.exec(content)) !== null) {
        // Check for overlap with existing matches
        const overlaps = matches.some(
          m => (match!.index >= m.start && match!.index < m.end) ||
               (match!.index + match![0].length > m.start && match!.index + match![0].length <= m.end)
        )
        if (!overlaps) {
          matches.push({
            type: 'user',
            start: match.index,
            end: match.index + match[0].length,
          })
        }
      }
    }

    // Sort matches by start position
    matches.sort((a, b) => a.start - b.start)

    // Count matches
    const charCount = matches.filter(m => m.type === 'char').length
    const userCount = matches.filter(m => m.type === 'user').length

    if (matches.length === 0) {
      return { highlightedContent: content, charCount: 0, userCount: 0 }
    }

    // Build highlighted content
    const parts: React.ReactNode[] = []
    let lastEnd = 0

    matches.forEach((match, index) => {
      // Add text before this match
      if (match.start > lastEnd) {
        parts.push(content.slice(lastEnd, match.start))
      }

      // Add highlighted text
      const matchedText = content.slice(match.start, match.end)
      if (match.type === 'char') {
        parts.push(
          <span
            key={`char-${index}`}
            className="px-0.5 rounded border-b-2 qt-badge-chat qt-border-info"
            title={`Could be replaced with {{char}}`}
          >
            {matchedText}
          </span>
        )
      } else {
        parts.push(
          <span
            key={`user-${index}`}
            className="px-0.5 rounded border-b-2 qt-badge-user-character qt-border-success"
            title={`Could be replaced with {{user}}`}
          >
            {matchedText}
          </span>
        )
      }

      lastEnd = match.end
    })

    // Add remaining text
    if (lastEnd < content.length) {
      parts.push(content.slice(lastEnd))
    }

    return {
      highlightedContent: <>{parts}</>,
      charCount,
      userCount,
    }
  }, [content, characterName, userCharacterName, showHighlights])

  return (
    <span className="whitespace-pre-wrap">
      {highlightedContent}
    </span>
  )
}

/**
 * Counts occurrences of character and user character names in text fields
 */
export function countTemplateReplacements(
  fields: Record<string, string | null | undefined>,
  characterName: string,
  userCharacterName?: string | null
): { charCount: number; userCount: number; fieldCounts: Record<string, { char: number; user: number }> } {
  let charCount = 0
  let userCount = 0
  const fieldCounts: Record<string, { char: number; user: number }> = {}

  for (const [field, content] of Object.entries(fields)) {
    if (!content) {
      fieldCounts[field] = { char: 0, user: 0 }
      continue
    }

    let fieldCharCount = 0
    let fieldUserCount = 0

    if (characterName && characterName.length > 0) {
      const charRegex = new RegExp(escapeRegex(characterName), 'gi')
      const charMatches = content.match(charRegex)
      fieldCharCount = charMatches?.length || 0
    }

    if (userCharacterName && userCharacterName.length > 0) {
      const userRegex = new RegExp(escapeRegex(userCharacterName), 'gi')
      const userMatches = content.match(userRegex)
      fieldUserCount = userMatches?.length || 0
    }

    fieldCounts[field] = { char: fieldCharCount, user: fieldUserCount }
    charCount += fieldCharCount
    userCount += fieldUserCount
  }

  return { charCount, userCount, fieldCounts }
}

/**
 * Replaces all occurrences of a name with a template variable
 */
export function replaceWithTemplate(
  content: string,
  name: string,
  template: string,
  caseSensitive: boolean = false
): string {
  if (!content || !name) return content

  const flags = caseSensitive ? 'g' : 'gi'
  const regex = new RegExp(escapeRegex(name), flags)
  return content.replace(regex, template)
}

/**
 * Replaces every `{{char}}` (or `{{user}}`) template literal with a concrete
 * name — the inverse of {@link replaceWithTemplate}. Case-insensitive so it
 * catches the same `{{Char}}`/`{{USER}}` casings the template runtime accepts.
 * Uses a function replacer so a name containing `$` is inserted literally
 * (String.prototype.replace treats `$&`, `$1`, `$$` specially in a string
 * replacement, but not in a function one).
 */
export function replaceTemplateWithName(
  content: string,
  which: 'char' | 'user',
  name: string
): string {
  if (!content) return content
  const regex = which === 'char' ? /\{\{char\}\}/gi : /\{\{user\}\}/gi
  return content.replace(regex, () => name)
}

/**
 * Counts `{{char}}` and `{{user}}` template literals across a set of strings.
 * Drives visibility of the reverse ("restore name") buttons.
 */
export function countTemplateLiterals(
  values: Array<string | null | undefined>
): { charCount: number; userCount: number } {
  let charCount = 0
  let userCount = 0
  for (const value of values) {
    if (!value) continue
    charCount += value.match(/\{\{char\}\}/gi)?.length ?? 0
    userCount += value.match(/\{\{user\}\}/gi)?.length ?? 0
  }
  return { charCount, userCount }
}

/**
 * The minimal character shape the template collector/transform need. Both the
 * Aurora view `Character` and the schema `Character` are structurally
 * compatible; arrays/objects carry extra fields at runtime that the transform
 * preserves via spread even though they are not declared here.
 */
export interface TemplatableCharacter {
  name: string
  identity?: string | null
  manifesto?: string | null
  description?: string | null
  personality?: string | null
  firstMessage?: string | null
  exampleDialogues?: string | null
  scenarios?: ReadonlyArray<{ id: string; content: string }> | null
  systemPrompts?: ReadonlyArray<{ id: string; content: string }> | null
  physicalDescription?: {
    id?: string
    name?: string | null
    fullDescription?: string | null
    shortPrompt?: string | null
    mediumPrompt?: string | null
    longPrompt?: string | null
    completePrompt?: string | null
  } | null
}

type TemplatableScalarField =
  | 'identity'
  | 'manifesto'
  | 'description'
  | 'personality'
  | 'firstMessage'
  | 'exampleDialogues'

type PhysicalSubField =
  | 'fullDescription'
  | 'shortPrompt'
  | 'mediumPrompt'
  | 'longPrompt'
  | 'completePrompt'

/** One templatable text slice on a character, tagged for write-back routing. */
export type TemplateFieldDescriptor =
  | { key: string; kind: 'scalar'; field: TemplatableScalarField; value: string | null | undefined }
  | { key: string; kind: 'scenario'; id: string; value: string }
  | { key: string; kind: 'systemPrompt'; id: string; value: string }
  | { key: string; kind: 'physical'; id: string; sub: PhysicalSubField; value: string | null | undefined }

const SCALAR_FIELDS: TemplatableScalarField[] = [
  'identity',
  'manifesto',
  'description',
  'personality',
  'firstMessage',
  'exampleDialogues',
]

const PHYSICAL_SUBS: PhysicalSubField[] = [
  'fullDescription',
  'shortPrompt',
  'mediumPrompt',
  'longPrompt',
  'completePrompt',
]

/**
 * The single source of truth for which character fields participate in
 * `{{char}}`/`{{user}}` templating. Counting and the transform both walk this
 * list, so they can never drift out of sync (the bug this replaced). Scalar
 * descriptor keys are the bare field names so the per-field count badges in the
 * details view keep working. `title` and the physical-description `name` are
 * intentionally excluded.
 */
export function collectTemplateFields(
  character: TemplatableCharacter
): TemplateFieldDescriptor[] {
  const descriptors: TemplateFieldDescriptor[] = []

  for (const field of SCALAR_FIELDS) {
    descriptors.push({ key: field, kind: 'scalar', field, value: character[field] })
  }

  for (const scenario of character.scenarios ?? []) {
    descriptors.push({
      key: `scenario:${scenario.id}`,
      kind: 'scenario',
      id: scenario.id,
      value: scenario.content,
    })
  }

  for (const prompt of character.systemPrompts ?? []) {
    descriptors.push({
      key: `systemPrompt:${prompt.id}`,
      kind: 'systemPrompt',
      id: prompt.id,
      value: prompt.content,
    })
  }

  const pd = character.physicalDescription
  if (pd) {
    const pdId = pd.id ?? 'physical'
    for (const sub of PHYSICAL_SUBS) {
      descriptors.push({
        key: `physicalDescription:${pdId}:${sub}`,
        kind: 'physical',
        id: pdId,
        sub,
        value: pd[sub],
      })
    }
  }

  return descriptors
}

/**
 * Applies a text transform (forward: name → template; reverse: template → name)
 * across every field {@link collectTemplateFields} yields, routing the results
 * to the persistence paths:
 *   - `mainUpdates` — fields the character PUT body accepts (scalars and the
 *     single physicalDescription object).
 *   - `changedSystemPrompts` / `changedScenarios` — the sub-collections, which
 *     the PUT refuses and which persist one item each through their own routes.
 * Only changed fields are emitted.
 */
export function applyTemplateTransform(
  character: TemplatableCharacter,
  transform: (text: string) => string
): {
  mainUpdates: Record<string, unknown>
  changedSystemPrompts: Array<{ id: string; content: string }>
  changedScenarios: Array<{ id: string; content: string }>
} {
  const mainUpdates: Record<string, unknown> = {}
  const changedSystemPrompts: Array<{ id: string; content: string }> = []
  const changedScenarios: Array<{ id: string; content: string }> = []
  const scenarioChanges = new Map<string, string>()
  const physicalChanges = new Map<PhysicalSubField, string>()

  for (const descriptor of collectTemplateFields(character)) {
    if (!descriptor.value) continue
    const next = transform(descriptor.value)
    if (next === descriptor.value) continue

    switch (descriptor.kind) {
      case 'scalar':
        mainUpdates[descriptor.field] = next
        break
      case 'systemPrompt':
        changedSystemPrompts.push({ id: descriptor.id, content: next })
        break
      case 'scenario':
        scenarioChanges.set(descriptor.id, next)
        break
      case 'physical':
        physicalChanges.set(descriptor.sub, next)
        break
    }
  }

  // Scenarios go through their per-item route, naming only the content that
  // changed — never the whole array, which used to un-archive scenarios (#150).
  for (const [id, content] of scenarioChanges) {
    changedScenarios.push({ id, content })
  }

  // The physical description is sent whole (its text fields), with the
  // changed ones swapped in. The id and timestamps are the server's.
  if (physicalChanges.size > 0 && character.physicalDescription) {
    const pd = character.physicalDescription
    const nextPhysical: Record<string, unknown> = {}
    for (const sub of PHYSICAL_SUBS) {
      if (pd[sub] !== undefined) nextPhysical[sub] = pd[sub]
    }
    for (const [sub, content] of physicalChanges) {
      nextPhysical[sub] = content
    }
    mainUpdates.physicalDescription = nextPhysical
  }

  return { mainUpdates, changedSystemPrompts, changedScenarios }
}
