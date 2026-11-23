/**
 * A one-line excerpt of a chat's context summary.
 *
 * The context summary is Markdown written for a model: headings ("## Active
 * threads"), bullets, emphasis. The home page's resume card wants one plain
 * sentence or two saying where things stand, so this takes the first line that
 * carries content, strips the Markdown from it and cuts it at a word boundary.
 *
 * Pure and client-safe.
 *
 * @module lib/chat/summary-excerpt
 */

/** Longest excerpt returned, in characters (the ellipsis included). */
export const SUMMARY_EXCERPT_MAX = 240

/** A line that is only a heading: `## Title`, `**Title**` or `Title:`. */
function isHeadingLine(line: string): boolean {
  if (/^#{1,6}\s/.test(line)) return true
  if (/^(\*\*|__)[^*_]+(\*\*|__):?$/.test(line)) return true
  return false
}

/** Remove list markers and inline Markdown, leaving the words. */
function stripMarkdown(line: string): string {
  return line
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '')
    .replace(/^>\s*/, '')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    // Emphasis hugs its words: "*sealed*" is, "2 * 3 * 4" is not.
    .replace(/(^|[\s(])[*_]([^\s*_](?:[^*_]*[^\s*_])?)[*_](?=$|[\s).,;:!?])/g, '$1$2')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * The first content line of a context summary as plain text, at most
 * `max` characters. `null` when the summary is empty or holds only headings.
 */
export function summaryExcerpt(summary: string | null | undefined, max: number = SUMMARY_EXCERPT_MAX): string | null {
  if (!summary) return null

  for (const raw of summary.split('\n')) {
    const line = raw.trim()
    if (!line || isHeadingLine(line) || /^[-*_]{3,}$/.test(line)) continue
    const text = stripMarkdown(line)
    if (!text) continue
    if (text.length <= max) return text

    const cut = text.slice(0, max - 1)
    const lastSpace = cut.lastIndexOf(' ')
    const body = lastSpace > max / 2 ? cut.slice(0, lastSpace) : cut
    return `${body.replace(/[\s.,;:—–-]+$/, '')}…`
  }

  return null
}
