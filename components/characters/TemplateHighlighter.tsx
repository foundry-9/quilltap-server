'use client'

import { useMemo, Fragment } from 'react'

interface HighlightMatch {
  type: 'char' | 'user'
  start: number
  end: number
}

interface TemplateHighlighterProps {
  content: string
  characterName: string
  personaName?: string | null
  showHighlights?: boolean
}

/**
 * Highlights occurrences of character and persona names in text
 * that could be replaced with {{char}} and {{user}} templates.
 * Uses case-insensitive matching.
 */
export function TemplateHighlighter({
  content,
  characterName,
  personaName,
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

    // Find all persona name matches (case-insensitive)
    if (personaName && personaName.length > 0) {
      const userRegex = new RegExp(escapeRegex(personaName), 'gi')
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
            className="px-0.5 rounded border-b-2 qt-badge-chat border-blue-400 dark:border-blue-600"
            title={`Could be replaced with {{char}}`}
          >
            {matchedText}
          </span>
        )
      } else {
        parts.push(
          <span
            key={`user-${index}`}
            className="px-0.5 rounded border-b-2 qt-badge-persona border-green-400 dark:border-green-600"
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
  }, [content, characterName, personaName, showHighlights])

  return (
    <span className="whitespace-pre-wrap">
      {highlightedContent}
    </span>
  )
}

/**
 * Counts occurrences of character and persona names in text fields
 */
export function countTemplateReplacements(
  fields: Record<string, string | null | undefined>,
  characterName: string,
  personaName?: string | null
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

    if (personaName && personaName.length > 0) {
      const userRegex = new RegExp(escapeRegex(personaName), 'gi')
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

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Replaces template variables ({{char}}, {{user}}) with their actual values.
 * This is for display purposes when viewing a character (not editing).
 *
 * @param content - The text containing template variables
 * @param characterName - The character's name to replace {{char}} with
 * @param personaName - The persona's name to replace {{user}} with (defaults to "USER")
 * @returns The text with templates replaced with actual names
 */
export function replaceTemplatesWithNames(
  content: string,
  characterName: string,
  personaName?: string | null
): string {
  if (!content) return content

  let result = content

  // Replace {{char}} with character name (case-insensitive)
  if (characterName) {
    result = result.replace(/\{\{char\}\}/gi, characterName)
  }

  // Replace {{user}} with persona name or "USER" (case-insensitive)
  const userName = personaName || 'USER'
  result = result.replace(/\{\{user\}\}/gi, userName)

  return result
}

interface TemplateDisplayProps {
  content: string
  characterName: string
  personaName?: string | null
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
 * - {{user}} templates are replaced with persona name (green highlight, solid)
 * - Hard-coded character names are highlighted in orange/warning style
 * - Hard-coded persona names are highlighted in orange/warning style
 */
export function TemplateDisplay({
  content,
  characterName,
  personaName,
}: TemplateDisplayProps) {
  const processedContent = useMemo(() => {
    if (!content) return null

    const userName = personaName || 'USER'
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

    // Find hard-coded persona names (case-insensitive)
    if (personaName && personaName.length > 0) {
      const personaNameRegex = new RegExp(escapeRegex(personaName), 'gi')
      while ((match = personaNameRegex.exec(content)) !== null) {
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
              className="px-0.5 rounded border-b-2 qt-badge-chat border-blue-400 dark:border-blue-600"
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
              className="px-0.5 rounded border-b-2 qt-badge-persona border-green-400 dark:border-green-600"
              title={personaName ? `Persona name (from {{user}})` : 'User (no default persona set)'}
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
              className="px-0.5 rounded border-b-2 border-dashed bg-amber-100/50 dark:bg-amber-900/30 border-amber-500 dark:border-amber-400"
              title="Hard-coded character name - consider replacing with {{char}}"
            >
              {contentMatch.originalText}
            </span>
          )
          break
        case 'user-hardcoded':
          // Hard-coded persona name - warning styling, should be converted
          parts.push(
            <span
              key={`user-hardcoded-${index}`}
              className="px-0.5 rounded border-b-2 border-dashed bg-orange-100/50 dark:bg-orange-900/30 border-orange-500 dark:border-orange-400"
              title="Hard-coded persona name - consider replacing with {{user}}"
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
  }, [content, characterName, personaName])

  return (
    <span className="whitespace-pre-wrap">
      {processedContent}
    </span>
  )
}
