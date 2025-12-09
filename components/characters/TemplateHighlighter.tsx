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
