/**
 * Scriptorium Annotation Merger
 *
 * Merges conversation annotations into rendered Markdown as fenced code blocks,
 * and strips them back out when clean markdown is needed.
 *
 * @module scriptorium/annotation-merger
 */

import type { ConversationAnnotation } from '@/lib/schemas/types'

/**
 * Merges annotations into rendered conversation Markdown.
 *
 * After each `### Message {n}` section (and its content), inserts any matching
 * annotations as fenced code blocks. Multiple annotations on the same message
 * are inserted in order by characterName.
 *
 * @param markdown - Rendered conversation Markdown from renderConversationMarkdown
 * @param annotations - Array of conversation annotations to merge in
 * @returns Markdown with annotation blocks inserted after their target messages
 */
export function mergeAnnotations(
  markdown: string,
  annotations: ConversationAnnotation[],
): string {
  if (annotations.length === 0) return markdown

  // Group annotations by messageIndex, sorted by characterName within each group
  const byIndex = new Map<number, ConversationAnnotation[]>()
  for (const ann of annotations) {
    const existing = byIndex.get(ann.messageIndex) || []
    existing.push(ann)
    byIndex.set(ann.messageIndex, existing)
  }
  for (const group of byIndex.values()) {
    group.sort((a, b) => a.characterName.localeCompare(b.characterName))
  }

  // Split markdown into sections by message headers
  // Each section starts at a `### Message {n}` header
  const messageHeaderPattern = /^### Message (\d+)/m
  const lines = markdown.split('\n')
  const result: string[] = []

  let currentMessageIndex: number | null = null

  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(messageHeaderPattern)

    if (match) {
      // Before starting a new message, flush annotations for the previous message
      if (currentMessageIndex !== null && byIndex.has(currentMessageIndex)) {
        const anns = byIndex.get(currentMessageIndex)!
        for (const ann of anns) {
          result.push(`\`\`\`annotation:${ann.characterName}`)
          result.push(ann.content)
          result.push('```')
          result.push('')
        }
      }
      currentMessageIndex = parseInt(match[1], 10)
    }

    result.push(lines[i])
  }

  // Flush annotations for the last message
  if (currentMessageIndex !== null && byIndex.has(currentMessageIndex)) {
    const anns = byIndex.get(currentMessageIndex)!
    for (const ann of anns) {
      result.push(`\`\`\`annotation:${ann.characterName}`)
      result.push(ann.content)
      result.push('```')
      result.push('')
    }
  }

  return result.join('\n')
}

/**
 * Strips all annotation fenced code blocks from Markdown.
 *
 * Removes blocks matching the pattern:
 * ```annotation:{characterName}
 * {content}
 * ```
 *
 * @param markdown - Markdown that may contain annotation blocks
 * @returns Clean markdown without any annotation blocks
 */
export function stripAnnotations(markdown: string): string {
  // Match annotation fenced code blocks: ```annotation:... through closing ```
  // Use multiline mode so ^ matches line starts
  const annotationPattern = /^```annotation:[^\n]*\n[\s\S]*?^```\n?/gm
  return markdown.replace(annotationPattern, '').replace(/\n{3,}/g, '\n\n')
}
