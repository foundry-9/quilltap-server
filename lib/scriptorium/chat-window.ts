/**
 * Which chats fall in a time window.
 *
 * One place for the question "which conversations happened during this
 * period?", asked by the search tool (window-first conversation search and
 * the window census) and by per-turn retrospective recall (unsummarized chats
 * in the mini-recap). A chat's span is `[createdAt, lastMessageAt]`, falling
 * back to `updatedAt` and then `createdAt` — never `updatedAt` first, because
 * a retitle or a maintenance write bumps it without anything having happened.
 *
 * @module scriptorium/chat-window
 */

import type { ChatMetadata } from '@/lib/schemas/types'
import { getRepositories } from '@/lib/repositories/factory'
import { createServiceLogger } from '@/lib/logging/create-logger'

const logger = createServiceLogger('ChatWindow')

export interface ChatSpan {
  start: number
  end: number
}

export interface TimeWindow {
  from: string
  to: string
}

type SpanFields = Pick<ChatMetadata, 'createdAt' | 'updatedAt' | 'lastMessageAt'>

/** `[createdAt, lastMessageAt ?? updatedAt ?? createdAt]` in ms; null when createdAt is unparseable. */
export function chatSpanOf(chat: SpanFields): ChatSpan | null {
  const start = Date.parse(chat.createdAt)
  if (!Number.isFinite(start)) return null
  for (const candidate of [chat.lastMessageAt, chat.updatedAt]) {
    if (!candidate) continue
    const end = Date.parse(candidate)
    if (Number.isFinite(end)) return { start, end: Math.max(start, end) }
  }
  return { start, end: start }
}

/** True when the chat's span overlaps `[from, to]` (ISO strings, inclusive). */
export function chatOverlapsWindow(chat: SpanFields, window: TimeWindow): boolean {
  const span = chatSpanOf(chat)
  if (!span) return false
  const from = Date.parse(window.from)
  const to = Date.parse(window.to)
  if (!Number.isFinite(from) || !Number.isFinite(to)) return false
  return span.start <= to && span.end >= from
}

/** Newest first, by the end of the chat's span. */
function newestFirst(a: SpanFields, b: SpanFields): number {
  return (chatSpanOf(b)?.end ?? 0) - (chatSpanOf(a)?.end ?? 0)
}

/**
 * The chats a character (or, with no characterId, the user — the operator
 * surface) took part in whose span overlaps the window, newest first.
 * Reads `repos.chats.findByCharacterId` / `findByUserId` once. A read failure
 * is logged and answers empty.
 */
export async function findChatsInWindow(opts: {
  characterId?: string
  userId: string
  window: TimeWindow
  excludeChatId?: string
}): Promise<ChatMetadata[]> {
  const repos = getRepositories()
  let candidates: ChatMetadata[]
  try {
    candidates = opts.characterId
      ? await repos.chats.findByCharacterId(opts.characterId)
      : await repos.chats.findByUserId(opts.userId)
  } catch (error) {
    logger.warn('Could not read chats for a time window', {
      characterId: opts.characterId,
      userId: opts.userId,
      error: error instanceof Error ? error.message : String(error),
    })
    return []
  }
  const inWindow = (candidates ?? [])
    .filter(chat => chat.id !== opts.excludeChatId && chatOverlapsWindow(chat, opts.window))
    .sort(newestFirst)
  logger.debug('Chats in time window', {
    characterId: opts.characterId,
    from: opts.window.from,
    to: opts.window.to,
    candidates: candidates?.length ?? 0,
    inWindow: inWindow.length,
  })
  return inWindow
}
