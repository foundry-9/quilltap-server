/**
 * In-conversation search ("find in this chat").
 *
 * The header search bar first looks inside the Salon conversation the operator
 * is looking at, then runs the ordinary global search beneath it. The open
 * Salon publishes a {@link ConversationSearchSource} through the page toolbar
 * context (per tab in the workspace, so it is always the *focused* chat's); the
 * search bar asks it for matches, reveals the one picked, and has it paint the
 * query on screen.
 *
 * The matcher here is pure and client-safe. It reads the messages the Salon
 * already holds — exactly the rows it shows (whisper filtering, the current
 * swipe variant) — so it needs no request and can never find a line the
 * operator could not have scrolled to.
 *
 * @module lib/chat/conversation-search
 */

/** The shortest query either half of the search bar acts on. */
export const CONVERSATION_SEARCH_MIN_QUERY = 2

/** One message of the open conversation that contains the query. */
export interface ConversationMatch {
  messageId: string
  /** Who said it, as the Salon names them; null when unknown. */
  speaker: string | null
  /** True for a Staff announcement (it may be collapsed to a chip on screen). */
  isAnnouncement: boolean
  /** Plain-text excerpt around the first occurrence. */
  snippet: string
  /** Occurrences of the query in this message. */
  occurrences: number
  createdAt: string
}

/**
 * What an open conversation offers the search bar. The object is stable for the
 * life of the chat view; it reads the current transcript each time it is asked.
 */
export interface ConversationSearchSource {
  chatId: string
  /** Matches, newest first, at most `limit` of them; `total` counts them all. */
  search(query: string, limit: number): { matches: ConversationMatch[]; total: number }
  /** Scroll the message into view (top of it), expanding a collapsed announcement. */
  reveal(messageId: string): void
  /** Paint every visible occurrence of `query` in the transcript; null clears. */
  setHighlight(query: string | null): void
}

/** The fields of a Salon message the matcher reads. */
export interface SearchableMessage {
  id: string
  role: string
  content: string
  createdAt: string
  systemSender?: string | null
}

/**
 * Markdown, reduced to roughly what the reader sees: emphasis and code fences
 * gone, links and images down to their text, whitespace collapsed. Matching on
 * this rather than the source is what lets "a fine morning" find
 * `a *fine* morning`.
 */
export function toSearchableText(markdown: string): string {
  return markdown
    .replace(/```[^\n]*\n?/g, '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/^\s{0,3}(#{1,6}|>+|[-*+]|\d+\.)\s+/gm, '')
    .replace(/(\*\*|__|\*|_|~~|`)/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Escape a string for use as a literal inside a RegExp. */
export function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** A case-insensitive, global matcher for the query, or null when it is too short. */
export function conversationQueryPattern(query: string): RegExp | null {
  const trimmed = query.trim()
  if (trimmed.length < CONVERSATION_SEARCH_MIN_QUERY) return null
  return new RegExp(escapeRegExp(trimmed), 'giu')
}

const SNIPPET_LEAD = 40
const SNIPPET_LENGTH = 140

function snippetAround(text: string, index: number, matchLength: number): string {
  const start = Math.max(0, index - SNIPPET_LEAD)
  const end = Math.min(text.length, Math.max(start + SNIPPET_LENGTH, index + matchLength))
  return `${start > 0 ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`
}

/**
 * Find the query in a conversation. Messages come in transcript order; matches
 * go out newest first, since the newest line is the one nearest the reader.
 * TOOL rows are skipped — their bodies are payloads, not things anyone said.
 */
export function findConversationMatches<M extends SearchableMessage>(
  messages: readonly M[],
  query: string,
  options: { limit: number; speakerOf?: (message: M) => string | null },
): { matches: ConversationMatch[]; total: number } {
  const pattern = conversationQueryPattern(query)
  if (!pattern) return { matches: [], total: 0 }

  const matches: ConversationMatch[] = []
  let total = 0
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]
    if (message.role === 'TOOL' || !message.content) continue
    const text = toSearchableText(message.content)
    pattern.lastIndex = 0
    const first = pattern.exec(text)
    if (!first) continue
    total++
    if (matches.length >= options.limit) continue
    let occurrences = 1
    while (pattern.exec(text)) occurrences++
    matches.push({
      messageId: message.id,
      speaker: options.speakerOf?.(message) ?? null,
      isAnnouncement: !!message.systemSender,
      snippet: snippetAround(text, first.index, first[0].length),
      occurrences,
      createdAt: message.createdAt,
    })
  }
  return { matches, total }
}
