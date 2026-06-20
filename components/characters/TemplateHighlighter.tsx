'use client'

import { useMemo, Fragment } from 'react'
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
 * to the two persistence paths:
 *   - `mainUpdates` — fields the character PUT body accepts (scalars, the full
 *     scenarios array, the single physicalDescription object).
 *   - `changedSystemPrompts` — system prompts, which the PUT schema strips and
 *     must persist through their dedicated per-prompt endpoint.
 * Only changed fields are emitted. The physicalDescription `name` is required by
 * the PUT schema, so it falls back to `'Appearance'` (matching the optimizer)
 * and is never itself transformed.
 */
export function applyTemplateTransform(
  character: TemplatableCharacter,
  transform: (text: string) => string
): {
  mainUpdates: Record<string, unknown>
  changedSystemPrompts: Array<{ id: string; content: string }>
} {
  const mainUpdates: Record<string, unknown> = {}
  const changedSystemPrompts: Array<{ id: string; content: string }> = []
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

  if (scenarioChanges.size > 0 && character.scenarios) {
    // PUT replaces the scenarios array wholesale, so send every scenario,
    // swapping content only on the ones that changed (spread preserves
    // title/createdAt/updatedAt at runtime).
    mainUpdates.scenarios = character.scenarios.map((scenario) =>
      scenarioChanges.has(scenario.id)
        ? { ...scenario, content: scenarioChanges.get(scenario.id)! }
        : scenario
    )
  }

  if (physicalChanges.size > 0 && character.physicalDescription) {
    const pd = character.physicalDescription
    const nextPhysical: Record<string, unknown> = { ...pd }
    for (const [sub, content] of physicalChanges) {
      nextPhysical[sub] = content
    }
    nextPhysical.name =
      typeof pd.name === 'string' && pd.name.trim() ? pd.name : 'Appearance'
    mainUpdates.physicalDescription = nextPhysical
  }

  return { mainUpdates, changedSystemPrompts }
}

interface TemplateDisplayProps {
  content: string
  characterName: string
  userCharacterName?: string | null
}

interface ContentMatch {
  type: 'char-template' | 'user-template' | 'char-hardcoded' | 'user-hardcoded'
  start: number
  end: number
  originalText: string
  replacement: string
}

/**
 * Displays text with template variables replaced and highlighted,
 * and also highlights hard-coded names that should be converted to templates.
 *
 * - {{char}} templates are replaced with character name (blue highlight, solid)
 * - {{user}} templates are replaced with user character name (green highlight, solid)
 * - Hard-coded character names are highlighted in orange/warning style
 * - Hard-coded user character names are highlighted in orange/warning style
 */
export function TemplateDisplay({
  content,
  characterName,
  userCharacterName,
}: TemplateDisplayProps) {
  const processedContent = useMemo(() => {
    if (!content) return null

    const userName = userCharacterName || 'USER'
    const matches: ContentMatch[] = []

    // Find {{char}} templates (case-insensitive)
    const charTemplateRegex = /\{\{char\}\}/gi
    let match
    while ((match = charTemplateRegex.exec(content)) !== null) {
      matches.push({
        type: 'char-template',
        start: match.index,
        end: match.index + match[0].length,
        originalText: match[0],
        replacement: characterName,
      })
    }

    // Find {{user}} templates (case-insensitive)
    const userTemplateRegex = /\{\{user\}\}/gi
    while ((match = userTemplateRegex.exec(content)) !== null) {
      matches.push({
        type: 'user-template',
        start: match.index,
        end: match.index + match[0].length,
        originalText: match[0],
        replacement: userName,
      })
    }

    // Find hard-coded character names (case-insensitive)
    if (characterName && characterName.length > 0) {
      const charNameRegex = new RegExp(escapeRegex(characterName), 'gi')
      while ((match = charNameRegex.exec(content)) !== null) {
        // Check for overlap with existing matches (templates take priority)
        const overlaps = matches.some(
          m => (match!.index >= m.start && match!.index < m.end) ||
               (match!.index + match![0].length > m.start && match!.index + match![0].length <= m.end)
        )
        if (!overlaps) {
          matches.push({
            type: 'char-hardcoded',
            start: match.index,
            end: match.index + match[0].length,
            originalText: match[0],
            replacement: match[0], // Keep the original text
          })
        }
      }
    }

    // Find hard-coded user character names (case-insensitive)
    if (userCharacterName && userCharacterName.length > 0) {
      const userCharacterNameRegex = new RegExp(escapeRegex(userCharacterName), 'gi')
      while ((match = userCharacterNameRegex.exec(content)) !== null) {
        // Check for overlap with existing matches (templates and char names take priority)
        const overlaps = matches.some(
          m => (match!.index >= m.start && match!.index < m.end) ||
               (match!.index + match![0].length > m.start && match!.index + match![0].length <= m.end)
        )
        if (!overlaps) {
          matches.push({
            type: 'user-hardcoded',
            start: match.index,
            end: match.index + match[0].length,
            originalText: match[0],
            replacement: match[0], // Keep the original text
          })
        }
      }
    }

    if (matches.length === 0) {
      return <>{content}</>
    }

    // Sort matches by start position
    matches.sort((a, b) => a.start - b.start)

    // Build highlighted content
    const parts: React.ReactNode[] = []
    let lastEnd = 0

    matches.forEach((contentMatch, index) => {
      // Add text before this match
      if (contentMatch.start > lastEnd) {
        parts.push(content.slice(lastEnd, contentMatch.start))
      }

      // Add highlighted text based on type
      switch (contentMatch.type) {
        case 'char-template':
          // Template replaced - shows nicely with blue/info styling
          parts.push(
            <span
              key={`char-template-${index}`}
              className="px-0.5 rounded border-b-2 qt-badge-chat qt-border-info"
              title="Character name (from {{char}})"
            >
              {contentMatch.replacement}
            </span>
          )
          break
        case 'user-template':
          // Template replaced - shows nicely with green/success styling
          parts.push(
            <span
              key={`user-template-${index}`}
              className="px-0.5 rounded border-b-2 qt-badge-user-character qt-border-success"
              title={userCharacterName ? `User character name (from {{user}})` : 'User (no default user character set)'}
            >
              {contentMatch.replacement}
            </span>
          )
          break
        case 'char-hardcoded':
          // Hard-coded character name - warning styling, should be converted
          parts.push(
            <span
              key={`char-hardcoded-${index}`}
              className="px-0.5 rounded border-b-2 border-dashed qt-bg-warning/10 qt-border-warning"
              title="Hard-coded character name - consider replacing with {{char}}"
            >
              {contentMatch.originalText}
            </span>
          )
          break
        case 'user-hardcoded':
          // Hard-coded user character name - warning styling, should be converted
          parts.push(
            <span
              key={`user-hardcoded-${index}`}
              className="px-0.5 rounded border-b-2 border-dashed qt-bg-warning/10 qt-border-warning"
              title="Hard-coded user character name - consider replacing with {{user}}"
            >
              {contentMatch.originalText}
            </span>
          )
          break
      }

      lastEnd = contentMatch.end
    })

    // Add remaining text
    if (lastEnd < content.length) {
      parts.push(content.slice(lastEnd))
    }

    return <>{parts}</>
  }, [content, characterName, userCharacterName])

  return (
    <span className="whitespace-pre-wrap">
      {processedContent}
    </span>
  )
}
