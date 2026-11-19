/**
 * Brahma Lookup Tool Handlers (Brahma Console — operator shortcuts)
 *
 * The four read-only shortcuts the Brahma Console reaches for before it falls
 * back to hand-written SQL:
 *
 *   - `lookup_character` — a character's core fields, memory count and
 *     conversations in one call.
 *   - `lookup_memories`  — a relevance search over one character's (or every
 *     character's) Commonplace Book, as inspection: nothing is stamped as
 *     recalled (no access stamp is written), so a lookup never changes what a character
 *     will remember next.
 *   - `lookup_messages`  — the FTS5 message index (`searchMessagesGlobal`, the
 *     same path as the global search bar), with conversation titles, dates and
 *     speaker names attached.
 *   - `read_messages`    — a bounded, speaker-labelled slice of one
 *     conversation.
 *
 * Every one of them answers in the operator's terms (names, titles, dates)
 * rather than raw rows, and every text field is truncated, so a single call can
 * never flood the console's context the way an unbounded `run_sql` dump did.
 *
 * Errors are returned as data (`{ success: false, error }`), never thrown, so
 * the model can read the message and adjust.
 */

import { createServiceLogger } from '@/lib/logging/create-logger'
import { getRepositories } from '@/lib/repositories/factory'
import type { Character, ChatMetadata, MessageEvent } from '@/lib/schemas/types'
import { isCharacterAuthoredMessage } from '@/lib/chat/chat-activity'
import { resolveSpeakerNames, speakerLabel } from '@/lib/chat/speaker-names'
import { searchMemories } from '@/lib/memory/recall/search'
import type { RecallCandidate } from '@/lib/memory/recall/types'
import { filterImportance } from '@/lib/memory/scoring'
import { zonedDayBoundsIso } from '@/lib/memory/time/calendar'
import { refreshMemoryTimeZone } from '@/lib/memory/time/calendar-refresh'
import type { EmbeddingResult } from '@/lib/embedding/embedding-service'
import { memoryArchivedLabel } from './search-scriptorium-handler'
import { lookupCharacterToolInputSchema } from '../lookup-character-tool'
import { lookupMemoriesToolInputSchema } from '../lookup-memories-tool'
import { lookupMessagesToolInputSchema } from '../lookup-messages-tool'
import { readMessagesToolInputSchema } from '../read-messages-tool'
import { composePublicIdentity } from '@/lib/characters/public-identity'
import { resolveCharacterRef, type CharacterMatch } from '@/lib/research/characters'
import { storeAddress, storeOutline } from '@/lib/research/outline'
import { resolveConversationRef } from '@/lib/research/conversations'
import { capRecords, containsAll, searchTerms } from '@/lib/research/text'

const logger = createServiceLogger('BrahmaLookup')

/** The databases are per-instance; `userId` is carried for attribution only. */
export interface BrahmaLookupToolContext {
  userId: string
}

export type BrahmaLookupResult =
  | ({ success: true } & Record<string, unknown>)
  | { success: false; error: string }

/** Conversation types an operator means by "conversations". */
const CONVERSATION_CHAT_TYPES = new Set(['salon', 'autonomous'])

/** Text budgets, in characters. */
const CORE_FIELD_CHARS = 3000
const PHYSICAL_CHARS = 1500
/** A memory hit's opening, unless `full` (research kit §5.8). */
const MEMORY_CHARS = 300
/** A spoken line's length, unless `full` (research kit §5.8). */
export const MESSAGE_LINE_CHARS = 1500
/** A plain message search with more hits than this says so and suggests grouping. */
const UNGROUPED_HIT_NOTE_OVER = 30
/** Vault outline lines shown by lookup_character. */
const VAULT_OUTLINE_LINES = 20
const SNIPPET_CHARS = 320
const RECENT_CONVERSATIONS = 8
/** How many holders a "search everyone" memory query may visit. */
const MAX_HOLDERS = 60
/** Over-fetch for message searches that are post-filtered by speaker or date. */
const MESSAGE_OVERFETCH = 200

// ============================================================================
// Shared helpers
// ============================================================================

function clip(text: string | null | undefined, max: number): string | null {
  if (!text) return null
  const trimmed = text.trim()
  if (!trimmed) return null
  return trimmed.length > max ? `${trimmed.slice(0, max)}… [truncated, ${trimmed.length} chars in all]` : trimmed
}

/** Cut a line at `max` characters with a `[+N characters]` marker. */
function capLine(text: string | null | undefined, max: number): string {
  const trimmed = (text ?? '').trim()
  return trimmed.length > max ? `${trimmed.slice(0, max)}… [+${trimmed.length - max} characters]` : trimmed
}

function invalid(tool: string, issues: { path: PropertyKey[]; message: string }[]): BrahmaLookupResult {
  const issue = issues[0]
  return {
    success: false,
    error: `Invalid ${tool} input: ${issue ? `${issue.path.join('.')} — ${issue.message}` : 'malformed arguments'}.`,
  }
}

/** A resolution failure, phrased for the model. */
function unresolved(ref: string, match: CharacterMatch): BrahmaLookupResult {
  if (match.kind === 'ambiguous') {
    return {
      success: false,
      error: `"${ref}" matches more than one character; pass one of these ids instead: ${match.candidates
        .map(c => `${c.name} (${c.id})`)
        .join(', ')}.`,
    }
  }
  return { success: false, error: `No character matches "${ref}". Try another spelling, an alias, or lookup_character.` }
}

/**
 * Date-only bounds widen to whole LOCAL days on the memory calendar (bug 212),
 * matching the `search` tool; a full timestamp passes through.
 */
async function resolveWindow(since?: string, until?: string): Promise<{ from: string; to: string } | null> {
  if (!since && !until) return null
  const tz = await refreshMemoryTimeZone()
  const from = since
    ? (since.length === 10 ? zonedDayBoundsIso(since, tz)?.from ?? `${since}T00:00:00.000Z` : since)
    : '0000-01-01T00:00:00.000Z'
  const to = until
    ? (until.length === 10 ? zonedDayBoundsIso(until, tz)?.to ?? `${until}T23:59:59.999Z` : until)
    : '9999-12-31T23:59:59.999Z'
  return { from, to }
}

/** Load chats by id once each, for titles and dates. */
async function loadChats(ids: Iterable<string>): Promise<Map<string, ChatMetadata>> {
  const repos = getRepositories()
  const out = new Map<string, ChatMetadata>()
  for (const id of new Set(ids)) {
    try {
      const chat = await repos.chats.findById(id)
      if (chat) out.set(id, chat)
    } catch (error) {
      logger.debug('Chat lookup failed while labelling results', {
        chatId: id,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
  return out
}

function conversationRef(chat: ChatMetadata | undefined, id: string | null | undefined) {
  if (!id) return null
  return chat
    ? { id, title: chat.title || 'Untitled', createdAt: chat.createdAt, chatType: chat.chatType }
    : { id, title: null, note: 'conversation no longer exists' }
}

/** A window of `text` around the first query word it contains. */
function snippetAround(text: string, query: string): string {
  const words = query
    .replace(/["*()]/g, ' ')
    .split(/\s+/)
    .map(w => w.trim().toLowerCase())
    .filter(w => w.length > 1 && !['and', 'or', 'not', 'near'].includes(w))
  const lower = text.toLowerCase()
  let at = -1
  for (const w of words) {
    const i = lower.indexOf(w)
    if (i >= 0 && (at < 0 || i < at)) at = i
  }
  if (at < 0) return clip(text, SNIPPET_CHARS) ?? ''
  const start = Math.max(0, at - Math.floor(SNIPPET_CHARS / 3))
  const end = Math.min(text.length, start + SNIPPET_CHARS)
  return `${start > 0 ? '…' : ''}${text.slice(start, end).trim()}${end < text.length ? '…' : ''}`
}

// ============================================================================
// lookup_character
// ============================================================================

export async function executeLookupCharacterTool(
  input: unknown,
  context: BrahmaLookupToolContext
): Promise<BrahmaLookupResult> {
  const parsed = lookupCharacterToolInputSchema.safeParse(input)
  if (!parsed.success) return invalid('lookup_character', parsed.error.issues)

  try {
    const match = await resolveCharacterRef(parsed.data.character)
    if (match.kind !== 'found') return unresolved(parsed.data.character, match)
    const c = match.character
    const repos = getRepositories()

    const memoryCount = await repos.memories.countByCharacterId(c.id)
    const chats = (await repos.chats.findByCharacterId(c.id))
      .filter(chat => CONVERSATION_CHAT_TYPES.has(chat.chatType ?? 'salon'))
      .sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''))
    const firstChat = chats.length > 0
      ? chats.reduce((a, b) => ((a.createdAt ?? '') <= (b.createdAt ?? '') ? a : b))
      : null

    const want = new Set<string>(parsed.data.fields ?? [
      'identity', 'description', 'personality', 'manifesto', 'physical', 'conversations', 'stores',
    ])

    // Where they belong: groups, projects, and the size of their own wardrobe.
    const groups: string[] = []
    for (const membership of await repos.groupCharacterMembers.findByCharacterId(c.id).catch(() => [])) {
      const group = await repos.groups.findByIdRaw(membership.groupId).catch(() => null)
      if (group) groups.push(group.name)
    }
    const projects = (await repos.projects.findByCharacterId(c.id).catch(() => [])).map(p => p.name)
    const wardrobePieces = (await repos.wardrobe.findByCharacterId(c.id).catch(() => [])).length

    let vault: Record<string, unknown> | null = null
    if (want.has('stores') && c.characterDocumentMountPointId) {
      const store = await repos.docMountPoints.findById(c.characterDocumentMountPointId).catch(() => null)
      if (store) {
        const outline = await storeOutline(store.id, 2)
        vault = {
          store: store.name,
          // Append a file's path to read it; the outline's paths are relative to this.
          address: storeAddress(store),
          files: outline.fileCount,
          outline: outline.lines.slice(0, VAULT_OUTLINE_LINES),
          ...(outline.lines.length > VAULT_OUTLINE_LINES
            ? { more: `${outline.lines.length - VAULT_OUTLINE_LINES} more lines; list_documents store="character:${c.name}"` }
            : {}),
        }
      }
    }

    const pd = c.physicalDescription
    logger.debug('lookup_character resolved', {
      userId: context.userId,
      characterId: c.id,
      memoryCount,
      conversationCount: chats.length,
      fields: [...want],
      groups: groups.length,
      projects: projects.length,
    })

    return {
      success: true,
      id: c.id,
      name: c.name,
      aliases: c.aliases ?? [],
      pronouns: c.pronouns ?? null,
      title: c.title ?? null,
      controlledBy: c.controlledBy,
      archived: !!c.archivedAt,
      createdAt: c.createdAt,
      birthday: c.birthday ?? null,
      // The public identity: age, public progressions and pronouns, then identity.md.
      ...(want.has('identity') ? { identity: clip(composePublicIdentity(c, c.identity), CORE_FIELD_CHARS) } : {}),
      ...(want.has('description') ? { description: clip(c.description, CORE_FIELD_CHARS) } : {}),
      ...(want.has('personality') ? { personality: clip(c.personality, CORE_FIELD_CHARS) } : {}),
      ...(want.has('manifesto') ? { manifesto: clip(c.manifesto, CORE_FIELD_CHARS) } : {}),
      ...(want.has('physical')
        ? {
            physicalDescription: pd
              ? clip(pd.fullDescription ?? pd.completePrompt ?? pd.longPrompt ?? pd.mediumPrompt ?? pd.shortPrompt, PHYSICAL_CHARS)
              : null,
          }
        : {}),
      ...(want.has('stores') ? { vault } : {}),
      groups,
      projects,
      wardrobePieces,
      memoriesHeld: memoryCount,
      ...(want.has('conversations')
        ? {
            conversations: {
              count: chats.length,
              first: firstChat ? conversationRef(firstChat, firstChat.id) : null,
              mostRecent: chats.slice(0, RECENT_CONVERSATIONS).map(chat => ({
                ...conversationRef(chat, chat.id),
                updatedAt: chat.updatedAt,
              })),
            },
          }
        : { conversationCount: chats.length }),
      hint: 'For facts not in these fields (an age when there is no birthday, a date, an event), use lookup_memories with character set to this one, then lookup_messages.',
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger.warn('lookup_character failed', { userId: context.userId, error: message })
    return { success: false, error: `lookup_character failed: ${message}` }
  }
}

// ============================================================================
// lookup_memories
// ============================================================================

export async function executeLookupMemoriesTool(
  input: unknown,
  context: BrahmaLookupToolContext
): Promise<BrahmaLookupResult> {
  const parsed = lookupMemoriesToolInputSchema.safeParse(input)
  if (!parsed.success) return invalid('lookup_memories', parsed.error.issues)
  const { query, character, about, since, until, full } = parsed.data
  const limit = parsed.data.limit ?? 8

  try {
    const repos = getRepositories()

    // Holders: one named character, or every live character holding memories.
    let holders: Array<{ id: string; name: string }>
    if (character) {
      const match = await resolveCharacterRef(character)
      if (match.kind !== 'found') return unresolved(character, match)
      holders = [{ id: match.character.id, name: match.character.name }]
    } else {
      const raw = (await repos.characters.findAllRaw()).filter(c => !c.archivedAt)
      holders = []
      for (const c of raw) {
        if (holders.length >= MAX_HOLDERS) break
        if ((await repos.memories.countByCharacterId(c.id)) > 0) holders.push({ id: c.id, name: c.name })
      }
    }

    let aboutCharacterId: string | undefined
    if (about) {
      const match = await resolveCharacterRef(about)
      if (match.kind !== 'found') return unresolved(about, match)
      aboutCharacterId = match.character.id
    }

    const window = await resolveWindow(since, until)
    // One embedding for the whole sweep, however many holders it visits.
    const embeddingMemo = new Map<string, EmbeddingResult>()
    const hits: Array<RecallCandidate & { holderName: string }> = []
    for (const holder of holders) {
      const found = await searchMemories(holder.id, query, {
        userId: context.userId,
        limit,
        literalPhrase: true,
        aboutCharacterId,
        window,
        includeCold: true,
        embeddingMemo,
      })
      for (const f of found) hits.push({ ...f, holderName: holder.name })
    }
    hits.sort((a, b) => b.score - a.score)
    const top = hits.slice(0, limit)

    // Names for the about-subjects, titles for the source conversations.
    const nameById = new Map<string, string>()
    for (const c of await repos.characters.findAllRaw()) nameById.set(c.id, c.name)
    const chats = await loadChats(top.map(h => h.memory.chatId).filter((id): id is string => !!id))

    logger.debug('lookup_memories completed', {
      userId: context.userId,
      holders: holders.length,
      aboutCharacterId,
      windowed: !!window,
      hits: hits.length,
      returned: top.length,
    })

    return capRecords(
      {
        success: true as const,
        query,
        searched: character ? holders[0].name : `${holders.length} characters`,
        count: top.length,
        memories: top.map(h => ({
          memoryId: h.memory.id,
          heldBy: h.holderName,
          about: h.memory.aboutCharacterId ? nameById.get(h.memory.aboutCharacterId) ?? h.memory.aboutCharacterId : null,
          summary: h.memory.summary?.trim() || null,
          content: full ? (h.memory.content?.trim() ?? null) : clip(h.memory.content, MEMORY_CHARS),
          happenedAt: h.memory.occurredAt ?? h.memory.createdAt,
          archived: memoryArchivedLabel(h.memory) ?? null,
          conversation: conversationRef(h.memory.chatId ? chats.get(h.memory.chatId) : undefined, h.memory.chatId),
        })),
      },
      'memories',
      (n) => `${n} more memories left out for length; lower \`limit\` or narrow with \`character\` / \`about\`.`,
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger.warn('lookup_memories failed', { userId: context.userId, error: message })
    return { success: false, error: `lookup_memories failed: ${message}` }
  }
}

// ============================================================================
// lookup_messages
// ============================================================================

export async function executeLookupMessagesTool(
  input: unknown,
  context: BrahmaLookupToolContext
): Promise<BrahmaLookupResult> {
  const parsed = lookupMessagesToolInputSchema.safeParse(input)
  if (!parsed.success) return invalid('lookup_messages', parsed.error.issues)
  const { query, character, speaker, since, until, conversation, group_by } = parsed.data
  const limit = parsed.data.limit ?? 10

  try {
    const repos = getRepositories()

    let chats: ChatMetadata[]
    if (conversation) {
      const found = await resolveConversationRef(conversation)
      if (!found) return { success: false, error: `No conversation with the id or title "${conversation}". Find it with lookup_conversations.` }
      if ('ambiguous' in found) {
        return {
          success: false,
          error: `More than one conversation is titled "${conversation}"; pass one of these ids: ${found.ambiguous.slice(0, 8).map(c => c.id).join(', ')}.`,
        }
      }
      chats = [found]
    } else if (character) {
      const match = await resolveCharacterRef(character)
      if (match.kind !== 'found') return unresolved(character, match)
      chats = await repos.chats.findByCharacterId(match.character.id)
    } else {
      chats = await repos.chats.findAll()
    }
    if (!conversation) chats = chats.filter(chat => CONVERSATION_CHAT_TYPES.has(chat.chatType ?? 'salon'))

    let speakerCharacterId: string | undefined
    if (speaker) {
      const match = await resolveCharacterRef(speaker)
      if (match.kind !== 'found') return unresolved(speaker, match)
      speakerCharacterId = match.character.id
      chats = chats.filter(chat => chat.participants.some(p => p.characterId === speakerCharacterId))
    }

    if (chats.length === 0) {
      return { success: true, query, count: 0, hits: [], note: 'No conversations match those filters.' }
    }

    const chatById = new Map(chats.map(chat => [chat.id, chat]))
    const postFiltered = !!(speakerCharacterId || since || until)
    // Over-fetch always: the total is how a plain search knows to suggest
    // grouping, and grouping needs every hit it can see.
    // The message index matches a query as one phrase, in order (the search
    // bar's contract, help/search.md). A model writes keywords, so when a
    // query of several words finds nothing as a phrase, search its most
    // distinctive word and keep the messages that hold every word, any order.
    const chatIds = chats.map(chat => chat.id)
    let raw = await repos.chats.searchMessagesGlobal(chatIds, query, MESSAGE_OVERFETCH)
    let anchorTerm = query
    let wideCapped = raw.length >= MESSAGE_OVERFETCH
    const terms = searchTerms(query)
    const everyWord = raw.length === 0 && terms.length > 1
    if (everyWord) {
      anchorTerm = [...terms].sort((a, b) => b.length - a.length)[0]
      const wide = await repos.chats.searchMessagesGlobal(chatIds, anchorTerm, MESSAGE_OVERFETCH)
      wideCapped = wide.length >= MESSAGE_OVERFETCH
      raw = wide.filter(hit => containsAll(hit.content ?? '', terms))
      logger.debug('lookup_messages: no phrase match, matched every word instead', {
        userId: context.userId,
        query,
        anchorTerm,
        anchorHits: wide.length,
        everyWordHits: raw.length,
      })
    }
    const matchedAs = everyWord ? { matchedAs: 'every word, in any order (no message has them as a phrase)' } : {}

    const window = await resolveWindow(since, until)

    const matching = raw.filter(hit => {
      if (window && (hit.createdAt < window.from || hit.createdAt > window.to)) return false
      if (speakerCharacterId) {
        const seat = chatById.get(hit.chatId)?.participants.find(p => p.id === hit.participantId)
        if (seat?.characterId !== speakerCharacterId) return false
      }
      return true
    })
    const totalLabel = wideCapped ? `at least ${matching.length}` : String(matching.length)

    if (group_by === 'conversation') {
      const groups = new Map<string, { hits: number; first: string; last: string; best: typeof matching[number] }>()
      for (const hit of matching) {
        const g = groups.get(hit.chatId)
        if (!g) groups.set(hit.chatId, { hits: 1, first: hit.createdAt, last: hit.createdAt, best: hit })
        else {
          g.hits++
          if (hit.createdAt < g.first) g.first = hit.createdAt
          if (hit.createdAt > g.last) g.last = hit.createdAt
        }
      }
      const grouped = [...groups.entries()]
        .sort((a, b) => b[1].hits - a[1].hits || b[1].last.localeCompare(a[1].last))
        .slice(0, limit)
        .map(([chatId, g]) => ({
          conversation: conversationRef(chatById.get(chatId), chatId),
          hits: g.hits,
          firstHitAt: g.first,
          lastHitAt: g.last,
          bestSnippet: snippetAround(g.best.content, anchorTerm),
          messageId: g.best.messageId,
        }))
      logger.debug('lookup_messages grouped by conversation', {
        userId: context.userId,
        rawHits: raw.length,
        conversations: groups.size,
        returned: grouped.length,
      })
      return capRecords(
        {
          success: true as const,
          query,
          totalHits: totalLabel,
          ...matchedAs,
          conversationCount: groups.size,
          conversations: grouped,
          ...(grouped.length === 0 ? { note: 'No matches. Try fewer or different words, or a word stem.' } : {}),
        },
        'conversations',
        (n) => `${n} more conversations left out for length; narrow with \`character\`, \`since\` or more words.`,
      )
    }

    const kept = matching.slice(0, limit)

    const namesByChat = new Map<string, Awaited<ReturnType<typeof resolveSpeakerNames>>>()
    const hits = []
    for (const hit of kept) {
      const chat = chatById.get(hit.chatId)
      let names = namesByChat.get(hit.chatId)
      if (!names && chat) {
        names = await resolveSpeakerNames(chat)
        namesByChat.set(hit.chatId, names)
      }
      hits.push({
        conversation: conversationRef(chat, hit.chatId),
        messageId: hit.messageId,
        writtenAt: hit.createdAt,
        speaker: speakerLabel(
          { participantId: hit.participantId ?? undefined, role: hit.role as MessageEvent['role'] },
          names ?? new Map()
        ),
        snippet: snippetAround(hit.content, anchorTerm),
      })
    }

    logger.debug('lookup_messages completed', {
      userId: context.userId,
      chatCount: chats.length,
      rawHits: raw.length,
      returned: hits.length,
      postFiltered,
    })

    return capRecords(
      {
        success: true as const,
        query,
        count: hits.length,
        totalHits: totalLabel,
        ...matchedAs,
        hits,
        ...(hits.length === 0
          ? { note: 'No matches. Try fewer or different words, a word stem (e.g. "birth" finds "birthday"), or drop a filter.' }
          : matching.length > UNGROUPED_HIT_NOTE_OVER && !conversation
            ? { note: `${totalLabel} messages match; these are the newest ${hits.length}. To find which conversation, ask again with group_by: "conversation".` }
            : {}),
      },
      'hits',
      (n) => `${n} more hits left out for length; lower \`limit\` or use group_by: "conversation".`,
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger.warn('lookup_messages failed', { userId: context.userId, error: message })
    return { success: false, error: `lookup_messages failed: ${message}` }
  }
}

// ============================================================================
// read_messages
// ============================================================================

export async function executeReadMessagesTool(
  input: unknown,
  context: BrahmaLookupToolContext
): Promise<BrahmaLookupResult> {
  const parsed = readMessagesToolInputSchema.safeParse(input)
  if (!parsed.success) return invalid('read_messages', parsed.error.issues)
  const { conversation_id, around_message_id, full } = parsed.data

  try {
    const repos = getRepositories()
    const chat = await repos.chats.findById(conversation_id)
    if (!chat) return { success: false, error: `No conversation with id ${conversation_id}.` }

    const lines = (await repos.chats.getMessages(conversation_id)).filter(isCharacterAuthoredMessage)
    let start: number
    let end: number
    if (around_message_id) {
      const at = lines.findIndex(m => m.id === around_message_id)
      if (at < 0) {
        return {
          success: false,
          error: `Message ${around_message_id} is not a spoken line of this conversation (it may be a system notice, or belong to another conversation).`,
        }
      }
      start = Math.max(0, at - (parsed.data.before ?? 3))
      end = Math.min(lines.length, at + (parsed.data.after ?? 3) + 1)
    } else {
      const offset = parsed.data.offset ?? 0
      const count = parsed.data.count ?? 10
      start = offset < 0 ? Math.max(0, lines.length + offset) : Math.min(offset, lines.length)
      end = Math.min(lines.length, start + count)
    }

    const names = await resolveSpeakerNames(chat)
    const cast = Array.from(new Set(names.values()))

    logger.debug('read_messages completed', {
      userId: context.userId,
      chatId: conversation_id,
      totalLines: lines.length,
      start,
      end,
    })

    return {
      success: true,
      conversation: {
        ...conversationRef(chat, chat.id),
        updatedAt: chat.updatedAt,
        cast,
        spokenLines: lines.length,
      },
      range: { from: start, to: end - 1 },
      messages: lines.slice(start, end).map((m, i) => ({
        index: start + i,
        messageId: m.id,
        speaker: speakerLabel(m, names),
        writtenAt: m.createdAt,
        content: full ? (m.content ?? '').trim() : capLine(m.content, MESSAGE_LINE_CHARS),
      })),
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger.warn('read_messages failed', { userId: context.userId, error: message })
    return { success: false, error: `read_messages failed: ${message}` }
  }
}
